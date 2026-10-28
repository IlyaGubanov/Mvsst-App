// =====================================================================
//  «Капремонт школ» — расчёт состояния и KPI (формулы из schools.html).
//
//  Выполнение вида работ  = факт объёма / проект (не больше 100 %), а если объёма нет — введённый %
//  Готовность школы       = Σ (вес вида работ × выполнение)
//  Готовность по всем     = Σ (вес × среднее выполнение вида по школам)
//  Готовность группы      = то же, но только по видам группы и делённое на сумму их весов
//  План на дату           = Σ (вес × линейный план вида между его началом и окончанием)
//  Статус школы           : факт ≥ 99,9 % — выполнено; отклонение < −10 п.п. — критично; < −2 п.п. — отставание
//  Отставание, дн.        = на сколько дней назад отмотать график, чтобы план сравнялся с фактом
//
//  История выполнения хранится по дням (sch_work_progress): на любую дату берётся последняя запись не позже неё.
//  computeSchoolsState() — общий расчёт для «Сводки», обзора, карточки школы; sCurve() — S-кривая.
// =====================================================================

import { query } from '../../db.js';
import { addDays, dayMs, isoDay, linearPlan, sum, stableSortBy } from './common.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Шкала графика в прежнем модуле: с 01.05.2026 по 30.04.2027 (расширяется, если работы выходят за неё)
const TIMELINE = { start: '2026-05-01', end: '2027-04-30' };

const fmtPct0 = (x) => Number((x || 0) * 100).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' %';

/** Справочник видов работ — в порядке прежнего модуля (по порядку, затем по коду). */
export function loadWorkTypes() {
  return query(`SELECT id, code, name, group_name, weight, plan_start, plan_end, unit, sort_order
                  FROM sch_work_types ORDER BY sort_order, code`);
}

/**
 * Все записи истории выполнения не позже даты + проектные объёмы.
 * Возвращает функцию entriesAt(d): Map('школа|вид' → { pct, fact_volume, plan_volume, report_date, entered_by })
 * — последнюю запись не позже d по каждой паре.
 */
async function loadProgress(date, objectId) {
  const rows = await query(
    `SELECT p.object_id, p.work_type_id, p.report_date, p.pct, p.fact_volume, p.source,
            ow.plan_volume, u.full_name AS entered_by
       FROM sch_work_progress p
       JOIN sch_object_works ow ON ow.object_id = p.object_id AND ow.work_type_id = p.work_type_id
       LEFT JOIN users u ON u.id = p.entered_by
      WHERE p.report_date <= ? ${objectId ? 'AND p.object_id = ?' : ''}
      ORDER BY p.report_date`,
    objectId ? [date, objectId] : [date],
  );
  const dates = [...new Set(rows.map((r) => r.report_date))];
  const entriesAt = (d) => {
    const m = new Map();
    for (const r of rows) { if (r.report_date <= d) m.set(`${r.object_id}|${r.work_type_id}`, r); }
    return m;
  };
  return { rows, dates, entriesAt };
}

/** Выполнение вида работ на школе по записи истории (доля 0..1). */
export function factOfEntry(e) {
  if (!e) return 0;
  if (e.plan_volume > 0 && e.fact_volume !== null && e.fact_volume !== undefined) return Math.min(1, e.fact_volume / e.plan_volume);
  return Number(e.pct) || 0;
}

/** Набор формул над справочником работ: план, факт, группы, статус, отставание в днях. */
export function makeModel(works, direction) {
  const weight = (w) => Number(w.weight) || 0;
  const planW = (w, at) => linearPlan(w.plan_start, w.plan_end, at) ?? 0;
  const groups = [...new Set(works.map((w) => w.group_name || 'Прочее'))];
  const thr = { warn: direction.thrWarn / 100, crit: direction.thrCrit / 100 };

  const model = {
    groups,
    planAt: (at) => sum(works.map((w) => weight(w) * planW(w, at))),
    /** Готовность по набору школ: factOf(objectId, work) → доля. */
    factOf: (objectIds, factOf) => sum(works.map((w) => weight(w) * (objectIds.length ? sum(objectIds.map((id) => factOf(id, w))) / objectIds.length : 0))),
    groupPlan: (g, at) => {
      const ws = works.filter((w) => (w.group_name || 'Прочее') === g);
      const s = sum(ws.map(weight));
      return s ? sum(ws.map((w) => weight(w) * planW(w, at))) / s : 0;
    },
    groupFact: (g, objectIds, factOf) => {
      const ws = works.filter((w) => (w.group_name || 'Прочее') === g);
      const s = sum(ws.map(weight));
      if (!s || !objectIds.length) return 0;
      return sum(ws.map((w) => weight(w) * sum(objectIds.map((id) => factOf(id, w))) / objectIds.length)) / s;
    },
    status: (f, p) => {
      const d = f - p;
      if (f >= 0.999) return 'done';
      if (p === 0 && f === 0) return 'wait';
      if (d < -thr.crit) return 'crit';
      if (d < -thr.warn) return 'warn';
      return 'ok';
    },
    timeline: () => {
      const starts = works.filter((w) => w.plan_start).map((w) => dayMs(w.plan_start));
      const ends = works.filter((w) => w.plan_end).map((w) => dayMs(w.plan_end) + 5 * DAY_MS);
      return { start: isoDay(Math.min(dayMs(TIMELINE.start), ...starts)), end: isoDay(Math.max(dayMs(TIMELINE.end), ...ends)) };
    },
  };
  /** На сколько дней отстаёт факт f от графика на дату date. */
  model.lagDays = (f, date) => {
    if (f >= model.planAt(date)) return 0;
    const today = dayMs(date);
    const t0 = dayMs(model.timeline().start);
    for (let t = t0; t <= today; t += DAY_MS) {
      if (model.planAt(isoDay(t)) >= f) return Math.round((today - t) / DAY_MS);
    }
    return Math.round((today - t0) / DAY_MS);
  };
  return model;
}

/**
 * Состояние школ на дату.
 * @param {string} date — «сегодня» для плана и последняя дата учёта истории
 * @param {object} [opts] — { objectId } — только одна школа
 */
export async function computeSchoolsState(direction, date, opts = {}) {
  const one = opts.objectId ? 'AND o.id = ?' : '';
  const args = opts.objectId ? [opts.objectId] : [];
  const [objects, works, progress, resources, deliveries] = await Promise.all([
    query(
      `SELECT o.*, e.status AS mge_status FROM sch_objects o LEFT JOIN sch_expertise e ON e.object_id = o.id
        WHERE o.archived = 0 ${one} ORDER BY o.sort_order, o.id`,
      args,
    ),
    loadWorkTypes(),
    loadProgress(date, opts.objectId),
    query(
      `SELECT r.object_id, r.report_date, r.people, r.tech, r.people_landscape, r.tech_landscape
         FROM sch_daily_resources r
         JOIN (SELECT object_id, MAX(report_date) AS d FROM sch_daily_resources WHERE report_date <= ? GROUP BY object_id) l
           ON l.object_id = r.object_id AND l.d = r.report_date`,
      [date],
    ),
    query(
      `SELECT m.object_id, m.delivery_date, m.delivered_pct, m.done_date, m.installed_pct
         FROM sch_object_materials m JOIN sch_objects o ON o.id = m.object_id WHERE o.archived = 0`,
    ),
  ]);

  const model = makeModel(works, direction);
  const entries = progress.entriesAt(date);
  const factOf = (objectId, w) => factOfEntry(entries.get(`${objectId}|${w.id}`));
  const resOf = new Map(resources.map((r) => [r.object_id, r]));
  const P = model.planAt(date);
  const ids = objects.map((o) => o.id);

  const schools = objects.map((o) => {
    const f = model.factOf([o.id], factOf);
    const res = resOf.get(o.id);
    const overdue = deliveries.filter((m) => m.object_id === o.id && m.delivery_date && m.delivery_date < date && (Number(m.delivered_pct) || 0) < 1).length;
    return {
      o, f, p: P, d: f - P, s: model.status(f, P),
      groups: Object.fromEntries(model.groups.map((g) => [g, { fact: model.groupFact(g, [o.id], factOf), plan: model.groupPlan(g, date) }])),
      works: works.map((w) => {
        const e = entries.get(`${o.id}|${w.id}`);
        return { w, e, fact: factOf(o.id, w), plan: linearPlan(w.plan_start, w.plan_end, date) ?? 0 };
      }),
      res, overdue,
      people: res ? res.people + res.people_landscape : 0,
      tech: res ? res.tech + res.tech_landscape : 0,
    };
  });

  const fact = model.factOf(ids, factOf);
  const lastManual = progress.rows.filter((r) => r.source === 'manual').length > 0;
  return {
    date, model, works, schools, progress,
    total: {
      fact, plan: P, dev: fact - P, status: model.status(fact, P), lagDays: model.lagDays(fact, date),
      groups: model.groups.map((g) => ({ name: g, weight: sum(works.filter((w) => (w.group_name || 'Прочее') === g).map((w) => Number(w.weight) || 0)), fact: model.groupFact(g, ids, factOf), plan: model.groupPlan(g, date) })),
      people: sum(schools.map((s) => s.people)),
      tech: sum(schools.map((s) => s.tech)),
      limit: sum(objects.filter((o) => o.limit_total).map((o) => o.limit_total)),
      paid: sum(objects.filter((o) => o.limit_total).map((o) => o.paid)),
      overdueDeliveries: sum(schools.map((s) => s.overdue)),
      mgePositive: objects.filter((o) => /ПОЛОЖ/i.test(o.mge_status || '')).length,
      asOf: [...progress.dates, ...resources.map((r) => r.report_date)].sort().at(-1) ?? date,
      hasManual: lastManual,
    },
  };
}

/**
 * S-кривая: план по всей шкале работ (раз в неделю) и фактические точки — по дням,
 * за которые вносилось выполнение (и на саму дату).
 */
export function sCurve(state, objectIds) {
  const { model, progress, date } = state;
  const ids = objectIds ?? state.schools.map((s) => s.o.id);
  const tl = model.timeline();
  const plan = [];
  for (let d = tl.start; d <= tl.end; d = addDays(d, 7)) plan.push({ date: d, plan: model.planAt(d) });
  const factDates = [...new Set([...progress.dates, date])].filter((d) => d <= date).sort();
  const fact = factDates.map((d) => {
    const entries = progress.entriesAt(d);
    return { date: d, fact: model.factOf(ids, (id, w) => factOfEntry(entries.get(`${id}|${w.id}`))), plan: model.planAt(d) };
  });
  return { timeline: tl, today: date, plan, fact };
}

/** KPI направления для «Сводки» (формат прежнего модуля). */
export async function computeSchoolsKpi(direction, date) {
  const state = await computeSchoolsState(direction, date);
  if (!state.schools.length) return null;
  const { total, schools } = state;
  const lag = stableSortBy(schools.filter((r) => r.f < 0.999 && r.d < -direction.thrWarn / 100), (r) => r.d);

  return {
    asOf: total.asOf,
    asOfKind: total.hasManual ? 'updated' : 'source',
    local: false,
    objects: schools.length,
    unit: direction.unitLabel,
    lagging: lag.length,
    critical: schools.filter((r) => r.s === 'crit').length,
    fact: total.fact,
    plan: total.plan,
    factLabel: 'Готовность ДКР (взвешенная по видам работ)',
    people: total.people,
    tech: total.tech,
    money: { portfolio: total.limit || null, portfolioLabel: 'Лимит', closed: null, paid: total.paid || null },
    kpis: [
      { l: 'Отставание от графика', v: `${total.lagDays} дн.` },
      { l: 'Просрочено поставок', v: String(total.overdueDeliveries) },
      { l: 'Заключения МГЭ', v: `${total.mgePositive} из ${schools.length}` },
    ],
    attention: lag.slice(0, 8).map((r) => ({
      id: r.o.id, code: r.o.code, name: r.o.short_name,
      sub: `факт ${fmtPct0(r.f)} · план ${fmtPct0(total.plan)}`, d: r.d, crit: r.s === 'crit',
    })),
  };
}
