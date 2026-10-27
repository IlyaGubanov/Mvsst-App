// =====================================================================
//  «Капремонт МКД» — расчёт состояния и KPI (формулы из mkd.html: calcItem, agg, objAggs, __orgCollect).
//
//  Позиция на период: последний статус НЕ ПОЗЖЕ периода (если за период не вносили — прежний).
//  КС-2 подписаны / Оплачено = 100 %; «Исключено» в расчётах не участвует.
//  План позиции — линейно по её срокам на дату плана периода (для старых недель — пятница).
//  Готовность адреса и направления — средняя по позициям, взвешенная стоимостью договора.
//  Риск: просрочено — критично; отклонение < −15 п.п. — критично; < −5 п.п. или «Приостановлено» — отставание.
//  В расчётах проценты — числа 0..100, как в прежнем модуле (в базе хранится доля 0..1).
//
//  computeMkdState() — общий расчёт для «Сводки», реестра адресов и карточки адреса.
// =====================================================================

import { query, queryOne } from '../../db.js';
import { dayMs, nf0, nf1, stableSortBy } from './common.js';

const pc = (v) => (v == null || Number.isNaN(v) ? '—' : nf0.format(Math.round(v)) + '%');
const mln = (v) => nf1.format((v || 0) / 1e6);

/** План позиции в процентах 0..100 (или null, если сроков нет). */
function planPct(start, end, at) {
  if (!start || !end) return null;
  if (at <= start) return 0;
  if (at >= end) return 100;
  return (100 * (dayMs(at) - dayMs(start))) / (dayMs(end) - dayMs(start));
}

export function makeRisk(thr) {
  // thr — пороги из directions в п.п. (5 и 15)
  return (lag, flag) => {
    if (lag == null) return 'na';
    if (lag < -thr.crit) return 'crit';
    if (lag < -thr.warn || flag) return 'warn';
    return 'ok';
  };
}

/** Расчёт одной позиции (calcItem прежнего модуля). s — статус (строка mkd_item_status) или undefined. */
export function calcItem(it, s, dRef, riskOf) {
  const st = s?.status || 'plan';
  const done = st === 'ks' || st === 'paid';
  const pct = st === 'excl' ? 0 : done ? 100 : Math.max(0, Math.min(100, (Number(s?.pct) || 0) * 100));
  const plan = st === 'excl' ? null : planPct(it.plan_start, it.plan_end, dRef);
  const base = it.inwork_amount ?? it.contract_amount;
  const ks = Number(s?.ks_amount) || 0;
  const paid = Number(s?.paid_amount) || 0;
  const inworkRem = st === 'excl' || done ? 0 : Math.max(0, base - ks);
  const forecastOpen = Math.max(ks, it.approx_amount ?? base);
  const forecast = st === 'excl' ? 0 : done ? ks : forecastOpen;
  const lag = plan == null ? null : pct - plan;
  const overdue = !!(it.plan_end && it.plan_end < dRef && pct < 100 && st !== 'excl');
  let risk = st === 'excl' ? 'na' : overdue ? 'crit' : riskOf(lag, st === 'stop');
  if (st === 'stop' && risk === 'ok') risk = 'warn';
  return {
    st, done, pct, plan, lag, contract: Number(it.contract_amount) || 0, ks, paid,
    topay: Math.max(0, ks - paid), inworkRem, forecast, forecastOpen, overdue, risk,
  };
}

/** Сложение позиций (agg прежнего модуля). */
export function agg(list, riskOf) {
  const a = { n: 0, contract: 0, ks: 0, paid: 0, topay: 0, inwork: 0, forecast: 0, openForecast: 0, w: 0, wp: 0, wD: 0, wpD: 0, wpl: 0, st: {}, risk: { ok: 0, warn: 0, crit: 0, na: 0 }, overdue: 0 };
  for (const c of list) {
    a.n++; a.contract += c.contract; a.ks += c.ks; a.paid += c.paid; a.topay += c.topay; a.inwork += c.inworkRem; a.forecast += c.forecast;
    if (!c.done && c.st !== 'excl') a.openForecast += c.forecastOpen;
    a.st[c.st] = (a.st[c.st] || 0) + 1; a.risk[c.risk]++; if (c.overdue) a.overdue++;
    if (c.st !== 'excl') {
      a.w += c.contract; a.wp += c.contract * c.pct;
      if (c.plan != null) { a.wD += c.contract; a.wpD += c.contract * c.pct; a.wpl += c.contract * c.plan; }
    }
  }
  a.pct = a.w ? a.wp / a.w : 0;
  a.plan = a.wD ? a.wpl / a.wD : null;
  a.lag = a.wD ? a.wpD / a.wD - a.plan : null;
  a.riskLvl = riskOf(a.lag, a.overdue > 0);
  return a;
}

/** Последний отчётный период, начавшийся не позже даты. */
export function periodAt(direction, date) {
  return queryOne(
    `SELECT period_start, period_end, plan_date, is_legacy, is_closed FROM reporting_periods
      WHERE direction_id = ? AND period_start <= ? ORDER BY period_start DESC LIMIT 1`,
    [direction.id, date],
  );
}

/**
 * Состояние МКД на период: каждая позиция с расчётом и каждый адрес с итогами.
 * @param {object} period — { period_start, plan_date }
 * @param {object} [opts] — { objectId } — только один адрес (для карточки)
 */
export async function computeMkdState(direction, period, opts = {}) {
  const filter = opts.objectId ? 'AND o.id = ?' : '';
  const items = await query(
    `SELECT i.id, i.code, i.item_no, i.object_id, i.work_type_id, i.contract_amount, i.inwork_amount, i.approx_amount,
            i.plan_start, i.plan_end, i.responsible_person_id, i.org_id, i.note,
            o.code AS object_code, o.address, o.section_id, o.curator_person_id, t.code AS type_code
       FROM mkd_items i JOIN mkd_objects o ON o.id = i.object_id JOIN mkd_work_types t ON t.id = i.work_type_id
      WHERE i.archived = 0 AND o.archived = 0 ${filter} ORDER BY i.id`,
    opts.objectId ? [opts.objectId] : [],
  );
  const statuses = await query(
    `SELECT s.item_id, s.period_start, s.status, s.pct, s.ks_amount, s.paid_amount, s.note, s.entered_at,
            COALESCE(u.full_name, p.full_name) AS entered_by
       FROM mkd_item_status s
       JOIN (SELECT item_id, MAX(period_start) AS ps FROM mkd_item_status WHERE period_start <= ? GROUP BY item_id) l
         ON l.item_id = s.item_id AND l.ps = s.period_start
       LEFT JOIN users u ON u.id = s.entered_by_user_id
       LEFT JOIN people p ON p.id = s.entered_by_person_id`,
    [period.period_start],
  );
  const statusOf = new Map(statuses.map((s) => [s.item_id, s]));
  const riskOf = makeRisk({ warn: direction.thrWarn, crit: direction.thrCrit });

  const rows = items.map((it) => {
    const s = statusOf.get(it.id);
    return { it, s, c: calcItem(it, s, period.plan_date, riskOf) };
  });

  // Адреса — в порядке первого появления среди позиций (как groupBy в прежнем модуле)
  const byObject = new Map();
  for (const r of rows) {
    if (!byObject.has(r.it.object_id)) byObject.set(r.it.object_id, { first: r.it, rows: [] });
    byObject.get(r.it.object_id).rows.push(r);
  }
  const objects = [...byObject.values()].map(({ first, rows: rs }) => ({
    id: first.object_id, code: first.object_code, address: first.address,
    sectionId: first.section_id, curatorId: first.curator_person_id,
    rows: rs, a: agg(rs.map((r) => r.c), riskOf),
  }));

  return { period, rows, objects, total: agg(rows.map((r) => r.c), riskOf), riskOf };
}

/** KPI направления для «Сводки». */
export async function computeMkdKpi(direction, date) {
  const period = await periodAt(direction, date);
  if (!period) return null;
  const { objects, total } = await computeMkdState(direction, period);

  const risk = { ok: 0, warn: 0, crit: 0, na: 0 };
  objects.forEach((o) => risk[o.a.riskLvl]++);
  const worst = stableSortBy(
    objects.filter((o) => o.a.lag != null && (o.a.riskLvl === 'crit' || o.a.riskLvl === 'warn')),
    (o) => o.a.lag,
  );

  return {
    asOf: period.period_start,
    asOfKind: period.is_legacy ? 'week' : 'period',
    local: false,
    objects: objects.length,
    unit: direction.unitLabel,
    lagging: risk.warn + risk.crit,
    critical: risk.crit,
    fact: total.pct / 100,
    plan: total.plan == null ? null : total.plan / 100,
    factLabel: 'Физическая готовность (взвешенная по стоимости)',
    people: null,
    tech: null,
    money: { portfolio: total.contract, portfolioLabel: 'Договор', closed: total.ks, paid: total.paid },
    kpis: [
      { l: 'К оплате (КС-2 подписаны)', v: `${mln(total.topay)} млн ₽` },
      { l: 'Просрочено позиций', v: String(total.overdue) },
      { l: 'Позиций в работе', v: String((total.st.work || 0) + (total.st.stop || 0)) },
    ],
    attention: worst.slice(0, 8).map((o) => ({
      id: o.id, code: o.code, name: o.address,
      sub: `факт ${pc(o.a.pct)} · план ${pc(o.a.plan)}`, d: o.a.lag / 100, crit: o.a.riskLvl === 'crit',
    })),
  };
}
