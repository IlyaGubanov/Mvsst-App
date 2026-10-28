// =====================================================================
//  /api/mkd — «Капремонт МКД»: реестр адресов, карточка адреса, ввод статусов за период.
//
//    GET  /api/mkd/meta                         справочники, периоды, текущий период, мои адреса
//    GET  /api/mkd/objects[?period=ГГГГ-ММ-ДД]   реестр адресов с расчётом на период
//    GET  /api/mkd/objects/:id[?period=]        карточка адреса: позиции + история статусов
//    PUT  /api/mkd/periods/:start/status        ввод статусов позиций за период (ответственный, admin)
//    POST /api/mkd/periods/:start/close|reopen  закрыть / открыть период (admin)
//
//  Видеть МКД может каждый, кому открыто направление (проверка useDirection('mkd') в app.js).
//  Вносить — только ответственный за адрес (user_objects) или администратор.
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { editableObjectIds, responsibleByObject } from '../services/access.js';
import { audit } from '../services/audit.js';
import { computeMkdState } from '../services/kpi/mkd.js';
import { computeMkdDynamics, computeMkdFinance, computeMkdGantt, computeMkdMatrix, computeMkdSummary } from '../services/kpi/mkdSummary.js';
import { computeKpi, saveSnapshot } from '../services/kpi/index.js';
import { currentPeriod, ensureEditablePeriod, listPeriods, periodOut, resolveViewPeriod } from '../services/periods.js';
import { addPeriodAdminRoutes, startParams } from './periodAdmin.js';

const router = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_NAMES = { plan: 'Не начато', work: 'В работе', stop: 'Приостановлено', ks: 'КС-2 подписаны', paid: 'Оплачено', excl: 'Исключено' };
const periodQuery = z.object({ period: z.string().regex(ISO, 'Период — дата ГГГГ-ММ-ДД').optional() });
const idParams = z.object({ id: z.coerce.number().int().positive() });

const rub = (v) => `${Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Итоги «агрегата» в виде для интерфейса (проценты — 0..100, как в прежнем модуле). */
const aggOut = (a) => ({
  n: a.n, pct: a.pct, plan: a.plan, lag: a.lag, risk: a.riskLvl, overdue: a.overdue,
  contract: a.contract, ks: a.ks, paid: a.paid, topay: a.topay, statuses: a.st,
});

// ---------------------------------------------------------------------
// GET /meta
// ---------------------------------------------------------------------
router.get('/meta', async (req, res) => {
  const d = req.direction;
  const [sections, workTypes, people, orgs, periods, current, editable] = await Promise.all([
    query('SELECT id, code, name, note FROM mkd_sections ORDER BY sort_order, id'),
    query('SELECT id, code, name, full_name AS fullName, group_name AS groupName FROM mkd_work_types ORDER BY sort_order, id'),
    query('SELECT id, full_name AS name, position, phone, is_example AS isExample FROM people ORDER BY full_name'),
    query('SELECT id, name FROM organizations ORDER BY name'),
    listPeriods(d),
    currentPeriod(d),
    editableObjectIds(req.user, d),
  ]);
  res.json({
    sections, workTypes, people, orgs, periods, currentPeriod: current,
    statuses: Object.entries(STATUS_NAMES).map(([code, name]) => ({ code, name })),
    thresholds: { warn: d.thrWarn, crit: d.thrCrit },
    canEditAll: editable === 'all',
    myObjectIds: editable === 'all' ? [] : [...editable],
    isAdmin: req.user.role === 'admin',
  });
});

// ---------------------------------------------------------------------
// GET /objects — реестр адресов
// ---------------------------------------------------------------------
router.get('/objects', validate(periodQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const period = await resolveViewPeriod(d, req.valid.query.period);
  const [state, responsible, editable] = await Promise.all([
    computeMkdState(d, period), responsibleByObject(d), editableObjectIds(req.user, d),
  ]);
  res.json({
    period: periodOut(period),
    total: aggOut(state.total),
    objects: state.objects.map((o) => ({
      id: o.id, code: o.code, address: o.address, sectionId: o.sectionId, curatorId: o.curatorId,
      responsible: responsible.get(o.id) ?? [],
      canEdit: editable === 'all' || editable.has(o.id),
      // Сроки адреса — по позициям, кроме ПСД (как в прежнем модуле)
      start: o.rows.filter((r) => r.it.type_code !== 'psd' && r.it.plan_start).map((r) => r.it.plan_start).sort()[0] ?? null,
      end: o.rows.filter((r) => r.it.type_code !== 'psd' && r.it.plan_end).map((r) => r.it.plan_end).sort().at(-1) ?? null,
      ...aggOut(o.a),
    })),
  });
});

// ---------------------------------------------------------------------
// GET /summary — экран «Сводка» раздела: итоги, деньги по стадиям, освоение по периодам,
// статусы, светофор, разделы, отставание, что изменилось. Фильтры — как в прежнем модуле.
// ---------------------------------------------------------------------
const summaryQuery = periodQuery.extend({
  section: z.coerce.number().int().positive().optional(),
  person: z.coerce.number().int().positive().optional(),
  group: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
});

router.get('/summary', validate(summaryQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const { period: start, ...filters } = req.valid.query;
  const period = await resolveViewPeriod(d, start);
  res.json({ period: periodOut(period), ...(await computeMkdSummary(d, period.period_start, filters)) });
});

// ---------------------------------------------------------------------
// GET /matrix — экран «Матрица»: адрес × вид работ на период (те же фильтры, что у «Сводки»)
// ---------------------------------------------------------------------
router.get('/matrix', validate(summaryQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const { period: start, ...filters } = req.valid.query;
  const period = await resolveViewPeriod(d, start);
  res.json({ period: periodOut(period), ...(await computeMkdMatrix(d, period.period_start, filters)) });
});

// ---------------------------------------------------------------------
// GET /dynamics — экран «Динамика»: ряд по всем периодам, план вперёд до окончания работ,
// готовность по разделам и группам работ (те же фильтры)
// ---------------------------------------------------------------------
router.get('/dynamics', validate(summaryQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const { period: start, ...filters } = req.valid.query;
  const period = await resolveViewPeriod(d, start);
  res.json({ period: periodOut(period), ...(await computeMkdDynamics(d, period.period_start, filters)) });
});

// ---------------------------------------------------------------------
// GET /finance — экран «Финансы»: структура стоимости, ждут оплаты, КС-2 выше договора, экономия
// ---------------------------------------------------------------------
router.get('/finance', validate(summaryQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const { period: start, ...filters } = req.valid.query;
  const period = await resolveViewPeriod(d, start);
  res.json({ period: periodOut(period), ...(await computeMkdFinance(d, period.period_start, filters)) });
});

// ---------------------------------------------------------------------
// GET /gantt — экран «График работ»: сроки адресов и позиций с готовностью (psd=1 — показать ПСД)
// ---------------------------------------------------------------------
router.get('/gantt', validate(summaryQuery.extend({ psd: z.enum(['0', '1']).optional() }), 'query'), async (req, res) => {
  const d = req.direction;
  const { period: start, psd, ...filters } = req.valid.query;
  const period = await resolveViewPeriod(d, start);
  res.json({ period: periodOut(period), ...(await computeMkdGantt(d, period.period_start, filters, { psd: psd === '1' })) });
});

// ---------------------------------------------------------------------
// GET /objects/:id — карточка адреса
// ---------------------------------------------------------------------
router.get('/objects/:id', validate(idParams, 'params'), validate(periodQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const id = req.valid.params.id;
  const object = await queryOne(
    `SELECT o.id, o.code, o.address, o.note, o.archived, s.name AS section, s.note AS section_note,
            cur.full_name AS curator, ent.full_name AS entry_person
       FROM mkd_objects o
       LEFT JOIN mkd_sections s ON s.id = o.section_id
       LEFT JOIN people cur ON cur.id = o.curator_person_id
       LEFT JOIN people ent ON ent.id = o.entry_person_id
      WHERE o.id = ?`,
    [id],
  );
  if (!object) throw notFound('Адрес не найден');

  const period = await resolveViewPeriod(d, req.valid.query.period);
  const [state, responsible, editable, types, people, orgs, history] = await Promise.all([
    computeMkdState(d, period, { objectId: id }),
    responsibleByObject(d),
    editableObjectIds(req.user, d),
    query('SELECT id, name, full_name AS fullName, group_name AS groupName FROM mkd_work_types'),
    query('SELECT id, full_name AS name FROM people'),
    query('SELECT id, name FROM organizations'),
    query(
      `SELECT s.item_id, s.period_start, s.status, s.pct, s.ks_amount, s.paid_amount, s.note, s.entered_at,
              COALESCE(u.full_name, p.full_name) AS entered_by
         FROM mkd_item_status s JOIN mkd_items i ON i.id = s.item_id
         LEFT JOIN users u ON u.id = s.entered_by_user_id LEFT JOIN people p ON p.id = s.entered_by_person_id
        WHERE i.object_id = ? ORDER BY s.period_start`,
      [id],
    ),
  ]);
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const T = byId(types); const P = byId(people); const O = byId(orgs);
  const histOf = new Map();
  history.forEach((h) => {
    if (!histOf.has(h.item_id)) histOf.set(h.item_id, []);
    histOf.get(h.item_id).push({
      period: h.period_start, status: h.status, pct: Math.round(h.pct * 10000) / 100,
      ks: h.ks_amount, paid: h.paid_amount, note: h.note, by: h.entered_by, at: h.entered_at,
    });
  });
  const o = state.objects[0];

  res.json({
    period: periodOut(period),
    object: {
      id: object.id, code: object.code, address: object.address, note: object.note,
      section: object.section, sectionNote: object.section_note,
      curator: object.curator, entryPerson: object.entry_person,
      responsible: responsible.get(id) ?? [],
      canEdit: editable === 'all' || editable.has(id),
      ...(o ? aggOut(o.a) : {}),
    },
    items: (o?.rows ?? []).map(({ it, s, c }) => ({
      id: it.id, code: it.code, itemNo: it.item_no,
      workType: T.get(it.work_type_id)?.name, workTypeFull: T.get(it.work_type_id)?.fullName, group: T.get(it.work_type_id)?.groupName,
      start: it.plan_start, end: it.plan_end,
      contract: it.contract_amount, inwork: it.inwork_amount, approx: it.approx_amount,
      responsible: P.get(it.responsible_person_id)?.name ?? null, org: O.get(it.org_id)?.name ?? null, note: it.note,
      // 0,55 × 100 в компьютере даёт 55,00000000000001 — округляем введённый процент до сотых
      status: c.st, pct: round2(c.pct), plan: c.plan, lag: c.lag, risk: c.risk, overdue: c.overdue,
      ks: c.ks, paid: c.paid, topay: c.topay,
      statusNote: s?.note ?? null, statusPeriod: s?.period_start ?? null, enteredBy: s?.entered_by ?? null, enteredAt: s?.entered_at ?? null,
      history: histOf.get(it.id) ?? [],
    })),
  });
});

// ---------------------------------------------------------------------
// PUT /periods/:start/status — ввод за период
// ---------------------------------------------------------------------
const money = z.number({ invalid_type_error: 'Сумма — число' }).min(0, 'Сумма не может быть отрицательной').max(1e13, 'Слишком большая сумма');
const statusBody = z.object({
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    status: z.enum(['plan', 'work', 'stop', 'ks', 'paid', 'excl'], { errorMap: () => ({ message: 'Неизвестный статус' }) }),
    pct: z.number({ invalid_type_error: 'Готовность — число' }).min(0, 'Готовность от 0 до 100 %').max(100, 'Готовность от 0 до 100 %'),
    ks: money,
    paid: money,
    note: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  })).min(1, 'Нет изменений для сохранения').max(1000),
});

router.put('/periods/:start/status', validate(startParams, 'params'), validate(statusBody), async (req, res) => {
  const d = req.direction;
  const start = req.valid.params.start;
  const input = req.body.items;

  // Дубли одной позиции в запросе — ошибка (непонятно, какое значение верное)
  const ids = input.map((x) => x.itemId);
  if (new Set(ids).size !== ids.length) throw badRequest('Одна позиция передана дважды');

  // Права: каждый адрес должен быть «моим» (или я администратор)
  const editable = await editableObjectIds(req.user, d);
  const items = await query(
    `SELECT i.id, i.object_id, i.archived, o.address, t.name AS work_type
       FROM mkd_items i JOIN mkd_objects o ON o.id = i.object_id JOIN mkd_work_types t ON t.id = i.work_type_id
      WHERE i.id IN (?)`,
    [ids],
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const missing = ids.filter((id) => !itemById.has(id) || itemById.get(id).archived);
  if (missing.length) throw badRequest(`Позиции не найдены или в архиве: ${missing.join(', ')}`);
  const foreign = items.filter((i) => editable !== 'all' && !editable.has(i.object_id));
  if (foreign.length) {
    throw forbidden(`Вы не ответственный за адрес: ${[...new Set(foreign.map((i) => i.address))].join('; ')}`);
  }

  // Правила данных (проверены на перенесённых данных: нарушений нет)
  const fields = [];
  input.forEach((x, i) => {
    const name = `${itemById.get(x.itemId).work_type} (${itemById.get(x.itemId).address})`;
    if (round2(x.paid) > round2(x.ks)) fields.push({ field: `items.${i}.paid`, message: `${name}: оплачено больше, чем закрыто КС-2` });
    if ((x.status === 'ks' || x.status === 'paid') && !(x.ks > 0)) fields.push({ field: `items.${i}.ks`, message: `${name}: для статуса «${STATUS_NAMES[x.status]}» укажите сумму КС-2` });
  });
  if (fields.length) throw badRequest('Проверьте введённые данные', { fields });

  const result = await withTransaction(async (conn) => {
    const period = await ensureEditablePeriod(conn, d, start);

    // Действующее состояние до изменения: последняя запись не позже периода
    const prevRows = await query(
      `SELECT s.item_id, s.status, s.pct, s.ks_amount, s.paid_amount, s.note
         FROM mkd_item_status s
         JOIN (SELECT item_id, MAX(period_start) AS ps FROM mkd_item_status WHERE period_start <= ? AND item_id IN (?) GROUP BY item_id) l
           ON l.item_id = s.item_id AND l.ps = s.period_start`,
      [start, ids], conn,
    );
    const prev = new Map(prevRows.map((r) => [r.item_id, r]));

    let saved = 0;
    for (const x of input) {
      const p = prev.get(x.itemId);
      const pct = x.status === 'ks' || x.status === 'paid' ? 100 : Math.round(x.pct * 100) / 100;
      const before = {
        status: p?.status ?? 'plan', pct: p ? Math.round(p.pct * 10000) / 100 : 0,
        ks: round2(p?.ks_amount), paid: round2(p?.paid_amount), note: p?.note ?? null,
      };
      const after = { status: x.status, pct, ks: round2(x.ks), paid: round2(x.paid), note: x.note };
      const changes = Object.fromEntries(Object.keys(after).filter((k) => before[k] !== after[k]).map((k) => [k, [before[k], after[k]]]));
      if (!Object.keys(changes).length) continue; // ничего не поменялось — запись не нужна

      await query(
        `INSERT INTO mkd_item_status
           (item_id, period_start, status, pct, ks_amount, paid_amount, note, entered_by_user_id, entered_by_person_id, entered_at, is_example)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(), 0)
         ON DUPLICATE KEY UPDATE status = VALUES(status), pct = VALUES(pct), ks_amount = VALUES(ks_amount),
           paid_amount = VALUES(paid_amount), note = VALUES(note), entered_by_user_id = VALUES(entered_by_user_id),
           entered_by_person_id = NULL, entered_at = NOW(), is_example = 0`,
        [x.itemId, start, after.status, after.pct / 100, after.ks, after.paid, after.note, req.user.id], conn,
      );

      const it = itemById.get(x.itemId);
      const parts = [];
      if (changes.status) parts.push(`статус: ${STATUS_NAMES[before.status]} → ${STATUS_NAMES[after.status]}`);
      if (changes.pct) parts.push(`готовность: ${before.pct} → ${after.pct} %`);
      if (changes.ks) parts.push(`КС-2: ${rub(before.ks)} → ${rub(after.ks)}`);
      if (changes.paid) parts.push(`оплачено: ${rub(before.paid)} → ${rub(after.paid)}`);
      if (changes.note) parts.push('примечание');
      await audit(conn, {
        req, directionId: d.id, entity: 'mkd_item', entityId: x.itemId, entityName: `${it.address} — ${it.work_type}`,
        action: 'update', summary: `Период с ${start}: ${parts.join('; ')}`, changes,
      });
      saved++;
    }
    return { period, saved, unchanged: input.length - saved };
  });

  // Пересчитать снимок показателей за период (для «Сводки» и графиков)
  if (result.saved) await saveSnapshot(d, await computeKpi('mkd', start), start);

  res.json({ ...result, message: result.saved ? `Сохранено позиций: ${result.saved}` : 'Изменений нет — сохранять нечего' });
});

// POST /periods/:start/close | reopen — администратор (общие маршруты, routes/periodAdmin.js)
addPeriodAdminRoutes(router);

export default router;
