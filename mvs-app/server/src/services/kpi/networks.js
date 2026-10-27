// =====================================================================
//  «Сети, коллекторы, водные объекты» — расчёт состояния и KPI (формулы из networks.html).
//
//  Данные объекта на период — последняя запись НЕ ПОЗЖЕ периода (как entry() в модуле):
//  берётся строка net_object_period и факт линий ЗА ТОТ ЖЕ период.
//  Поэтому ввод за период всегда сохраняет ПОЛНЫЙ снимок объекта: все линии + КС, рабочие, техника.
//  Факт объекта: все линии в одних единицах → Σ min(факт, проект) / Σ проект;
//                единицы разные → среднее из долей по линиям.
//  План объекта — линейно между началом и окончанием на дату плана периода.
//  Итог — взвешен стоимостью договоров объекта (без договоров — вес 1).
//  Статус: факт ≥ 99,5 % — выполнено; план и факт ≈ 0 — не начато;
//          отклонение ≥ −5 п.п. — в графике; ≥ −15 п.п. — отставание; иначе — критично.
//
//  computeNetworksState() — общий расчёт для «Сводки», реестра и карточки объекта.
//  objectSeries()         — динамика одного объекта по всем отчётным периодам.
// =====================================================================

import { query } from '../../db.js';
import { linearPlan, sum, nf0, moneyShort, stableSortBy } from './common.js';
import { periodAt } from './mkd.js';

const pct = (x) => Math.round(x * 100) + '%';

/** Факт объекта (доля 0..1) по его линиям; factOf(line) — факт линии. */
export function factPct(lines, factOf) {
  if (!lines.length) return 0;
  if (lines.every((l) => l.unit === lines[0].unit)) {
    let p = 0; let f = 0;
    lines.forEach((l) => { const plan = Number(l.plan_volume) || 0; p += plan; f += Math.min(factOf(l), plan); });
    return p ? f / p : 0;
  }
  return sum(lines.map((l) => (l.plan_volume ? Math.min(1, factOf(l) / l.plan_volume) : 0))) / lines.length;
}

export function makeStat(direction) {
  return (f, p) => {
    if (f >= 0.995) return 'done';
    if (p < 0.005 && f < 0.005) return 'wait';
    const d = f - p;
    if (d >= -direction.thrWarn / 100) return 'ok';
    if (d >= -direction.thrCrit / 100) return 'warn';
    return 'crit';
  };
}

/** Линии объектов: Map(objectId → [{ id, code, plan_volume, unit, label, kind_name, diameter, sn }]). */
async function loadLines(objectId) {
  const lines = await query(
    `SELECT l.id, l.object_id, l.code, l.label, l.plan_volume, l.diameter, l.sn, COALESCE(k.unit, l.unit) AS unit, k.name AS kind_name
       FROM net_lines l LEFT JOIN net_work_kinds k ON k.id = l.kind_id
      ${objectId ? 'WHERE l.object_id = ?' : ''} ORDER BY l.object_id, l.sort_order, l.id`,
    objectId ? [objectId] : [],
  );
  const map = new Map();
  for (const l of lines) {
    if (!map.has(l.object_id)) map.set(l.object_id, []);
    map.get(l.object_id).push(l);
  }
  return map;
}

/**
 * Состояние «Сетей» на период.
 * @param {object} period — { period_start, plan_date }
 * @param {object} [opts] — { objectId } — только один объект
 */
export async function computeNetworksState(direction, period, opts = {}) {
  const one = opts.objectId ? 'AND o.id = ?' : '';
  const args = opts.objectId ? [opts.objectId] : [];
  const objects = await query(
    `SELECT o.id, o.code, o.seq_no, o.section_id, o.name, o.short_name, o.source_status, o.plan_start, o.plan_end,
            o.sub_org_id, o.designer_org_id, o.curator_person_id, s.code AS section_code,
            COALESCE(s.short_title, s.title) AS section
       FROM net_objects o JOIN net_sections s ON s.id = o.section_id
      WHERE o.archived = 0 ${one} ORDER BY o.id`,
    args,
  );
  const money = new Map((await query(
    `SELECT object_id, SUM(cost) AS cost, SUM(advance) AS adv, COUNT(*) AS n FROM net_contracts
      ${opts.objectId ? 'WHERE object_id = ?' : ''} GROUP BY object_id`,
    args,
  )).map((r) => [r.object_id, r]));
  const linesOf = await loadLines(opts.objectId);
  // Последний период с данными для каждого объекта (не позже выбранного)
  const entries = new Map((await query(
    `SELECT p.object_id, p.period_start, p.ks_closed, p.workers, p.machines, p.entered_at,
            u.full_name AS entered_by
       FROM net_object_period p
       JOIN (SELECT object_id, MAX(period_start) AS ps FROM net_object_period WHERE period_start <= ? GROUP BY object_id) l
         ON l.object_id = p.object_id AND l.ps = p.period_start
       LEFT JOIN users u ON u.id = p.entered_by`,
    [period.period_start],
  )).map((e) => [e.object_id, e]));
  const facts = new Map((await query(
    `SELECT f.line_id, f.period_start, f.fact_volume FROM net_line_fact f
      ${opts.objectId ? 'JOIN net_lines l ON l.id = f.line_id AND l.object_id = ?' : ''}
      WHERE f.period_start <= ?`,
    [...args, period.period_start],
  )).map((f) => [`${f.line_id}|${f.period_start}`, Number(f.fact_volume) || 0]));

  const stat = makeStat(direction);
  const rows = objects.map((o) => {
    const e = entries.get(o.id) ?? { period_start: null, ks_closed: 0, workers: 0, machines: 0 };
    const lines = linesOf.get(o.id) ?? [];
    const factOf = (l) => (e.period_start ? facts.get(`${l.id}|${e.period_start}`) ?? 0 : 0);
    const f = factPct(lines, factOf);
    const p = linearPlan(o.plan_start, o.plan_end, period.plan_date) ?? 0;
    const m = money.get(o.id);
    return {
      o, e, f, p, d: f - p, s: stat(f, p),
      cost: Number(m?.cost) || 0, adv: Number(m?.adv) || 0, contracts: Number(m?.n) || 0,
      ks: Number(e.ks_closed) || 0, workers: e.workers || 0, machines: e.machines || 0,
      lines: lines.map((l) => ({ ...l, fact: factOf(l) })),
      pmLen: sum(lines.filter((l) => l.unit === 'п.м').map(factOf)),
    };
  });

  return { period, rows, total: aggregate(rows) };
}

/** Итоги по набору объектов: взвешенные факт/план, деньги, люди, статусы. */
export function aggregate(rows) {
  const weight = sum(rows.map((r) => r.cost || 1));
  const st = { done: 0, ok: 0, warn: 0, crit: 0, wait: 0 };
  rows.forEach((r) => st[r.s]++);
  return {
    n: rows.length,
    fact: weight ? sum(rows.map((r) => (r.cost || 1) * r.f)) / weight : 0,
    plan: weight ? sum(rows.map((r) => (r.cost || 1) * r.p)) / weight : 0,
    cost: sum(rows.map((r) => r.cost)),
    adv: sum(rows.map((r) => r.adv)),
    ks: sum(rows.map((r) => r.ks)),
    workers: sum(rows.map((r) => r.workers)),
    machines: sum(rows.map((r) => r.machines)),
    pmLen: sum(rows.map((r) => r.pmLen)),
    statuses: st,
  };
}

/** Динамика объекта по всем отчётным периодам (до сегодняшнего включительно). */
export async function objectSeries(direction, objectId) {
  const [periods, [object], linesMap, entries, facts] = await Promise.all([
    query('SELECT period_start, plan_date FROM reporting_periods WHERE direction_id = ? ORDER BY period_start', [direction.id]),
    query('SELECT plan_start, plan_end FROM net_objects WHERE id = ?', [objectId]),
    loadLines(objectId),
    query('SELECT period_start, ks_closed, workers, machines FROM net_object_period WHERE object_id = ? ORDER BY period_start', [objectId]),
    query('SELECT f.line_id, f.period_start, f.fact_volume FROM net_line_fact f JOIN net_lines l ON l.id = f.line_id WHERE l.object_id = ?', [objectId]),
  ]);
  const lines = linesMap.get(objectId) ?? [];
  const factMap = new Map(facts.map((f) => [`${f.line_id}|${f.period_start}`, Number(f.fact_volume) || 0]));
  return periods.map((p) => {
    const e = [...entries].reverse().find((x) => x.period_start <= p.period_start);
    const factOf = (l) => (e ? factMap.get(`${l.id}|${e.period_start}`) ?? 0 : 0);
    return {
      period: p.period_start,
      fact: factPct(lines, factOf),
      plan: linearPlan(object.plan_start, object.plan_end, p.plan_date) ?? 0,
      ks: Number(e?.ks_closed) || 0,
      workers: e?.workers ?? 0,
      machines: e?.machines ?? 0,
      reported: e?.period_start === p.period_start, // были ли данные именно за этот период
      lines: Object.fromEntries(lines.map((l) => [l.id, factOf(l)])),
    };
  });
}

/** KPI направления для «Сводки». */
export async function computeNetworksKpi(direction, date) {
  const period = await periodAt(direction, date);
  if (!period) return null;
  const { rows, total } = await computeNetworksState(direction, period);
  const lag = stableSortBy(rows.filter((r) => r.s === 'warn' || r.s === 'crit'), (r) => r.d);

  return {
    asOf: period.period_start,
    asOfKind: period.is_legacy ? 'week' : 'period',
    local: false,
    objects: rows.length,
    unit: direction.unitLabel,
    lagging: total.statuses.warn + total.statuses.crit,
    critical: total.statuses.crit,
    fact: total.fact,
    plan: total.plan,
    factLabel: 'Выполнение (взвешенное по стоимости договоров)',
    people: total.workers,
    tech: total.machines,
    money: { portfolio: total.cost, portfolioLabel: 'Договоры', closed: total.ks, paid: null },
    kpis: [
      { l: 'Проложено и отремонтировано', v: `${nf0.format(total.pmLen)} п.м` },
      { l: 'Выполнено объектов', v: String(total.statuses.done) },
      { l: 'Аванс выплачен', v: moneyShort(total.adv) },
    ],
    attention: lag.slice(0, 8).map((r) => ({
      id: r.o.id, code: r.o.code, name: r.o.short_name,
      sub: `${r.o.section} · факт ${pct(r.f)} · план ${pct(r.p)}`, d: r.d, crit: r.s === 'crit',
    })),
  };
}
