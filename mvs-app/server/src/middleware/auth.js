// =====================================================================
//  auth.js — проверка входа и роли.
//
//    requireLogin            — пускает только вошедших; кладёт пользователя в req.user.
//                              Пользователь с временным паролем получит 403, пока не сменит пароль.
//    requireLoginEvenIfPasswordExpired — то же, но пускает и с временным паролем
//                              (нужно для «кто я», смены пароля и выхода).
//    requireRole('admin')    — пускает только указанные роли (ставится ПОСЛЕ requireLogin).
//
//  Пользователь каждый раз перечитывается из базы: если администратор заблокировал
//  человека или сменил ему роль, это действует сразу, а не после повторного входа.
// =====================================================================

import { HttpError, unauthorized, forbidden } from '../errors.js';
import { loadActiveUser } from '../services/users.js';
import { destroySession } from '../services/session.js';

function makeRequireLogin({ allowExpiredPassword }) {
  return async (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) throw unauthorized();

    const user = await loadActiveUser(userId);
    if (!user) {
      // Пользователя удалили из базы или заблокировали — завершаем его сеанс
      await destroySession(req);
      throw unauthorized('Учётная запись отключена. Обратитесь к администратору.');
    }
    if (user.mustChangePassword && !allowExpiredPassword) {
      // code помогает интерфейсу понять, что нужно открыть форму смены пароля
      throw new HttpError(403, 'Сначала смените временный пароль', { code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    req.user = user;
    next();
  };
}

export const requireLogin = makeRequireLogin({ allowExpiredPassword: false });
export const requireLoginEvenIfPasswordExpired = makeRequireLogin({ allowExpiredPassword: true });

/** Пускает только пользователей с одной из перечисленных ролей. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden('Недостаточно прав для этого действия');
    next();
  };
}
