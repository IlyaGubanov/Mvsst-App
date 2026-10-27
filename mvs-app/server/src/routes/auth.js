// =====================================================================
//  /api/auth — вход и выход.
//
//    POST /api/auth/login            { login, password }        → { user }
//    POST /api/auth/logout                                       → { ok: true }
//    GET  /api/auth/me                                           → { user }   (кто я и что мне можно)
//    POST /api/auth/change-password  { currentPassword, newPassword } → { user }
// =====================================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError, unauthorized, badRequest } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireLoginEvenIfPasswordExpired } from '../middleware/auth.js';
import { findUserForLogin, loadActiveUser, toRequestUser, describeUser } from '../services/users.js';
import {
  verifyPassword, hashPassword, wasteTimeLikePasswordCheck, newPasswordSchema,
} from '../services/passwords.js';
import { regenerateSession, saveSession, destroySession } from '../services/session.js';
import { audit } from '../services/audit.js';

const router = Router();

// Не больше 20 попыток входа за 15 минут с одного IP-адреса — защита от перебора паролей.
// (Отдельно от этого каждая учётная запись блокируется после 5 неверных паролей подряд.)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Подождите 15 минут.' },
});

const GENERIC_LOGIN_ERROR = 'Неверный логин или пароль';

// ---------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------
const loginSchema = z.object({
  login: z.string({ required_error: 'Введите логин' }).trim().min(1, 'Введите логин').max(60),
  password: z.string({ required_error: 'Введите пароль' }).min(1, 'Введите пароль').max(200),
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { login, password } = req.body;
  const row = await findUserForLogin(login);

  // Нет такого пользователя или он отключён. Тратим время «как на проверку пароля»
  // и отвечаем тем же текстом, что при неверном пароле: так нельзя узнать, какие логины существуют.
  if (!row || !row.is_active) {
    await wasteTimeLikePasswordCheck(password);
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }

  // Учётная запись временно заблокирована после серии неверных паролей
  if (row.is_locked) {
    const until = String(row.locked_until).slice(11, 16); // 'ГГГГ-ММ-ДД ЧЧ:ММ:СС' → 'ЧЧ:ММ'
    throw new HttpError(423, `Слишком много неверных попыток. Вход заблокирован до ${until}.`);
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    const failed = row.failed_logins + 1;
    if (failed >= config.security.maxFailedLogins) {
      // Блокируем и обнуляем счётчик: после окончания блокировки снова будет 5 попыток
      await query(
        'UPDATE users SET failed_logins = 0, locked_until = NOW() + INTERVAL ? MINUTE WHERE id = ?',
        [config.security.lockMinutes, row.id],
      );
      // Автор записи — «Система»: пароль подбирал не обязательно сам владелец учётной записи
      await audit(undefined, {
        req, user: null, entity: 'user', entityId: row.id, entityName: row.full_name,
        action: 'other', summary: `Вход заблокирован на ${config.security.lockMinutes} мин после ${failed} неверных паролей`,
      });
    } else {
      await query('UPDATE users SET failed_logins = ? WHERE id = ?', [failed, row.id]);
    }
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }

  // Пароль верный
  await query(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
    [row.id],
  );
  const user = toRequestUser(row);

  await regenerateSession(req);   // новый номер сеанса при каждом входе
  req.session.userId = user.id;   // в сеансе храним только id — остальное читаем из базы
  await saveSession(req);

  await audit(undefined, { req, user, entity: 'user', entityId: user.id, entityName: user.fullName, action: 'login', summary: 'Вход в систему' });
  res.json({ user: await describeUser(user) });
});

// ---------------------------------------------------------------------
// POST /logout — работает и без входа (просто ничего не делает)
// ---------------------------------------------------------------------
router.post('/logout', async (req, res) => {
  const userId = req.session?.userId;
  const user = userId ? await loadActiveUser(userId) : null; // узнаём ФИО до завершения сеанса — для журнала
  await destroySession(req);
  res.clearCookie(config.session.cookieName);
  if (user) {
    await audit(undefined, { req, user, entity: 'user', entityId: user.id, entityName: user.fullName, action: 'logout', summary: 'Выход из системы' })
      .catch(() => {}); // запись о выходе не должна мешать самому выходу
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// GET /me — кто я и какие направления/права у меня есть
// ---------------------------------------------------------------------
router.get('/me', requireLoginEvenIfPasswordExpired, async (req, res) => {
  res.json({ user: await describeUser(req.user) });
});

// ---------------------------------------------------------------------
// POST /change-password — смена своего пароля (в т.ч. обязательная после временного)
// ---------------------------------------------------------------------
const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Введите текущий пароль' }).min(1, 'Введите текущий пароль'),
  newPassword: newPasswordSchema,
});

router.post('/change-password', requireLoginEvenIfPasswordExpired, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const row = await findUserForLogin(req.user.login);

  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    throw badRequest('Текущий пароль введён неверно', { fields: [{ field: 'currentPassword', message: 'Неверный пароль' }] });
  }
  if (currentPassword === newPassword) {
    throw badRequest('Новый пароль должен отличаться от текущего', { fields: [{ field: 'newPassword', message: 'Совпадает с текущим' }] });
  }

  const hash = await hashPassword(newPassword);
  await withTransaction(async (conn) => {
    await query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id], conn);
    await audit(conn, { req, entity: 'user', entityId: req.user.id, entityName: req.user.fullName, action: 'update', summary: 'Смена своего пароля' });
  });

  const user = { ...req.user, mustChangePassword: false };
  res.json({ user: await describeUser(user) });
});

export default router;
