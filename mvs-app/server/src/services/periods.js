// =====================================================================
//  periods.js — отчётные периоды МКД и Сетей.
//
//  Периоды начинаются в дни из directions.period_start_days ('mon,thu'):
//    пн–ср и чт–вс. План считается на последний день периода (plan_date = period_end).
//  Перенесённые из старых HTML недели (is_legacy = 1) хранят свои даты как есть.
//
//  Период создаётся автоматически при первом вводе за него; закрывает его администратор.
// =====================================================================

import { query, queryOne } from '../db.js';
import { badRequest, HttpError } from '../errors.js';
import { addDays, dayMs, todayIso } from './kpi/common.js';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** День недели даты: 0 = понедельник … 6 = воскресенье. */
const weekday = (iso) => (new Date(dayMs(iso)).getUTCDay() + 6) % 7;

/** Дни начала периодов направления: 'mon,thu' → [0, 3]. */
function startDays(direction) {
  const days = String(direction.periodStartDays ?? 'mon').split(',').map((d) => WEEKDAYS.indexOf(d.trim())).filter((d) => d >= 0);
  return days.length ? days : [0];
}

/** Может ли период начинаться в эту дату. */
export function isPeriodStart(direction, iso) {
  return startDays(direction).includes(weekday(iso));
}

/** Границы периода по правилу направления, в который попадает дата: { start, end }. */
export function periodBounds(direction, iso) {
  const days = startDays(direction);
  let start = iso;
  while (!days.includes(weekday(start))) start = addDays(start, -1);
  let next = addDays(start, 1);
  while (!days.includes(weekday(next))) next = addDays(next, 1);
  return { start, end: addDays(next, -1) };
}

const COLUMNS = `period_start AS start, period_end AS end, plan_date AS planDate,
  is_closed AS isClosed, is_legacy AS isLegacy, closed_at AS closedAt`;
const normalize = (p) => p && { ...p, isClosed: Boolean(p.isClosed), isLegacy: Boolean(p.isLegacy) };

export async function listPeriods(direction) {
  const rows = await query(`SELECT ${COLUMNS} FROM reporting_periods WHERE direction_id = ? ORDER BY period_start DESC`, [direction.id]);
  return rows.map(normalize);
}

export async function getPeriod(direction, start, db) {
  return normalize(await queryOne(`SELECT ${COLUMNS} FROM reporting_periods WHERE direction_id = ? AND period_start = ?`, [direction.id, start], db));
}

/**
 * Текущий период (на сегодня). Если сегодня покрывает уже существующий период
 * (например, перенесённая неделя) — он; иначе — по правилу направления (может ещё не существовать).
 */
export async function currentPeriod(direction, today = todayIso()) {
  const existing = normalize(await queryOne(
    `SELECT ${COLUMNS} FROM reporting_periods
      WHERE direction_id = ? AND period_start <= ? AND period_end >= ? ORDER BY period_start DESC LIMIT 1`,
    [direction.id, today, today],
  ));
  if (existing) return { ...existing, exists: true };
  const b = periodBounds(direction, today);
  return { start: b.start, end: b.end, planDate: b.end, isClosed: false, isLegacy: false, exists: false };
}

/**
 * Проверить, что за период можно вносить данные, и создать его при необходимости (внутри транзакции).
 * Правила: период не в будущем; не закрыт; новый период — только текущий (пропуски не создаём задним числом).
 */
export async function ensureEditablePeriod(conn, direction, start, today = todayIso()) {
  if (dayMs(start) > dayMs(today)) throw badRequest('Нельзя вносить данные за будущий период');
  const existing = await getPeriod(direction, start, conn);
  if (existing) {
    if (existing.isClosed) throw new HttpError(409, `Период с ${start} закрыт администратором — изменения запрещены`);
    return existing;
  }
  const current = await currentPeriod(direction, today);
  if (current.exists || current.start !== start) {
    throw badRequest(`Новый период можно открыть только текущий (с ${current.start}). Период с ${start} не существует.`);
  }
  if (!isPeriodStart(direction, start)) throw badRequest(`${start} — не день начала отчётного периода`);
  await query(
    `INSERT INTO reporting_periods (direction_id, period_start, period_end, plan_date, is_legacy, is_closed)
     VALUES (?, ?, ?, ?, 0, 0)`,
    [direction.id, current.start, current.end, current.end], conn,
  );
  return { ...current, exists: true };
}

/**
 * Период для ПРОСМОТРА: указанный (должен существовать) или последний, начавшийся не позже сегодня.
 * Возвращает строку в «базовом» виде { period_start, period_end, plan_date, is_legacy, is_closed }.
 */
export async function resolveViewPeriod(direction, start) {
  const row = await queryOne(
    `SELECT period_start, period_end, plan_date, is_legacy, is_closed FROM reporting_periods
      WHERE direction_id = ? AND ${start ? 'period_start = ?' : 'period_start <= ? ORDER BY period_start DESC LIMIT 1'}`,
    [direction.id, start ?? todayIso()],
  );
  if (!row) throw new HttpError(404, start ? `Отчётного периода с ${start} нет` : 'Отчётных периодов ещё нет');
  return row;
}

/** Период для ответа интерфейсу. */
export const periodOut = (p) => ({
  start: p.period_start, end: p.period_end, planDate: p.plan_date,
  isLegacy: Boolean(p.is_legacy), isClosed: Boolean(p.is_closed),
});

/** Закрыть / открыть период (администратор). */
export async function setPeriodClosed(direction, start, closed, user) {
  const r = await query(
    `UPDATE reporting_periods SET is_closed = ?, closed_by = ?, closed_at = ${closed ? 'NOW()' : 'NULL'}
      WHERE direction_id = ? AND period_start = ?`,
    [closed ? 1 : 0, closed ? user.id : null, direction.id, start],
  );
  return r.affectedRows > 0;
}
