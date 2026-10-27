// =====================================================================
//  kpi/index.js — единая точка входа для показателей направлений и «Сводки».
//
//    computeKpi('mkd', '2026-10-27')  → показатели направления на дату (формат — docs/01-architecture.md, §1.9)
//    getOverview(user, date)          → сводка по всем направлениям, доступным пользователю
//    saveSnapshot(direction, kpi, d)  → сохранить в kpi_snapshots (история для графиков)
// =====================================================================

import { query, queryOne } from '../../db.js';
import { getDirectionByCode, describeAccess } from '../access.js';
import { todayIso } from './common.js';
import { computeSchoolsKpi } from './schools.js';
import { computeMkdKpi } from './mkd.js';
import { computeNetworksKpi } from './networks.js';
import { computeStreetsKpi } from './streets.js';

const CALCULATORS = {
  schools: computeSchoolsKpi,
  mkd: computeMkdKpi,
  networks: computeNetworksKpi,
  streets: computeStreetsKpi,
};

/** Показатели направления на дату. null — данных ещё нет. */
export async function computeKpi(code, date = todayIso()) {
  const direction = await getDirectionByCode(code);
  return CALCULATORS[code](direction, date);
}

/**
 * Под какой датой хранить снимок. Школы считают план «на сегодня», поэтому снимок — на дату расчёта;
 * остальные — на дату своей отчётной точки (начало периода, дата отчёта).
 */
export function snapshotDate(direction, kpi, date) {
  return direction.cycle === 'daily' ? date : kpi.asOf;
}

/** Сохранить (или обновить) снимок показателей. */
export async function saveSnapshot(direction, kpi, date, db) {
  if (!kpi) return;
  await query(
    `INSERT INTO kpi_snapshots (direction_id, as_of, fact, plan, payload) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE fact = VALUES(fact), plan = VALUES(plan), payload = VALUES(payload), computed_at = NOW()`,
    [direction.id, snapshotDate(direction, kpi, date), kpi.fact, kpi.plan, JSON.stringify(kpi)],
    db,
  );
}

/** Пороги статуса направления в «Сводке» (п.п.): по умолчанию 2 и 10. */
async function summaryThresholds() {
  const row = await queryOne("SELECT setting_value FROM app_settings WHERE setting_key = 'summary.thresholds'");
  const v = typeof row?.setting_value === 'string' ? JSON.parse(row.setting_value) : row?.setting_value;
  return { warn: Number(v?.warn ?? 2), crit: Number(v?.crit ?? 10) };
}

/** Статус направления: отклонение факт − план < −crit п.п. — критично, < −warn — отставание. */
export function directionStatus(kpi, thr) {
  if (!kpi) return 'empty';
  if (kpi.plan == null || kpi.fact == null) return 'na';
  const d = kpi.fact - kpi.plan;
  if (d < -thr.crit / 100) return 'crit';
  if (d < -thr.warn / 100) return 'warn';
  return 'ok';
}

/** «Сводка» для пользователя: только видимые ему направления. Попутно обновляет снимки. */
export async function getOverview(user, date = todayIso()) {
  const thresholds = await summaryThresholds();
  const visible = await describeAccess(user);
  const directions = [];
  for (const d of visible) {
    const direction = await getDirectionByCode(d.code);
    const kpi = await CALCULATORS[d.code](direction, date);
    await saveSnapshot(direction, kpi, date);
    directions.push({
      code: d.code,
      name: d.name,
      unitLabel: d.unitLabel,
      cycle: d.cycle,
      canEdit: d.canEdit,
      status: directionStatus(kpi, thresholds),
      deviation: kpi && kpi.plan != null ? kpi.fact - kpi.plan : null,
      kpi,
    });
  }
  return { date, thresholds, directions };
}

/** История снимков направления (для графика «динамика»). */
export async function kpiHistory(code) {
  const direction = await getDirectionByCode(code);
  return query(
    'SELECT as_of AS asOf, fact, plan, computed_at AS computedAt FROM kpi_snapshots WHERE direction_id = ? ORDER BY as_of',
    [direction.id],
  );
}
