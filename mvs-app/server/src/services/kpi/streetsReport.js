// =====================================================================
//  «Благоустройство улиц» — отчёт целиком, сравнение с другим отчётом, история по отчётам.
//  (KPI для «Сводки» — в streets.js; здесь — расчёты для раздела направления.)
//
//  Позиция = объект × вид работ с проектным объёмом > 0. Состояние позиции:
//    done    — факт ≥ проекта;  partial — факт меньше проекта;  missing — факта нет;  na — не предусмотрено.
//  Сравнение («что изменилось») — с другим отчётом той же программы (по умолчанию — предыдущим):
//    df — прирост факта, dp — изменение проекта; снижение факта (df < 0) — тревожный признак.
// =====================================================================

import { query } from '../../db.js';
import { DONE_STATUSES } from './streets.js';

const EPS = 1e-7;
const isDoneStatus = (s) => DONE_STATUSES.includes(s);
const num = (v) => (v == null ? null : Number(v));
const delta = (a, b) => (a != null && b != null ? Math.round((a - b) * 1000) / 1000 : null);

/** Строки отчёта со значениями: [{ rowId, objectId, status, people, tech, remarks, enteredBy, values: Map(workId → {p, f}) }]. */
export async function loadReportRows(reportId, db) {
  const rows = await query(
    `SELECT ro.id AS rowId, ro.object_id AS objectId, ro.status, ro.people, ro.tech, ro.remarks,
            ro.entered_at AS enteredAt, u.full_name AS enteredBy
       FROM st_report_objects ro LEFT JOIN users u ON u.id = ro.entered_by
      WHERE ro.report_id = ? ORDER BY ro.id`,
    [reportId], db,
  );
  const values = await query(
    `SELECT v.report_object_id AS rowId, v.work_type_id AS workId, v.plan_volume AS p, v.fact_volume AS f
       FROM st_report_values v JOIN st_report_objects ro ON ro.id = v.report_object_id WHERE ro.report_id = ?`,
    [reportId], db,
  );
  const byRow = new Map(rows.map((r) => [r.rowId, { ...r, values: new Map() }]));
  values.forEach((v) => byRow.get(v.rowId)?.values.set(v.workId, { p: num(v.p), f: num(v.f) }));
  return [...byRow.values()];
}

/** Состояние позиции по проекту и факту. */
export function positionState(p, f) {
  if (!(p > 0)) return 'na';
  if (f == null) return 'missing';
  return f + EPS >= p ? 'done' : 'partial';
}

/**
 * Отчёт в виде для интерфейса: объекты с позициями, итоги по видам работ, общие итоги.
 * @param works    справочник видов работ
 * @param rows     строки отчёта (loadReportRows)
 * @param prevRows строки отчёта для сравнения (или null — сравнивать не с чем)
 */
export function describeReport(works, rows, prevRows) {
  const prev = new Map((prevRows ?? []).map((r) => [r.objectId, r]));

  const objects = rows.map((r) => {
    const pr = prev.get(r.objectId);
    const values = {};
    let positions = 0; let done = 0; let partial = 0; let missing = 0; let changed = false; let issue = false;
    for (const [workId, { p, f }] of r.values) {
      const pv = pr?.values.get(workId);
      const state = positionState(p, f);
      const df = pv ? delta(f, pv.f) : null;
      const dp = pv ? delta(p, pv.p) : null;
      if (state !== 'na') {
        positions++;
        if (state === 'done') done++; else if (state === 'partial') partial++; else missing++;
      }
      if ((df != null && df !== 0) || (dp != null && dp !== 0)) changed = true;
      if (df != null && df < 0) issue = true;
      values[workId] = { p, f, state, df, dp };
    }
    const statusChanged = Boolean(pr && (pr.status ?? '') !== (r.status ?? ''));
    return {
      rowId: r.rowId, objectId: r.objectId, status: r.status, complete: isDoneStatus(r.status),
      people: r.people, tech: r.tech, remarks: r.remarks,
      dRemarks: pr ? delta(r.remarks, pr.remarks) : null,
      prevStatus: pr ? pr.status : null, statusChanged,
      positions, done, partial, missing, rate: positions ? done / positions : null,
      changed: changed || statusChanged, issue, values,
      enteredBy: r.enteredBy, enteredAt: r.enteredAt,
    };
  });

  // Итоги по видам работ: Σ проекта и факта по позициям; выполнение = Σ факта / Σ проекта (не больше 100 %)
  const workTotals = works.map((w) => {
    let p = 0; let f = 0; let pf = 0; let positions = 0; let done = 0; let partial = 0; let missing = 0; let df = null;
    for (const o of objects) {
      const v = o.values[w.id];
      if (!v || v.state === 'na') continue;
      positions++;
      p += v.p; f += v.f ?? 0; pf += Math.min(v.f ?? 0, v.p);
      if (v.state === 'done') done++; else if (v.state === 'partial') partial++; else missing++;
      if (v.df != null) df = (df ?? 0) + v.df;
    }
    return {
      id: w.id, code: w.code, name: w.name, unit: w.unit, positions, done, partial, missing,
      p, f, remaining: Math.max(0, p - pf), rate: p ? Math.min(1, f / p) : null, df,
    };
  }).filter((w) => w.positions > 0);

  // Сумма только по объектам, где число указано; null — если не указано ни у кого
  const sumKnown = (list, key) => {
    const vals = list.map((o) => o[key]).filter((x) => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const positions = objects.reduce((a, o) => a + o.positions, 0);
  const positionsDone = objects.reduce((a, o) => a + o.done, 0);
  const remarks = sumKnown(objects, 'remarks');
  const prevRemarks = prevRows ? sumKnown(prevRows, 'remarks') : null;
  return {
    objects,
    works: workTotals,
    total: {
      objects: objects.length,
      complete: objects.filter((o) => o.complete).length,
      withRemainder: objects.filter((o) => !o.complete && (o.partial + o.missing) > 0).length,
      positions, positionsDone, rate: positions ? positionsDone / positions : null,
      remarks, dRemarks: delta(remarks, prevRemarks),
      withRemarks: objects.filter((o) => o.remarks > 0).length,
      people: sumKnown(objects, 'people'), tech: sumKnown(objects, 'tech'),
      changed: objects.filter((o) => o.changed).length,
      issues: objects.filter((o) => o.issue).length,
    },
  };
}

/**
 * История по всем отчётам программы (для графиков «Динамика»).
 * На каждый отчёт: готовность (доля выполненных позиций), Σ проекта и факта по видам работ,
 * замечания, люди, техника (null — если чисел нет ни у одного объекта), сколько завершено по статусу.
 * objectId — только по одному объекту (тогда в точке есть и его статус).
 */
export async function streetsHistory(program, objectId) {
  const one = objectId ? 'AND ro.object_id = ?' : '';
  const args = objectId ? [program, objectId] : [program];
  const [reports, rows, values] = await Promise.all([
    query('SELECT id, report_date AS date, source FROM st_reports WHERE program = ? ORDER BY report_date', [program]),
    query(
      `SELECT ro.report_id, ro.status, ro.people, ro.tech, ro.remarks FROM st_report_objects ro
         JOIN st_reports r ON r.id = ro.report_id WHERE r.program = ? ${one}`,
      args,
    ),
    query(
      `SELECT ro.report_id, v.work_type_id AS workId,
              SUM(CASE WHEN v.plan_volume > 0 THEN v.plan_volume END) AS p,
              SUM(CASE WHEN v.plan_volume > 0 THEN v.fact_volume END) AS f,
              SUM(v.plan_volume > 0) AS n,
              SUM(v.plan_volume > 0 AND v.fact_volume + ${EPS} >= v.plan_volume) AS done
         FROM st_report_values v
         JOIN st_report_objects ro ON ro.id = v.report_object_id
         JOIN st_reports r ON r.id = ro.report_id
        WHERE r.program = ? ${one}
        GROUP BY ro.report_id, v.work_type_id`,
      args,
    ),
  ]);
  const series = new Map(reports.map((r) => [r.id, {
    reportId: r.id, date: r.date, source: r.source, objects: 0, complete: 0,
    remarks: null, people: null, tech: null, positions: 0, done: 0, works: {},
  }]));
  const add = (s, key, v) => { if (v != null) s[key] = (s[key] ?? 0) + Number(v); };
  rows.forEach((r) => {
    const s = series.get(r.report_id);
    s.objects++;
    if (isDoneStatus(r.status)) s.complete++;
    add(s, 'remarks', r.remarks); add(s, 'people', r.people); add(s, 'tech', r.tech);
    if (objectId) s.status = r.status;
  });
  values.forEach((v) => {
    const s = series.get(v.report_id);
    if (!(Number(v.n) > 0)) return;
    s.positions += Number(v.n); s.done += Number(v.done);
    s.works[v.workId] = { p: num(v.p), f: num(v.f) };
  });
  return [...series.values()]
    .filter((s) => s.objects > 0)
    .map((s) => ({ ...s, rate: s.positions ? s.done / s.positions : null }));
}
