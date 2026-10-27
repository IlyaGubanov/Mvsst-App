// =====================================================================
//  access.js — ПРАВИЛА ДОСТУПА. Единственное место, где решается «кому что можно».
//
//  Роль       | Видит                                   | Вносит данные
//  -----------|-----------------------------------------|--------------------------------------
//  admin      | всё                                     | по любому объекту
//  manager    | все направления (руководство)           | ничего
//  editor     | направления из user_directions          | только объекты из user_objects
//  viewer     | направления из user_directions          | ничего
//
//  Все маршруты спрашивают права только через функции этого файла —
//  если правила изменятся, менять придётся только здесь.
// =====================================================================

import { query } from '../db.js';
import { notFound } from '../errors.js';

/**
 * Где лежат объекты каждого направления и какое поле показывать как название.
 * Имена таблиц берутся ТОЛЬКО из этого списка (никогда из запроса пользователя),
 * поэтому подставлять их в SQL безопасно.
 */
export const OBJECT_SOURCES = {
  schools:  { table: 'sch_objects', nameColumn: 'short_name' },
  mkd:      { table: 'mkd_objects', nameColumn: 'address' },
  networks: { table: 'net_objects', nameColumn: 'short_name' },
  streets:  { table: 'st_objects',  nameColumn: 'name' },
};

const SEES_EVERYTHING = new Set(['admin', 'manager']);

// ---------- справочник направлений (их 4, меняются редко — держим в памяти) ----------

let directionsCache = null;

/** Все активные направления по порядку. */
export async function getAllDirections() {
  if (!directionsCache) {
    directionsCache = await query(
      `SELECT id, code, name, unit_label AS unitLabel, cycle, is_readonly AS isReadonly,
              thr_warn AS thrWarn, thr_crit AS thrCrit, period_start_days AS periodStartDays
         FROM directions WHERE is_active = 1 ORDER BY sort_order`,
    );
  }
  return directionsCache;
}

/** Сбросить кэш (вызовем, когда администратор изменит направления). */
export function resetDirectionsCache() {
  directionsCache = null;
}

/** Направление по коду ('mkd'); если такого нет — ошибка 404. */
export async function getDirectionByCode(code) {
  const direction = (await getAllDirections()).find((d) => d.code === code);
  if (!direction) throw notFound(`Направление «${code}» не найдено`);
  return direction;
}

// ---------- просмотр ----------

/** Множество id направлений, которые пользователь видит. */
export async function visibleDirectionIds(user) {
  const all = await getAllDirections();
  if (SEES_EVERYTHING.has(user.role)) return new Set(all.map((d) => d.id));
  const rows = await query('SELECT direction_id FROM user_directions WHERE user_id = ?', [user.id]);
  return new Set(rows.map((r) => r.direction_id));
}

export async function canViewDirection(user, directionId) {
  return (await visibleDirectionIds(user)).has(directionId);
}

// ---------- ввод данных ----------

/**
 * Какие объекты направления пользователь может менять.
 * Возвращает 'all' (администратор) или множество id объектов (может быть пустым).
 */
export async function editableObjectIds(user, direction) {
  if (user.role === 'admin') return 'all';
  if (user.role !== 'editor' || direction.isReadonly) return new Set();
  if (!(await canViewDirection(user, direction.id))) return new Set();
  const rows = await query(
    'SELECT object_id FROM user_objects WHERE user_id = ? AND direction_id = ?',
    [user.id, direction.id],
  );
  return new Set(rows.map((r) => r.object_id));
}

/** Может ли пользователь менять данные этого объекта. */
export async function canEditObject(user, direction, objectId) {
  const ids = await editableObjectIds(user, direction);
  return ids === 'all' || ids.has(Number(objectId));
}

/** Ответственные за объекты направления: Map(objectId → ['ФИО', …]) — для реестров и карточек. */
export async function responsibleByObject(direction) {
  const rows = await query(
    `SELECT uo.object_id, u.full_name FROM user_objects uo JOIN users u ON u.id = uo.user_id
      WHERE uo.direction_id = ? AND u.is_active = 1 ORDER BY u.full_name`,
    [direction.id],
  );
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.object_id)) map.set(r.object_id, []); map.get(r.object_id).push(r.full_name); });
  return map;
}

// ---------- сводка прав для интерфейса ----------

/**
 * Список доступных пользователю направлений с отметкой, может ли он что-то вносить.
 * Интерфейс по нему строит вкладки и решает, показывать ли кнопки ввода.
 * myObjects: 'all' — все объекты; число — сколько объектов назначено.
 */
export async function describeAccess(user) {
  const all = await getAllDirections();
  const visible = await visibleDirectionIds(user);

  // Для редактора одним запросом считаем назначенные объекты по направлениям
  const counts = new Map();
  if (user.role === 'editor') {
    const rows = await query(
      'SELECT direction_id, COUNT(*) AS n FROM user_objects WHERE user_id = ? GROUP BY direction_id',
      [user.id],
    );
    rows.forEach((r) => counts.set(r.direction_id, r.n));
  }

  return all
    .filter((d) => visible.has(d.id))
    .map((d) => {
      let myObjects = 0;
      if (user.role === 'admin') myObjects = 'all';
      else if (user.role === 'editor' && !d.isReadonly) myObjects = counts.get(d.id) ?? 0;
      return {
        code: d.code,
        name: d.name,
        unitLabel: d.unitLabel,
        cycle: d.cycle,
        canEdit: myObjects === 'all' || myObjects > 0,
        myObjects,
      };
    });
}
