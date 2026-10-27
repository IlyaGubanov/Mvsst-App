// =====================================================================
//  KPI «Капремонт школ» — перенос формул из schools.html (__orgCollect).
//
//  Готовность школы   = Σ (вес вида работ × выполнение вида работ)
//  Выполнение вида    = факт объёма / проект (не больше 100 %), а если объёмов нет — введённый %
//  Готовность по всем = Σ (вес × среднее выполнение вида по школам)
//  План на дату       = Σ (вес × линейный план вида работ между его началом и окончанием)
//  Статус школы       : факт ≥ 99,9 % — выполнено; отклонение < −10 п.п. — критично; < −2 п.п. — отставание
//  Отставание, дн.    = на сколько дней назад отмотать график, чтобы план сравнялся с фактом
// =====================================================================

import { query } from '../../db.js';
import { dayMs, linearPlan, sum, stableSortBy } from './common.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Начало шкалы графика в прежнем модуле (если виды работ начинаются раньше — берётся раньшее)
const TIMELINE_START = '2026-05-01';

// Перед «%» — узкий неразрывный пробел (U+202F), как в прежнем модуле школ: «10 %»
const fmtPct0 = (x) => Number((x || 0) * 100).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' %';

async function loadData(date) {
  const objects = await query(
    `SELECT o.id, o.code, o.short_name, o.limit_total, o.paid, e.status AS mge_status
       FROM sch_objects o LEFT JOIN sch_expertise e ON e.object_id = o.id
      WHERE o.archived = 0 ORDER BY o.sort_order, o.id`,
  );
  const works = await query('SELECT id, code, weight, plan_start, plan_end FROM sch_work_types ORDER BY sort_order, code');

  // Выполнение на дату: последняя запись истории не позже даты + проектный объём
  const progress = await query(
    `SELECT ow.object_id, ow.work_type_id, ow.plan_volume, p.pct, p.fact_volume
       FROM sch_object_works ow
       JOIN (SELECT object_id, work_type_id, MAX(report_date) AS d
               FROM sch_work_progress WHERE report_date <= ? GROUP BY object_id, work_type_id) last
         ON last.object_id = ow.object_id AND last.work_type_id = ow.work_type_id
       JOIN sch_work_progress p
         ON p.object_id = last.object_id AND p.work_type_id = last.work_type_id AND p.report_date = last.d`,
    [date],
  );
  const resources = await query(
    `SELECT r.object_id, r.people + r.people_landscape AS people, r.tech + r.tech_landscape AS tech
       FROM sch_daily_resources r
       JOIN (SELECT object_id, MAX(report_date) AS d FROM sch_daily_resources WHERE report_date <= ? GROUP BY object_id) l
         ON l.object_id = r.object_id AND l.d = r.report_date`,
    [date],
  );
  const deliveries = await query(
    `SELECT m.delivery_date, m.delivered_pct
       FROM sch_object_materials m JOIN sch_objects o ON o.id = m.object_id WHERE o.archived = 0`,
  );
  const [stamp] = await query(
    `SELECT MAX(d) AS last_date, MAX(is_manual) AS has_manual FROM (
       SELECT report_date AS d, source = 'manual' AS is_manual FROM sch_work_progress WHERE report_date <= ?
       UNION ALL
       SELECT report_date, source = 'manual' FROM sch_daily_resources WHERE report_date <= ?) x`,
    [date, date],
  );
  return { objects, works, progress, resources, deliveries, stamp };
}

/**
 * @param {object} direction — строка из directions (пороги thrWarn/thrCrit)
 * @param {string} date      — «сегодня» для расчёта плана, 'ГГГГ-ММ-ДД'
 */
export async function computeSchoolsKpi(direction, date) {
  const { objects, works, progress, resources, deliveries, stamp } = await loadData(date);
  if (!objects.length) return null;

  // Быстрый доступ: «школа|вид работ» → запись выполнения
  const byKey = new Map(progress.map((p) => [`${p.object_id}|${p.work_type_id}`, p]));
  const factOf = (o, w) => {
    const e = byKey.get(`${o.id}|${w.id}`);
    if (!e) return 0;
    if (e.plan_volume > 0 && e.fact_volume !== null) return Math.min(1, e.fact_volume / e.plan_volume);
    return Number(e.pct) || 0;
  };
  const factW = (w, objs) => (objs.length ? sum(objs.map((o) => factOf(o, w))) / objs.length : 0);
  const totalFact = (objs) => sum(works.map((w) => (Number(w.weight) || 0) * factW(w, objs)));
  const planW = (w, at) => linearPlan(w.plan_start, w.plan_end, at) ?? 0;
  const totalPlan = (at) => sum(works.map((w) => (Number(w.weight) || 0) * planW(w, at)));

  const thr = { warn: direction.thrWarn / 100, crit: direction.thrCrit / 100 };
  const status = (f, p) => {
    const d = f - p;
    if (f >= 0.999) return 'done';
    if (p === 0 && f === 0) return 'wait';
    if (d < -thr.crit) return 'crit';
    if (d < -thr.warn) return 'warn';
    return 'ok';
  };

  const f = totalFact(objects);
  const P = totalPlan(date);
  const rows = objects.map((o) => {
    const of = totalFact([o]);
    return { o, f: of, d: of - P, st: status(of, P) };
  });
  const lag = stableSortBy(rows.filter((r) => r.f < 0.999 && r.d < -thr.warn), (r) => r.d);

  // Отставание в днях: ищем первый день, когда план графика достиг текущего факта
  const lagDays = () => {
    if (f >= P) return 0;
    const today = dayMs(date);
    const starts = works.filter((w) => w.plan_start).map((w) => dayMs(w.plan_start));
    const t0 = Math.min(dayMs(TIMELINE_START), ...starts);
    for (let t = t0; t <= today; t += DAY_MS) {
      if (totalPlan(new Date(t).toISOString().slice(0, 10)) >= f) return Math.round((today - t) / DAY_MS);
    }
    return Math.round((today - t0) / DAY_MS);
  };

  // Просроченные поставки: плановая дата поставки прошла, а поставлено меньше 100 %
  const overdueDeliveries = deliveries.filter((m) => m.delivery_date && dayMs(m.delivery_date) < dayMs(date) && (Number(m.delivered_pct) || 0) < 1).length;
  const mgePositive = objects.filter((o) => /ПОЛОЖ/i.test(o.mge_status || '')).length;

  const finObjects = objects.filter((o) => o.limit_total);
  const limit = sum(finObjects.map((o) => o.limit_total));
  const paid = sum(finObjects.map((o) => o.paid));

  return {
    asOf: stamp.last_date ?? date,
    asOfKind: stamp.has_manual ? 'updated' : 'source',
    local: false,
    objects: objects.length,
    unit: direction.unitLabel,
    lagging: lag.length,
    critical: rows.filter((r) => r.st === 'crit').length,
    fact: f,
    plan: P,
    factLabel: 'Готовность ДКР (взвешенная по видам работ)',
    people: sum(resources.map((r) => r.people)),
    tech: sum(resources.map((r) => r.tech)),
    money: { portfolio: limit || null, portfolioLabel: 'Лимит', closed: null, paid: paid || null },
    kpis: [
      { l: 'Отставание от графика', v: `${lagDays()} дн.` },
      { l: 'Просрочено поставок', v: String(overdueDeliveries) },
      { l: 'Заключения МГЭ', v: `${mgePositive} из ${objects.length}` },
    ],
    attention: lag.slice(0, 8).map((r) => ({
      id: r.o.id, code: r.o.code, name: r.o.short_name,
      sub: `факт ${fmtPct0(r.f)} · план ${fmtPct0(P)}`, d: r.d, crit: r.st === 'crit',
    })),
  };
}
