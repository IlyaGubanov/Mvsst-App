// =====================================================================
//  /api/streets — «Благоустройство улиц».
//
//    GET  /api/streets/meta                          виды работ, отчёты обеих программ, статусы, мои объекты
//    GET  /api/streets/reports/:id[?compare=]        отчёт: объекты, позиции, итоги; сравнение с другим отчётом
//    GET  /api/streets/history?program=[&objectId=]  динамика по всем отчётам программы
//    GET  /api/streets/objects/:id                   карточка объекта: сведения, история по отчётам
//    POST /api/streets/reports                       новый ручной отчёт на дату (копия предыдущего)
//    PUT  /api/streets/reports/:id/objects/:objectId ввод по объекту: факт по видам работ, статус, люди, техника, замечания
//    POST /api/streets/reports/:id/close · /reopen   закрыть / открыть ручной отчёт (admin)
//
//  Отчёты бывают двух видов: загруженные из Excel (source = import) — их не правят руками,
//  и ручные (source = manual) — их заполняют ответственные по своим объектам.
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { editableObjectIds, responsibleByObject } from '../services/access.js';
import { audit } from '../services/audit.js';
import { compactName, DONE_STATUSES } from '../services/kpi/streets.js';
import { describeReport, loadReportRows, streetsHistory } from '../services/kpi/streetsReport.js';
import { computeKpi, saveSnapshot } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';

const router = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PROGRAMS = { kbu: 'Комплексное благоустройство', current: 'Текущий ремонт' };
// Статусы для выбора при ручном вводе (в Excel встречаются и другие — они показываются как есть)
const STATUSES = ['Ведутся работы', ...DONE_STATUSES];
const program = z.enum(['kbu', 'current'], { errorMap: () => ({ message: 'Программа — kbu или current' }) });
const id = z.coerce.number().int().positive();

const loadWorks = () => query('SELECT id, code, name, unit FROM st_work_types ORDER BY sort_order, id');

async function getReport(reportId, db) {
  const r = await queryOne(
    `SELECT r.id, r.program, r.report_date AS date, r.source, r.is_closed AS isClosed, r.sheet_name AS sheet,
            r.created_at AS createdAt, u.full_name AS createdBy
       FROM st_reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`,
    [reportId], db,
  );
  if (!r) throw notFound('Отчёт не найден');
  return { ...r, isClosed: Boolean(r.isClosed), programName: PROGRAMS[r.program] };
}

/** Предыдущий отчёт той же программы (раньше по дате). */
const previousReport = (r) => queryOne(
  'SELECT id, report_date AS date FROM st_reports WHERE program = ? AND report_date < ? ORDER BY report_date DESC LIMIT 1',
  [r.program, r.date],
);

const objectsInfo = async (ids) => (ids.length
  ? query('SELECT id, code, name, okrug, lat, lon, geo_precision AS geoPrecision, archived FROM st_objects WHERE id IN (?)', [ids])
  : []);

// ---------------------------------------------------------------------
// GET /meta
// ---------------------------------------------------------------------
router.get('/meta', async (req, res) => {
  const d = req.direction;
  const [works, reports, editable] = await Promise.all([
    loadWorks(),
    query(
      `SELECT r.id, r.program, r.report_date AS date, r.source, r.is_closed AS isClosed, COUNT(ro.id) AS objects
         FROM st_reports r LEFT JOIN st_report_objects ro ON ro.report_id = r.id
        GROUP BY r.id ORDER BY r.report_date DESC`,
    ),
    editableObjectIds(req.user, d),
  ]);
  const list = (p) => reports.filter((r) => r.program === p).map(({ program: _p, ...r }) => ({ ...r, isClosed: Boolean(r.isClosed) }));
  res.json({
    works,
    programs: Object.entries(PROGRAMS).map(([code, name]) => ({ code, name, reports: list(code) })),
    statuses: STATUSES,
    doneStatuses: DONE_STATUSES,
    canEditAll: editable === 'all',
    myObjectIds: editable === 'all' ? [] : [...editable],
    canCreate: editable === 'all' || editable.size > 0,
    isAdmin: req.user.role === 'admin',
    today: todayIso(),
  });
});

// ---------------------------------------------------------------------
// GET /reports/:id[?compare=]
// ---------------------------------------------------------------------
router.get('/reports/:id', validate(z.object({ id }), 'params'),
  validate(z.object({ compare: id.optional() }), 'query'), async (req, res) => {
    const d = req.direction;
    const report = await getReport(req.valid.params.id);
    let compare = null;
    if (req.valid.query.compare) {
      compare = await getReport(req.valid.query.compare);
      if (compare.program !== report.program) throw badRequest('Сравнивать можно только отчёты одной программы');
      if (compare.id === report.id) compare = null;
    } else {
      compare = await previousReport(report);
    }

    const [works, rows, prevRows, responsible, editable] = await Promise.all([
      loadWorks(), loadReportRows(report.id), compare ? loadReportRows(compare.id) : null,
      responsibleByObject(d), editableObjectIds(req.user, d),
    ]);
    const view = describeReport(works, rows, prevRows);
    const info = new Map((await objectsInfo(rows.map((r) => r.objectId))).map((o) => [o.id, o]));
    const editableReport = report.source === 'manual' && !report.isClosed;

    res.json({
      report,
      compare: compare ? { id: compare.id, date: compare.date } : null,
      editable: editableReport,
      works: view.works,
      total: view.total,
      objects: view.objects.map((o) => {
        const x = info.get(o.objectId);
        return {
          ...o, id: o.objectId, code: x.code, name: x.name, short: compactName(x.name), okrug: x.okrug,
          lat: x.lat, lon: x.lon,
          responsible: responsible.get(o.objectId) ?? [],
          canEdit: editableReport && (editable === 'all' || editable.has(o.objectId)),
        };
      }),
    });
  });

// ---------------------------------------------------------------------
// GET /history?program=[&objectId=]
// ---------------------------------------------------------------------
router.get('/history', validate(z.object({ program, objectId: id.optional() }), 'query'), async (req, res) => {
  const { program: p, objectId } = req.valid.query;
  res.json({ program: p, series: await streetsHistory(p, objectId) });
});

// ---------------------------------------------------------------------
// GET /objects/:id — карточка объекта
// ---------------------------------------------------------------------
router.get('/objects/:id', validate(z.object({ id }), 'params'), async (req, res) => {
  const d = req.direction;
  const objectId = req.valid.params.id;
  const o = await queryOne(
    `SELECT id, code, name, okrug, lat, lon, geo_precision AS geoPrecision, geo_source AS geoSource,
            geo_verified AS geoVerified, archived FROM st_objects WHERE id = ?`,
    [objectId],
  );
  if (!o) throw notFound('Объект не найден');
  // В каких программах есть объект (обычно в одной)
  const programs = (await query(
    `SELECT DISTINCT r.program FROM st_report_objects ro JOIN st_reports r ON r.id = ro.report_id WHERE ro.object_id = ?`,
    [objectId],
  )).map((r) => r.program);
  const [responsible, editable, histories] = await Promise.all([
    responsibleByObject(d), editableObjectIds(req.user, d),
    Promise.all(programs.map(async (p) => ({ program: p, name: PROGRAMS[p], series: await streetsHistory(p, objectId) }))),
  ]);
  res.json({
    object: {
      ...o, short: compactName(o.name), geoVerified: Boolean(o.geoVerified), archived: Boolean(o.archived),
      responsible: responsible.get(objectId) ?? [],
      canEdit: editable === 'all' || editable.has(objectId),
    },
    histories,
  });
});

// ---------------------------------------------------------------------
// POST /reports — новый ручной отчёт (копия последнего отчёта до этой даты)
// ---------------------------------------------------------------------
const createBody = z.object({ program, date: z.string().regex(ISO, 'Дата — ГГГГ-ММ-ДД') });

router.post('/reports', validate(createBody), async (req, res) => {
  const d = req.direction;
  const { program: p, date } = req.body;
  const editable = await editableObjectIds(req.user, d);
  if (editable !== 'all' && editable.size === 0) throw forbidden('Создавать отчёт могут ответственные за объекты и администратор');
  if (date > todayIso()) throw badRequest('Нельзя создать отчёт на будущую дату');
  if (await queryOne('SELECT id FROM st_reports WHERE program = ? AND report_date = ?', [p, date])) {
    throw conflict(`Отчёт на ${date} уже есть — откройте его`);
  }
  const base = await queryOne(
    'SELECT id, report_date AS date FROM st_reports WHERE program = ? AND report_date < ? ORDER BY report_date DESC LIMIT 1',
    [p, date],
  );
  if (!base) throw badRequest('Нет более раннего отчёта, из которого можно взять объекты и проектные объёмы');

  const created = await withTransaction(async (conn) => {
    const ins = await query(
      `INSERT INTO st_reports (program, report_date, source, created_by) VALUES (?, ?, 'manual', ?)`,
      [p, date, req.user.id], conn,
    );
    const reportId = ins.insertId;
    // Строки: только объекты не в архиве; кто вносил — пусто (значения перенесены, а не введены)
    const rows = await query(
      `INSERT INTO st_report_objects (report_id, object_id, status, people, tech, remarks)
       SELECT ?, ro.object_id, ro.status, ro.people, ro.tech, ro.remarks
         FROM st_report_objects ro JOIN st_objects o ON o.id = ro.object_id
        WHERE ro.report_id = ? AND o.archived = 0 ORDER BY ro.id`,
      [reportId, base.id], conn,
    );
    await query(
      `INSERT INTO st_report_values (report_object_id, work_type_id, plan_volume, fact_volume)
       SELECT nro.id, v.work_type_id, v.plan_volume, v.fact_volume
         FROM st_report_values v
         JOIN st_report_objects ro  ON ro.id = v.report_object_id AND ro.report_id = ?
         JOIN st_report_objects nro ON nro.report_id = ? AND nro.object_id = ro.object_id`,
      [base.id, reportId], conn,
    );
    await audit(conn, {
      req, directionId: d.id, entity: 'st_report', entityId: reportId, entityName: `${PROGRAMS[p]} · ${date}`,
      action: 'create', summary: `Создан ручной отчёт на ${date} (${rows.affectedRows} объектов) по отчёту ${base.date}`,
    });
    return { reportId, objects: rows.affectedRows };
  });
  await saveSnapshot(d, await computeKpi('streets', todayIso()), todayIso());
  res.status(201).json({ id: created.reportId, objects: created.objects, basedOn: base, message: `Отчёт на ${date} создан: ${created.objects} объектов, значения взяты из отчёта ${base.date}` });
});

// ---------------------------------------------------------------------
// PUT /reports/:id/objects/:objectId — ввод по объекту
// ---------------------------------------------------------------------
const count = z.number({ invalid_type_error: 'Целое число' }).int('Целое число').min(0, 'Не может быть отрицательным').max(10000, 'Слишком много').nullable();
const rowBody = z.object({
  status: z.string().trim().max(80, 'Статус — не длиннее 80 знаков').nullable(),
  people: count, tech: count, remarks: count,
  values: z.array(z.object({
    workTypeId: id,
    fact: z.number({ invalid_type_error: 'Факт — число' }).min(0, 'Не может быть отрицательным').max(1e9).nullable(),
  })).max(50).default([]),
});

router.put('/reports/:id/objects/:objectId', validate(z.object({ id, objectId: id }), 'params'), validate(rowBody), async (req, res) => {
  const d = req.direction;
  const { id: reportId, objectId } = req.valid.params;
  const body = req.body;
  const report = await getReport(reportId);
  if (report.source !== 'manual') throw badRequest('Отчёт загружен из Excel — его не правят вручную. Создайте ручной отчёт на нужную дату.');
  if (report.isClosed) throw badRequest('Отчёт закрыт — правки запрещены');
  const editable = await editableObjectIds(req.user, d);
  if (editable !== 'all' && !editable.has(objectId)) throw forbidden('Вы не ответственный за этот объект');

  const result = await withTransaction(async (conn) => {
    const row = await queryOne(
      `SELECT ro.id, ro.status, ro.people, ro.tech, ro.remarks, o.name FROM st_report_objects ro
         JOIN st_objects o ON o.id = ro.object_id WHERE ro.report_id = ? AND ro.object_id = ? FOR UPDATE`,
      [reportId, objectId], conn,
    );
    if (!row) throw notFound('Объекта нет в этом отчёте');
    const values = new Map((await query(
      `SELECT v.work_type_id, v.plan_volume, v.fact_volume, w.name, w.unit FROM st_report_values v
         JOIN st_work_types w ON w.id = v.work_type_id WHERE v.report_object_id = ?`,
      [row.id], conn,
    )).map((v) => [v.work_type_id, v]));

    const parts = [];
    const changes = {};
    for (const v of body.values) {
      const old = values.get(v.workTypeId);
      if (!old) throw badRequest(`У объекта нет вида работ с id ${v.workTypeId}`);
      const fact = v.fact == null ? null : Math.round(v.fact * 1000) / 1000;
      const before = old.fact_volume == null ? null : Number(old.fact_volume);
      if (fact === before) continue;
      await query(
        'UPDATE st_report_values SET fact_volume = ?, entered_by = ? WHERE report_object_id = ? AND work_type_id = ?',
        [fact, req.user.id, row.id, v.workTypeId], conn,
      );
      parts.push(`${old.name}: ${before ?? '—'} → ${fact ?? '—'}${old.unit ? ` ${old.unit}` : ''}`);
      changes[old.name] = [before, fact];
    }
    const status = body.status || null;
    const fields = { status, people: body.people, tech: body.tech, remarks: body.remarks };
    const names = { status: 'статус', people: 'люди', tech: 'техника', remarks: 'замечания' };
    const changedFields = Object.keys(fields).filter((k) => (row[k] ?? null) !== (fields[k] ?? null));
    if (changedFields.length || parts.length) {
      await query(
        'UPDATE st_report_objects SET status = ?, people = ?, tech = ?, remarks = ?, entered_by = ? WHERE id = ?',
        [status, body.people, body.tech, body.remarks, req.user.id, row.id], conn,
      );
    }
    changedFields.forEach((k) => {
      parts.push(`${names[k]}: ${row[k] ?? '—'} → ${fields[k] ?? '—'}`);
      changes[names[k]] = [row[k], fields[k]];
    });
    if (parts.length) {
      await audit(conn, {
        req, directionId: d.id, entity: 'st_object', entityId: objectId, entityName: row.name,
        action: 'update', summary: `Отчёт ${report.date}: ${parts.join('; ')}`.slice(0, 500), changes,
      });
    }
    return { saved: parts.length };
  });

  if (result.saved) await saveSnapshot(d, await computeKpi('streets', todayIso()), todayIso());
  res.json({ ...result, message: result.saved ? `Сохранено изменений: ${result.saved}` : 'Изменений нет — сохранять нечего' });
});

// ---------------------------------------------------------------------
// POST /reports/:id/close · /reopen — только администратор
// ---------------------------------------------------------------------
for (const [action, closed] of [['close', true], ['reopen', false]]) {
  router.post(`/reports/:id/${action}`, requireRole('admin'), validate(z.object({ id }), 'params'), async (req, res) => {
    const report = await getReport(req.valid.params.id);
    if (report.source !== 'manual') throw badRequest('Загруженные из Excel отчёты и так не правятся');
    await query('UPDATE st_reports SET is_closed = ? WHERE id = ?', [closed ? 1 : 0, report.id]);
    await audit(undefined, {
      req, directionId: req.direction.id, entity: 'st_report', entityId: report.id, entityName: `${report.programName} · ${report.date}`,
      action: 'update', summary: `${closed ? 'Закрыт' : 'Открыт'} ручной отчёт на ${report.date}`,
    });
    res.json({ report: await getReport(report.id) });
  });
}

export default router;
