// =====================================================================
//  audit.js — запись в журнал изменений (таблица audit_log).
//
//  Вызывайте ВНУТРИ той же транзакции, что и само изменение (передайте conn),
//  тогда изменение и запись о нём сохранятся вместе — или не сохранятся вместе.
//
//  Пример:
//    await audit(conn, {
//      req, entity: 'user', entityId: 7, entityName: 'Петров С.В.',
//      action: 'update', summary: 'Роль: Просмотр → Редактор',
//      changes: { role: ['viewer', 'editor'] },        // было → стало
//    });
// =====================================================================

import { query, pool } from '../db.js';

/**
 * @param {object} db — подключение транзакции или pool
 * @param {object} entry
 * @param {object} [entry.req]   — запрос: из него берутся пользователь и IP
 * @param {object} [entry.user]  — кто сделал (если не req.user, например при входе)
 * @param {number|null} [entry.directionId]
 * @param {string} entry.entity  — что изменили: 'user', 'user_objects', 'mkd_item'…
 * @param {string|number|null} [entry.entityId]
 * @param {string|null} [entry.entityName] — понятное имя: ФИО, адрес
 * @param {'create'|'update'|'delete'|'archive'|'import'|'export'|'login'|'logout'|'other'} entry.action
 * @param {string} entry.summary — одна строка для человека
 * @param {object|null} [entry.changes]
 */
export async function audit(db = pool, {
  req, user = req?.user, directionId = null, entity, entityId = null, entityName = null,
  action, summary, changes = null,
}) {
  await query(
    `INSERT INTO audit_log
       (user_id, user_name, direction_id, entity, entity_id, entity_name, action, summary, changes, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.id ?? null,
      user?.fullName ?? 'Система',
      directionId,
      entity,
      entityId == null ? null : String(entityId),
      entityName == null ? null : String(entityName).slice(0, 255),
      action,
      String(summary).slice(0, 500),
      changes ? JSON.stringify(changes) : null,
      req?.ip ?? null,
    ],
    db,
  );
}
