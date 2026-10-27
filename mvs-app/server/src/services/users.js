// =====================================================================
//  users.js — чтение пользователей из базы и «публичный» вид пользователя для интерфейса.
//  Публичный вид НИКОГДА не содержит хеш пароля.
// =====================================================================

import { queryOne } from '../db.js';
import { describeAccess } from './access.js';

export const ROLES = ['admin', 'manager', 'editor', 'viewer'];
export const ROLE_NAMES = { admin: 'Администратор', manager: 'Руководство', editor: 'Редактор', viewer: 'Просмотр' };

/** Пользователь для проверки входа (с хешем пароля и признаком блокировки). */
export function findUserForLogin(login) {
  return queryOne(
    `SELECT id, login, full_name, email, role, is_active, must_change_password, password_hash,
            failed_logins, locked_until,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
       FROM users WHERE login = ?`,
    [login],
  );
}

/** Активный пользователь по id в «коротком» виде — так он хранится в req.user. Неактивный → null. */
export async function loadActiveUser(id) {
  const row = await queryOne(
    'SELECT id, login, full_name, email, role, is_active, must_change_password FROM users WHERE id = ?',
    [id],
  );
  if (!row || !row.is_active) return null;
  return toRequestUser(row);
}

/** Строка из базы → объект req.user (поля в стиле JavaScript: fullName вместо full_name). */
export function toRequestUser(row) {
  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

/** Что отдаём интерфейсу на «кто я»: пользователь + доступные направления и права. */
export async function describeUser(user) {
  return {
    ...user,
    roleName: ROLE_NAMES[user.role],
    directions: await describeAccess(user),
  };
}
