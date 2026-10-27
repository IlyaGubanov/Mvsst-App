// =====================================================================
//  /api/assignments — ответственные за объекты (кто может вносить данные). ТОЛЬКО администратор.
//
//    GET /api/assignments?direction=mkd
//        → все объекты направления с их ответственными + список редакторов для выбора
//
//    PUT /api/assignments/user     { direction, userId, objectIds: [..], mode: 'add'|'remove'|'replace' }
//        → массово: «дать Петрову эти 12 адресов» (экран «по сотруднику», массовое назначение по фильтру)
//
//    PUT /api/assignments/object   { direction, objectId, userIds: [..] }
//        → точечно: «за этот адрес отвечают Петров и Сидорова» (экран «по объекту»)
//
//  Назначить можно только пользователя с ролью «Редактор». При назначении пользователь
//  автоматически получает доступ к направлению (иначе он не увидел бы свои объекты).
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getDirectionByCode, OBJECT_SOURCES } from '../services/access.js';
import { ROLE_NAMES } from '../services/users.js';

const router = Router();

const DIRECTION_CODES = Object.keys(OBJECT_SOURCES);
const directionSchema = z.enum(DIRECTION_CODES, { errorMap: () => ({ message: `Направление: ${DIRECTION_CODES.join(', ')}` }) });
const idSchema = z.number({ invalid_type_error: 'Ожидается число' }).int().positive();

// ---------- помощники ----------

/** Проверить, что все объекты существуют в таблице направления. */
async function assertObjectsExist(direction, objectIds, conn) {
  if (!objectIds.length) return;
  const { table } = OBJECT_SOURCES[direction.code];
  const found = await query(`SELECT id FROM ${table} WHERE id IN (?)`, [objectIds], conn);
  if (found.length !== objectIds.length) {
    const have = new Set(found.map((f) => f.id));
    const missing = objectIds.filter((id) => !have.has(id));
    throw badRequest(`В направлении «${direction.name}» нет объектов с номерами: ${missing.join(', ')}`);
  }
}

/** Пользователь, которого можно назначить ответственным (активный редактор). */
async function getAssignableUser(userId, conn) {
  const user = await queryOne('SELECT id, full_name, role, is_active FROM users WHERE id = ?', [userId], conn);
  if (!user) throw notFound(`Пользователь №${userId} не найден`);
  if (!user.is_active) throw badRequest(`${user.full_name} отключён — назначить нельзя`);
  if (user.role !== 'editor') {
    throw badRequest(`Ответственным можно назначить только «Редактора». У ${user.full_name} роль «${ROLE_NAMES[user.role]}» — сначала смените роль.`);
  }
  return user;
}

/** Чтобы редактор видел направление, в котором у него есть объекты. */
function grantDirectionView(userIds, direction, conn) {
  if (!userIds.length) return null;
  return query(
    'INSERT IGNORE INTO user_directions (user_id, direction_id) VALUES ?',
    [userIds.map((u) => [u, direction.id])], conn,
  );
}

// ---------------------------------------------------------------------
// GET /?direction=mkd
// ---------------------------------------------------------------------
router.get('/', validate(z.object({ direction: directionSchema }), 'query'), async (req, res) => {
  const direction = await getDirectionByCode(req.valid.query.direction);
  const { table, nameColumn } = OBJECT_SOURCES[direction.code];

  const objects = await query(`SELECT id, code, ${nameColumn} AS name, archived FROM ${table} ORDER BY archived, ${nameColumn}`);
  const links = await query(
    `SELECT uo.object_id, u.id, u.full_name
       FROM user_objects uo JOIN users u ON u.id = uo.user_id
      WHERE uo.direction_id = ? ORDER BY u.full_name`,
    [direction.id],
  );
  const editors = await query(
    "SELECT id, login, full_name AS fullName FROM users WHERE role = 'editor' AND is_active = 1 ORDER BY full_name",
  );

  // Группируем ответственных по объектам: Map(objectId → [{ id, fullName }])
  const byObject = new Map();
  for (const l of links) {
    if (!byObject.has(l.object_id)) byObject.set(l.object_id, []);
    byObject.get(l.object_id).push({ id: l.id, fullName: l.full_name });
  }

  const list = objects.map((o) => ({
    id: o.id,
    code: o.code,
    name: o.name,
    archived: Boolean(o.archived),
    responsible: byObject.get(o.id) ?? [],
  }));

  res.json({
    direction: { code: direction.code, name: direction.name },
    objects: list,
    unassignedCount: list.filter((o) => !o.archived && o.responsible.length === 0).length,
    editors,
  });
});

// ---------------------------------------------------------------------
// PUT /user — массово объекты одному пользователю
// ---------------------------------------------------------------------
const userAssignSchema = z.object({
  direction: directionSchema,
  userId: idSchema,
  objectIds: z.array(idSchema).max(5000),
  mode: z.enum(['add', 'remove', 'replace']).default('add'),
});

router.put('/user', validate(userAssignSchema), async (req, res) => {
  const { userId, mode } = req.body;
  const objectIds = [...new Set(req.body.objectIds)];
  const direction = await getDirectionByCode(req.body.direction);

  const result = await withTransaction(async (conn) => {
    // Снимать объекты можно с кого угодно (например, с бывшего редактора); назначать — только редактору
    const user = mode === 'remove'
      ? await queryOne('SELECT id, full_name FROM users WHERE id = ?', [userId], conn)
      : await getAssignableUser(userId, conn);
    if (!user) throw notFound(`Пользователь №${userId} не найден`);
    await assertObjectsExist(direction, objectIds, conn);

    const current = new Set((await query(
      'SELECT object_id FROM user_objects WHERE user_id = ? AND direction_id = ?', [userId, direction.id], conn,
    )).map((r) => r.object_id));

    let added = [];
    let removed = [];
    if (mode === 'add') added = objectIds.filter((id) => !current.has(id));
    if (mode === 'remove') removed = objectIds.filter((id) => current.has(id));
    if (mode === 'replace') {
      added = objectIds.filter((id) => !current.has(id));
      removed = [...current].filter((id) => !objectIds.includes(id));
    }

    if (added.length) {
      await query(
        'INSERT INTO user_objects (user_id, direction_id, object_id, assigned_by) VALUES ?',
        [added.map((objectId) => [userId, direction.id, objectId, req.user.id])], conn,
      );
      await grantDirectionView([userId], direction, conn);
    }
    if (removed.length) {
      await query(
        'DELETE FROM user_objects WHERE user_id = ? AND direction_id = ? AND object_id IN (?)',
        [userId, direction.id, removed], conn,
      );
    }
    if (added.length || removed.length) {
      await audit(conn, {
        req, directionId: direction.id, entity: 'user_objects', entityId: userId, entityName: user.full_name,
        action: 'update',
        summary: `Ответственный ${user.full_name}: назначено объектов ${added.length}, снято ${removed.length}`,
        changes: { added, removed },
      });
    }
    return { added: added.length, removed: removed.length, total: current.size + added.length - removed.length };
  });

  res.json(result);
});

// ---------------------------------------------------------------------
// PUT /object — задать список ответственных за один объект
// ---------------------------------------------------------------------
const objectAssignSchema = z.object({
  direction: directionSchema,
  objectId: idSchema,
  userIds: z.array(idSchema).max(20),
});

router.put('/object', validate(objectAssignSchema), async (req, res) => {
  const { objectId } = req.body;
  const userIds = [...new Set(req.body.userIds)];
  const direction = await getDirectionByCode(req.body.direction);
  const { table, nameColumn } = OBJECT_SOURCES[direction.code];

  const result = await withTransaction(async (conn) => {
    const object = await queryOne(`SELECT id, ${nameColumn} AS name FROM ${table} WHERE id = ?`, [objectId], conn);
    if (!object) throw notFound(`В направлении «${direction.name}» нет объекта №${objectId}`);
    const users = [];
    for (const id of userIds) users.push(await getAssignableUser(id, conn));

    const before = await query(
      `SELECT u.id, u.full_name FROM user_objects uo JOIN users u ON u.id = uo.user_id
        WHERE uo.direction_id = ? AND uo.object_id = ?`,
      [direction.id, objectId], conn,
    );

    await query('DELETE FROM user_objects WHERE direction_id = ? AND object_id = ?', [direction.id, objectId], conn);
    if (userIds.length) {
      await query(
        'INSERT INTO user_objects (user_id, direction_id, object_id, assigned_by) VALUES ?',
        [userIds.map((u) => [u, direction.id, objectId, req.user.id])], conn,
      );
      await grantDirectionView(userIds, direction, conn);
    }

    const names = (list) => list.map((u) => u.full_name).join(', ') || 'нет';
    await audit(conn, {
      req, directionId: direction.id, entity: 'user_objects', entityId: objectId, entityName: object.name,
      action: 'update',
      summary: `Ответственные за «${object.name}»: ${names(before)} → ${names(users)}`,
      changes: { users: [before.map((u) => u.id), userIds] },
    });
    return { objectId, responsible: users.map((u) => ({ id: u.id, fullName: u.full_name })) };
  });

  res.json(result);
});

export default router;
