// =====================================================================
//  /api/users — управление пользователями. ТОЛЬКО для администратора
//  (проверка роли стоит в app.js перед этим маршрутом).
//
//    GET  /api/users                       → список пользователей
//    GET  /api/users/:id                   → карточка: направления и назначенные объекты
//    POST /api/users                       { login, fullName, email?, role, directions? } → { user, tempPassword }
//    PUT  /api/users/:id                   { fullName?, email?, role?, isActive? }        → { user }
//    PUT  /api/users/:id/directions        { directions: ['mkd', 'networks'] }            → { user }
//    POST /api/users/:id/reset-password                                                    → { tempPassword }
//
//  Пользователей не удаляем (на них ссылается журнал) — отключаем: isActive = false.
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getAllDirections, OBJECT_SOURCES } from '../services/access.js';
import { ROLES, ROLE_NAMES } from '../services/users.js';
import { hashPassword, generateTempPassword } from '../services/passwords.js';

const router = Router();

// ---------- схемы проверки данных ----------

const DIRECTION_CODES = Object.keys(OBJECT_SOURCES); // ['schools', 'mkd', 'networks', 'streets']

const idParams = z.object({ id: z.coerce.number().int().positive('Неверный номер пользователя') });
const roleSchema = z.enum(ROLES, { errorMap: () => ({ message: 'Роль: admin, manager, editor или viewer' }) });
const directionsSchema = z.array(z.enum(DIRECTION_CODES, { errorMap: () => ({ message: `Направления: ${DIRECTION_CODES.join(', ')}` }) }));
const fullNameSchema = z.string().trim().min(2, 'ФИО — не короче 2 символов').max(150);
// e-mail необязателен: пустая строка → null; если поле не передано — не трогаем
const emailSchema = z.string().trim().max(150).email('Неверный e-mail').or(z.literal(''))
  .nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

// ---------- помощники ----------

async function directionIdsByCodes(codes) {
  const all = await getAllDirections();
  return [...new Set(codes)].map((c) => all.find((d) => d.code === c)?.id).filter(Boolean);
}

/** Сколько ещё активных администраторов, кроме указанного. Нельзя остаться без администратора. */
async function otherActiveAdmins(excludeId, db) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
    [excludeId], db,
  );
  return row.n;
}

/** Полная карточка пользователя для интерфейса администратора. */
async function loadUserDetails(id) {
  const row = await queryOne(
    `SELECT id, login, full_name, email, role, is_active, must_change_password, last_login_at,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
       FROM users WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound('Пользователь не найден');

  const dirs = await query(
    `SELECT d.code FROM user_directions ud JOIN directions d ON d.id = ud.direction_id
      WHERE ud.user_id = ? ORDER BY d.sort_order`,
    [id],
  );

  // Назначенные объекты по направлениям: { mkd: [{ id, code, name }], … }
  const objects = {};
  for (const direction of await getAllDirections()) {
    const { table, nameColumn } = OBJECT_SOURCES[direction.code];
    objects[direction.code] = await query(
      `SELECT o.id, o.code, o.${nameColumn} AS name
         FROM user_objects uo JOIN ${table} o ON o.id = uo.object_id
        WHERE uo.user_id = ? AND uo.direction_id = ? ORDER BY name`,
      [id, direction.id],
    );
  }

  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    roleName: ROLE_NAMES[row.role],
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    isLocked: Boolean(row.is_locked),
    lastLoginAt: row.last_login_at,
    directions: dirs.map((d) => d.code),
    objects,
  };
}

// ---------------------------------------------------------------------
// GET / — список
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.login, u.full_name, u.email, u.role, u.is_active, u.must_change_password, u.last_login_at,
            (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked,
            (SELECT GROUP_CONCAT(d.code ORDER BY d.sort_order)
               FROM user_directions ud JOIN directions d ON d.id = ud.direction_id
              WHERE ud.user_id = u.id) AS directions,
            (SELECT COUNT(*) FROM user_objects uo WHERE uo.user_id = u.id) AS objects_count
       FROM users u
      ORDER BY u.is_active DESC, u.full_name`,
  );
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      login: r.login,
      fullName: r.full_name,
      email: r.email,
      role: r.role,
      roleName: ROLE_NAMES[r.role],
      isActive: Boolean(r.is_active),
      mustChangePassword: Boolean(r.must_change_password),
      isLocked: Boolean(r.is_locked),
      lastLoginAt: r.last_login_at,
      directions: r.directions ? r.directions.split(',') : [],
      objectsCount: r.objects_count,
    })),
  });
});

// ---------------------------------------------------------------------
// GET /:id — карточка
// ---------------------------------------------------------------------
router.get('/:id', validate(idParams, 'params'), async (req, res) => {
  res.json({ user: await loadUserDetails(req.valid.params.id) });
});

// ---------------------------------------------------------------------
// POST / — создать пользователя с временным паролем
// ---------------------------------------------------------------------
const createSchema = z.object({
  login: z.string({ required_error: 'Введите логин' }).trim().toLowerCase()
    .min(3, 'Логин — не короче 3 символов').max(60)
    .regex(/^[a-z0-9._-]+$/, 'Логин: латинские буквы, цифры, точка, дефис, подчёркивание'),
  fullName: fullNameSchema,
  email: emailSchema,
  role: roleSchema,
  directions: directionsSchema.default([]),
});

router.post('/', validate(createSchema), async (req, res) => {
  const { login, fullName, email, role, directions } = req.body;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  const directionIds = await directionIdsByCodes(directions);

  const userId = await withTransaction(async (conn) => {
    let result;
    try {
      result = await query(
        `INSERT INTO users (login, password_hash, full_name, email, role, must_change_password)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [login, hash, fullName, email ?? null, role], conn,
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict(`Логин «${login}» уже занят`);
      throw err;
    }
    const id = result.insertId;
    if (directionIds.length) {
      // «VALUES ?» с массивом массивов — вставка нескольких строк одним запросом
      await query('INSERT INTO user_directions (user_id, direction_id) VALUES ?', [directionIds.map((d) => [id, d])], conn);
    }
    await audit(conn, {
      req, entity: 'user', entityId: id, entityName: fullName, action: 'create',
      summary: `Создан пользователь ${login} (${ROLE_NAMES[role]})`,
      changes: { login, role, directions },
    });
    return id;
  });

  res.status(201).json({
    user: await loadUserDetails(userId),
    tempPassword, // показывается администратору ОДИН раз; в базе хранится только хеш
    note: 'Передайте временный пароль пользователю лично. При первом входе система попросит его сменить.',
  });
});

// ---------------------------------------------------------------------
// PUT /:id — изменить ФИО, e-mail, роль, включить/отключить
// ---------------------------------------------------------------------
const updateSchema = z.object({
  fullName: fullNameSchema.optional(),
  email: emailSchema,
  role: roleSchema.optional(),
  isActive: z.boolean({ invalid_type_error: 'isActive: true или false' }).optional(),
});

router.put('/:id', validate(idParams, 'params'), validate(updateSchema), async (req, res) => {
  const id = req.valid.params.id;
  const { fullName, email, role, isActive } = req.body;

  await withTransaction(async (conn) => {
    const before = await queryOne('SELECT id, login, full_name, email, role, is_active FROM users WHERE id = ?', [id], conn);
    if (!before) throw notFound('Пользователь не найден');

    // Защита: администратор не может «рубить сук, на котором сидит», и система не остаётся без администратора
    const losesAdmin = before.role === 'admin' && ((role && role !== 'admin') || isActive === false);
    if (losesAdmin) {
      if (id === req.user.id) throw badRequest('Нельзя снять права администратора или отключить самого себя');
      if ((await otherActiveAdmins(id, conn)) === 0) throw badRequest('Это последний активный администратор — сначала назначьте другого');
    }

    // Собираем только реально изменённые поля. Имена колонок — из этого списка, не из запроса.
    const sets = [];
    const values = [];
    const changes = {};
    const summary = [];
    if (fullName !== undefined && fullName !== before.full_name) {
      sets.push('full_name = ?'); values.push(fullName);
      changes.fullName = [before.full_name, fullName]; summary.push(`ФИО: ${before.full_name} → ${fullName}`);
    }
    if (email !== undefined && email !== before.email) {
      sets.push('email = ?'); values.push(email);
      changes.email = [before.email, email]; summary.push('e-mail изменён');
    }
    if (role !== undefined && role !== before.role) {
      sets.push('role = ?'); values.push(role);
      changes.role = [before.role, role]; summary.push(`Роль: ${ROLE_NAMES[before.role]} → ${ROLE_NAMES[role]}`);
    }
    if (isActive !== undefined && isActive !== Boolean(before.is_active)) {
      sets.push('is_active = ?'); values.push(isActive ? 1 : 0);
      changes.isActive = [Boolean(before.is_active), isActive]; summary.push(isActive ? 'Включён' : 'Отключён');
    }
    if (!sets.length) return; // ничего не поменялось

    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, id], conn);
    await audit(conn, {
      req, entity: 'user', entityId: id, entityName: fullName ?? before.full_name,
      action: 'update', summary: summary.join('; '), changes,
    });
  });

  // Если роль сменилась с «Редактор» на другую, назначенные объекты сохраняются в базе,
  // но перестают действовать (права проверяет services/access.js). Вернёте роль — вернутся и права.
  res.json({ user: await loadUserDetails(id) });
});

// ---------------------------------------------------------------------
// PUT /:id/directions — какие направления видит пользователь (для editor и viewer)
// ---------------------------------------------------------------------
const directionsBody = z.object({ directions: directionsSchema });

router.put('/:id/directions', validate(idParams, 'params'), validate(directionsBody), async (req, res) => {
  const id = req.valid.params.id;
  const newIds = await directionIdsByCodes(req.body.directions);

  await withTransaction(async (conn) => {
    const user = await queryOne('SELECT id, full_name FROM users WHERE id = ?', [id], conn);
    if (!user) throw notFound('Пользователь не найден');
    const before = await query(
      `SELECT d.code FROM user_directions ud JOIN directions d ON d.id = ud.direction_id WHERE ud.user_id = ?`,
      [id], conn,
    );

    // Заменяем список целиком: удалить старые → вставить новые
    await query('DELETE FROM user_directions WHERE user_id = ?', [id], conn);
    if (newIds.length) {
      await query('INSERT INTO user_directions (user_id, direction_id) VALUES ?', [newIds.map((d) => [id, d])], conn);
    }
    await audit(conn, {
      req, entity: 'user', entityId: id, entityName: user.full_name, action: 'update',
      summary: `Направления: ${req.body.directions.join(', ') || 'нет'}`,
      changes: { directions: [before.map((b) => b.code), req.body.directions] },
    });
  });

  res.json({ user: await loadUserDetails(id) });
});

// ---------------------------------------------------------------------
// POST /:id/reset-password — новый временный пароль (и снятие блокировки)
// ---------------------------------------------------------------------
router.post('/:id/reset-password', validate(idParams, 'params'), async (req, res) => {
  const id = req.valid.params.id;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);

  await withTransaction(async (conn) => {
    const user = await queryOne('SELECT id, full_name FROM users WHERE id = ?', [id], conn);
    if (!user) throw notFound('Пользователь не найден');
    await query(
      `UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL
        WHERE id = ?`,
      [hash, id], conn,
    );
    await audit(conn, { req, entity: 'user', entityId: id, entityName: user.full_name, action: 'update', summary: 'Сброс пароля администратором' });
  });

  res.json({ tempPassword, note: 'Передайте пароль пользователю лично. При входе система попросит его сменить.' });
});

export default router;
