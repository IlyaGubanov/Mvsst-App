// =====================================================================
//  /api/networks — «Сети, коллекторы, водные объекты».
//
//    GET  /api/networks/meta                        разделы, виды работ, периоды, текущий период, мои объекты
//    GET  /api/networks/objects[?period=]           реестр объектов + итоги по разделам на период
//    GET  /api/networks/objects/:id[?period=]       карточка: договоры, линии, динамика по периодам
//    PUT  /api/networks/periods/:start/facts        ввод факта по линиям, КС, рабочих, техники (ответственный, admin)
//    POST /api/networks/periods/:start/close|reopen закрыть / открыть период (admin)
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { editableObjectIds, responsibleByObject } from '../services/access.js';
import { audit } from '../services/audit.js';
import { aggregate, computeNetworksState, objectSeries } from '../services/kpi/networks.js';
import { computeKpi, saveSnapshot } from '../services/kpi/index.js';
import { currentPeriod, ensureEditablePeriod, listPeriods, periodOut, resolveViewPeriod } from '../services/periods.js';
import { addPeriodAdminRoutes, startParams } from './periodAdmin.js';

const router = Router();

const STATUS_NAMES = { done: 'Выполнено', ok: 'В графике', warn: 'Отставание', crit: 'Критично', wait: 'Не начато' };
const periodQuery = z.object({ period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Период — дата ГГГГ-ММ-ДД').optional() });
const idParams = z.object({ id: z.coerce.number().int().positive() });

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const num = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const nameMaps = async () => {
  const [orgs, people] = await Promise.all([
    query('SELECT id, name FROM organizations'),
    query('SELECT id, full_name AS name, is_example FROM people'),
  ]);
  return { org: new Map(orgs.map((o) => [o.id, o.name])), person: new Map(people.map((p) => [p.id, p])) };
};

/** Объект реестра в виде для интерфейса. */
function rowOut(r, names, responsible, editable, period) {
  const o = r.o;
  const curator = names.person.get(o.curator_person_id);
  return {
    id: o.id, code: o.code, seqNo: o.seq_no, sectionId: o.section_id, sectionCode: o.section_code, section: o.section,
    name: o.name, short: o.short_name, sourceStatus: o.source_status, start: o.plan_start, end: o.plan_end,
    status: r.s, fact: r.f, plan: r.p, dev: r.d,
    cost: r.cost, adv: r.adv, ks: r.ks, workers: r.workers, machines: r.machines, contracts: r.contracts,
    lineCount: r.lines.length, pmLen: r.pmLen,
    sub: names.org.get(o.sub_org_id) ?? null, designer: names.org.get(o.designer_org_id) ?? null,
    curator: curator?.name ?? null, curatorIsExample: Boolean(curator?.is_example),
    responsible: responsible.get(o.id) ?? [],
    canEdit: editable === 'all' || editable.has(o.id),
    entryPeriod: r.e.period_start, reportedThisPeriod: r.e.period_start === period.period_start,
  };
}
const totalOut = (t) => ({ ...t, lagging: t.statuses.warn + t.statuses.crit, critical: t.statuses.crit });

// ---------------------------------------------------------------------
// GET /meta
// ---------------------------------------------------------------------
router.get('/meta', async (req, res) => {
  const d = req.direction;
  const [sections, kinds, periods, current, editable] = await Promise.all([
    query('SELECT id, code, title, short_title AS short FROM net_sections ORDER BY sort_order, id'),
    query('SELECT id, code, name, unit, group_name AS groupName FROM net_work_kinds ORDER BY sort_order, id'),
    listPeriods(d),
    currentPeriod(d),
    editableObjectIds(req.user, d),
  ]);
  res.json({
    sections, kinds, periods, currentPeriod: current,
    statuses: Object.entries(STATUS_NAMES).map(([code, name]) => ({ code, name })),
    thresholds: { warn: d.thrWarn, crit: d.thrCrit },
    canEditAll: editable === 'all',
    myObjectIds: editable === 'all' ? [] : [...editable],
    isAdmin: req.user.role === 'admin',
  });
});

// ---------------------------------------------------------------------
// GET /objects — реестр + итоги по разделам
// ---------------------------------------------------------------------
router.get('/objects', validate(periodQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const period = await resolveViewPeriod(d, req.valid.query.period);
  const [state, responsible, editable, names, sections] = await Promise.all([
    computeNetworksState(d, period), responsibleByObject(d), editableObjectIds(req.user, d), nameMaps(),
    query('SELECT id, code, title, short_title AS short FROM net_sections ORDER BY sort_order, id'),
  ]);
  res.json({
    period: periodOut(period),
    total: totalOut(state.total),
    sections: sections.map((s) => ({ ...s, ...totalOut(aggregate(state.rows.filter((r) => r.o.section_id === s.id))) })),
    objects: state.rows.map((r) => rowOut(r, names, responsible, editable, period)),
  });
});

// ---------------------------------------------------------------------
// GET /objects/:id — карточка объекта
// ---------------------------------------------------------------------
router.get('/objects/:id', validate(idParams, 'params'), validate(periodQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const id = req.valid.params.id;
  const info = await queryOne(
    `SELECT id, name, note, note_end, doc_psd, doc_dwg, doc_mge, doc_sogl, doc_sogl_g, doc_order, example_fields, archived
       FROM net_objects WHERE id = ?`,
    [id],
  );
  if (!info) throw notFound('Объект не найден');
  const period = await resolveViewPeriod(d, req.valid.query.period);
  const [state, responsible, editable, names, contracts, series] = await Promise.all([
    computeNetworksState(d, period, { objectId: id }),
    responsibleByObject(d), editableObjectIds(req.user, d), nameMaps(),
    query(
      `SELECT id, contract_no AS no, contract_date AS date, end_date AS end, cost, advance, ks_total AS ks
         FROM net_contracts WHERE object_id = ? ORDER BY sort_order, id`,
      [id],
    ),
    objectSeries(d, id),
  ]);
  const r = state.rows[0];
  if (!r) throw notFound('Объект в архиве');
  const example = typeof info.example_fields === 'string' ? JSON.parse(info.example_fields) : info.example_fields ?? [];

  res.json({
    period: periodOut(period),
    object: {
      ...rowOut(r, names, responsible, editable, period),
      note: info.note, noteEnd: info.note_end,
      docs: { psd: info.doc_psd, dwg: info.doc_dwg, mge: info.doc_mge, sogl: info.doc_sogl, soglG: info.doc_sogl_g, order: info.doc_order },
      exampleFields: example,
      enteredBy: r.e.entered_by ?? null, enteredAt: r.e.entered_at ?? null,
    },
    contracts,
    lines: r.lines.map((l) => ({
      id: l.id, code: l.code, label: l.label, kind: l.kind_name, unit: l.unit, plan: l.plan_volume,
      diameter: l.diameter, sn: l.sn, fact: round3(l.fact), pct: l.plan_volume ? Math.min(1, l.fact / l.plan_volume) : 0,
    })),
    series: series.map((s) => ({ ...s, lines: Object.fromEntries(Object.entries(s.lines).map(([k, v]) => [k, round3(v)])) })),
  });
});

// ---------------------------------------------------------------------
// PUT /periods/:start/facts — ввод за период
// ---------------------------------------------------------------------
const count = z.number({ invalid_type_error: 'Целое число' }).int('Целое число').min(0, 'Не может быть отрицательным').max(10000, 'Слишком много');
const factsBody = z.object({
  objects: z.array(z.object({
    objectId: z.number().int().positive(),
    ks: z.number({ invalid_type_error: 'Сумма — число' }).min(0, 'Не может быть отрицательной').max(1e13),
    workers: count,
    machines: count,
    lines: z.array(z.object({
      lineId: z.number().int().positive(),
      fact: z.number({ invalid_type_error: 'Факт — число' }).min(0, 'Факт не может быть отрицательным').max(1e9),
    })).max(100),
  })).min(1, 'Нет изменений для сохранения').max(200),
});

router.put('/periods/:start/facts', validate(startParams, 'params'), validate(factsBody), async (req, res) => {
  const d = req.direction;
  const start = req.valid.params.start;
  const input = req.body.objects;
  const ids = input.map((x) => x.objectId);
  if (new Set(ids).size !== ids.length) throw badRequest('Один объект передан дважды');

  // Права: только свои объекты (или администратор)
  const editable = await editableObjectIds(req.user, d);
  const objects = await query('SELECT id, short_name, archived FROM net_objects WHERE id IN (?)', [ids]);
  const objById = new Map(objects.map((o) => [o.id, o]));
  const missing = ids.filter((id) => !objById.has(id) || objById.get(id).archived);
  if (missing.length) throw badRequest(`Объекты не найдены или в архиве: ${missing.join(', ')}`);
  const foreign = objects.filter((o) => editable !== 'all' && !editable.has(o.id));
  if (foreign.length) throw forbidden(`Вы не ответственный за объект: ${foreign.map((o) => o.short_name).join('; ')}`);

  // Линии должны принадлежать своему объекту
  const lines = await query('SELECT id, object_id, label, unit FROM net_lines WHERE object_id IN (?) ORDER BY sort_order, id', [ids]);
  const linesOf = new Map(ids.map((id) => [id, lines.filter((l) => l.object_id === id)]));
  const fields = [];
  input.forEach((x, i) => x.lines.forEach((l, j) => {
    if (!linesOf.get(x.objectId).some((ln) => ln.id === l.lineId)) {
      fields.push({ field: `objects.${i}.lines.${j}.lineId`, message: `Линия ${l.lineId} не относится к объекту «${objById.get(x.objectId).short_name}»` });
    }
  }));
  if (fields.length) throw badRequest('Проверьте введённые данные', { fields });

  const result = await withTransaction(async (conn) => {
    const period = await ensureEditablePeriod(conn, d, start);

    // Действующее состояние объектов на период: последняя строка НЕ ПОЗЖЕ периода и факт линий за неё
    const prevRows = await query(
      `SELECT p.object_id, p.period_start, p.ks_closed, p.workers, p.machines FROM net_object_period p
         JOIN (SELECT object_id, MAX(period_start) AS ps FROM net_object_period
                WHERE period_start <= ? AND object_id IN (?) GROUP BY object_id) l
           ON l.object_id = p.object_id AND l.ps = p.period_start`,
      [start, ids], conn,
    );
    const prev = new Map(prevRows.map((r) => [r.object_id, r]));
    const prevFacts = new Map((await query(
      'SELECT f.line_id, f.period_start, f.fact_volume FROM net_line_fact f JOIN net_lines l ON l.id = f.line_id WHERE l.object_id IN (?) AND f.period_start <= ?',
      [ids, start], conn,
    )).map((f) => [`${f.line_id}|${f.period_start}`, Number(f.fact_volume) || 0]));

    let saved = 0;
    for (const x of input) {
      const p = prev.get(x.objectId);
      const oldFact = (lineId) => (p ? prevFacts.get(`${lineId}|${p.period_start}`) ?? 0 : 0);
      const given = new Map(x.lines.map((l) => [l.lineId, round3(l.fact)]));

      // Полный снимок объекта за период: введённое + прежние значения остальных линий
      const snapshot = linesOf.get(x.objectId).map((l) => ({ ...l, before: round3(oldFact(l.id)), after: given.has(l.id) ? given.get(l.id) : round3(oldFact(l.id)) }));
      const before = { ks: round2(p?.ks_closed), workers: p?.workers ?? 0, machines: p?.machines ?? 0 };
      const after = { ks: round2(x.ks), workers: x.workers, machines: x.machines };
      const changedLines = snapshot.filter((l) => l.before !== l.after);
      const changedFields = Object.keys(after).filter((k) => before[k] !== after[k]);
      if (!changedLines.length && !changedFields.length) continue;

      await query(
        `INSERT INTO net_object_period (object_id, period_start, ks_closed, workers, machines, entered_by, entered_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE ks_closed = VALUES(ks_closed), workers = VALUES(workers), machines = VALUES(machines),
                                 entered_by = VALUES(entered_by), entered_at = NOW()`,
        [x.objectId, start, after.ks, after.workers, after.machines, req.user.id], conn,
      );
      if (snapshot.length) {
        await query(
          `INSERT INTO net_line_fact (line_id, period_start, fact_volume, entered_by, entered_at) VALUES ?
           ON DUPLICATE KEY UPDATE fact_volume = VALUES(fact_volume), entered_by = VALUES(entered_by), entered_at = NOW()`,
          [snapshot.map((l) => [l.id, start, l.after, req.user.id, new Date()])], conn,
        );
      }

      const parts = changedLines.map((l) => `${l.label}: ${num(l.before)} → ${num(l.after)} ${l.unit}`);
      if (changedFields.includes('ks')) parts.push(`КС: ${num(before.ks)} → ${num(after.ks)} ₽`);
      if (changedFields.includes('workers')) parts.push(`рабочие: ${before.workers} → ${after.workers}`);
      if (changedFields.includes('machines')) parts.push(`техника: ${before.machines} → ${after.machines}`);
      await audit(conn, {
        req, directionId: d.id, entity: 'net_object', entityId: x.objectId, entityName: objById.get(x.objectId).short_name,
        action: 'update', summary: `Период с ${start}: ${parts.join('; ')}`,
        changes: {
          lines: Object.fromEntries(changedLines.map((l) => [l.id, [l.before, l.after]])),
          ...Object.fromEntries(changedFields.map((k) => [k, [before[k], after[k]]])),
        },
      });
      saved++;
    }
    return { period, saved, unchanged: input.length - saved };
  });

  if (result.saved) await saveSnapshot(d, await computeKpi('networks', start), start);
  res.json({ ...result, message: result.saved ? `Сохранено объектов: ${result.saved}` : 'Изменений нет — сохранять нечего' });
});

addPeriodAdminRoutes(router);

export default router;
