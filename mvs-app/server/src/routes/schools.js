// =====================================================================
//  /api/schools — «Капремонт школ».
//
//    GET /api/schools/meta                    виды работ (группы, веса, сроки), материалы, системы, мои школы
//    GET /api/schools/overview[?date=]        обзор: итоги, школы, группы работ, S-кривая
//    GET /api/schools/objects/:id[?date=]     карточка школы: работы с историей, ресурсы по дням, закупки, испытания, МГЭ
//    GET /api/schools/procurement[?date=]     закупки всех школ: оплата → поставка → монтаж, просрочки
//    GET /api/schools/systems                 индивидуальные испытания: системы × школы
//    PUT /api/schools/days/:date              ежедневный ввод: выполнение работ и ресурсы (ответственный, admin)
//
//  В отличие от МКД и Сетей, у школ нет отчётных периодов: данные вносятся ПО ДНЯМ.
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { editableObjectIds, responsibleByObject } from '../services/access.js';
import { audit } from '../services/audit.js';
import { computeSchoolsState, loadWorkTypes, sCurve } from '../services/kpi/schools.js';
import { computeKpi, saveSnapshot } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';

const router = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateQuery = z.object({ date: z.string().regex(ISO, 'Дата — ГГГГ-ММ-ДД').optional() });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const dayParams = z.object({ date: z.string().regex(ISO, 'Дата — ГГГГ-ММ-ДД') });
const round4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const round3 = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 1000);
const pctText = (v) => `${Math.round(v * 1000) / 10} %`;

// Экспертиза (МГЭ) по школам: проектировщик, кто проверяет, даты ПИР, подачи и выхода заключения
const EXPERTISE_SQL = `SELECT object_id AS schoolId, designer_name AS designer, reviewer, pir_start AS pirStart, project_done AS projectDone,
                              exp_in AS expIn, exp_out AS expOut, status, handover FROM sch_expertise`;

async function orgNames() {
  return new Map((await query('SELECT id, name FROM organizations')).map((o) => [o.id, o.name]));
}

/** Школа в виде для интерфейса. */
function schoolOut(s, responsible, editable, orgs) {
  const o = s.o;
  return {
    id: o.id, code: o.code, name: o.name, short: o.short_name, okrug: o.okrug, district: o.district,
    type: o.building_type, area: o.area_m2, territory: o.territory_ha,
    contractor: orgs.get(o.contractor_org_id) ?? null, designer: orgs.get(o.designer_org_id) ?? null,
    kitchen: o.kitchen_status, iiComplex: o.ii_complex, iiSourceDemo: o.ii_source_demo,
    limitTotal: o.limit_total, limit2026: o.limit_2026, paid: o.paid, procPayTotal: o.proc_pay_total,
    mgeStatus: o.mge_status,
    fact: s.f, plan: s.p, dev: s.d, status: s.s, groups: s.groups,
    people: s.people, tech: s.tech, overdueDeliveries: s.overdue,
    resources: s.res ? {
      date: s.res.report_date, people: s.res.people, tech: s.res.tech,
      peopleLandscape: s.res.people_landscape, techLandscape: s.res.tech_landscape,
    } : null,
    responsible: responsible.get(o.id) ?? [],
    canEdit: editable === 'all' || editable.has(o.id),
  };
}

// ---------------------------------------------------------------------
// GET /meta
// ---------------------------------------------------------------------
router.get('/meta', async (req, res) => {
  const d = req.direction;
  const [works, materials, systems, editable, last] = await Promise.all([
    loadWorkTypes(),
    query('SELECT id, code, category, name, period_text AS period, period_start AS start, period_end AS end FROM sch_materials ORDER BY sort_order, code'),
    query('SELECT id, code, name FROM sch_systems ORDER BY sort_order, code'),
    editableObjectIds(req.user, d),
    queryOne('SELECT MAX(report_date) AS d FROM sch_work_progress'),
  ]);
  res.json({
    works: works.map((w) => ({ id: w.id, code: w.code, name: w.name, group: w.group_name, unit: w.unit, weight: w.weight, start: w.plan_start, end: w.plan_end })),
    groups: [...new Set(works.map((w) => w.group_name))],
    materials, systems,
    thresholds: { warn: d.thrWarn, crit: d.thrCrit },
    canEditAll: editable === 'all',
    myObjectIds: editable === 'all' ? [] : [...editable],
    isAdmin: req.user.role === 'admin',
    today: todayIso(),
    lastProgressDate: last?.d ?? null,
  });
});

// ---------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------
router.get('/overview', validate(dateQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const date = req.valid.query.date ?? todayIso();
  const [state, responsible, editable, orgs, expertise] = await Promise.all([
    computeSchoolsState(d, date), responsibleByObject(d), editableObjectIds(req.user, d), orgNames(),
    query(EXPERTISE_SQL),
  ]);
  res.json({
    date,
    total: state.total,
    schools: state.schools.map((s) => schoolOut(s, responsible, editable, orgs)),
    expertise,
    curve: sCurve(state),
  });
});

// ---------------------------------------------------------------------
// GET /objects/:id — карточка школы
// ---------------------------------------------------------------------
router.get('/objects/:id', validate(idParams, 'params'), validate(dateQuery, 'query'), async (req, res) => {
  const d = req.direction;
  const id = req.valid.params.id;
  const date = req.valid.query.date ?? todayIso();
  const state = await computeSchoolsState(d, date, { objectId: id });
  const s = state.schools[0];
  if (!s) throw notFound('Школа не найдена');

  const [responsible, editable, orgs, expertise, materials, systems, resources, volumes] = await Promise.all([
    responsibleByObject(d), editableObjectIds(req.user, d), orgNames(),
    queryOne(`${EXPERTISE_SQL} WHERE object_id = ?`, [id]),
    query(
      `SELECT mt.id, mt.category, mt.name, mt.period_text AS period, m.maker, m.supplier, m.qty, m.unit,
              m.pay_pct AS pay, m.delivered_pct AS delivered, m.installed_pct AS installed,
              m.delivery_date AS deliveryDate, m.done_date AS doneDate
         FROM sch_object_materials m JOIN sch_materials mt ON mt.id = m.material_id
        WHERE m.object_id = ? ORDER BY mt.sort_order, mt.code`,
      [id],
    ),
    query(
      `SELECT sy.id, sy.name, os.state, os.has_id_docs AS idDocs FROM sch_object_systems os
         JOIN sch_systems sy ON sy.id = os.system_id WHERE os.object_id = ? ORDER BY sy.sort_order, sy.code`,
      [id],
    ),
    query(
      `SELECT report_date AS date, people, tech, people_landscape AS peopleLandscape, tech_landscape AS techLandscape, source
         FROM sch_daily_resources WHERE object_id = ? AND report_date <= ? ORDER BY report_date`,
      [id, date],
    ),
    // Проектные объёмы берём из самой работы школы: на ранние даты записей истории ещё нет, а объём нужен
    query('SELECT work_type_id, plan_volume FROM sch_object_works WHERE object_id = ?', [id]),
  ]);
  const planVolume = new Map(volumes.map((v) => [v.work_type_id, v.plan_volume]));

  // История выполнения по каждому виду работ
  const history = new Map();
  state.progress.rows.forEach((r) => {
    if (!history.has(r.work_type_id)) history.set(r.work_type_id, []);
    history.get(r.work_type_id).push({ date: r.report_date, pct: round4(r.pct), factVolume: round3(r.fact_volume), by: r.entered_by ?? (r.source === 'import' ? 'перенос' : null) });
  });

  res.json({
    date,
    school: schoolOut(s, responsible, editable, orgs),
    works: s.works.map(({ w, e, fact, plan }) => ({
      id: w.id, code: w.code, name: w.name, group: w.group_name, unit: w.unit, weight: w.weight,
      start: w.plan_start, end: w.plan_end, plan, fact, dev: fact - plan,
      pct: round4(e?.pct ?? 0), planVolume: round3(planVolume.get(w.id) ?? null), factVolume: round3(e?.fact_volume ?? null),
      entryDate: e?.report_date ?? null, enteredBy: e?.entered_by ?? null,
      history: history.get(w.id) ?? [],
    })),
    expertise,
    materials: materials.map((m) => ({ ...m, overdueDelivery: Boolean(m.deliveryDate && m.deliveryDate < date && m.delivered < 1), overdueDone: Boolean(m.doneDate && m.doneDate < date && m.installed < 1) })),
    systems: systems.map((x) => ({ ...x, idDocs: Boolean(x.idDocs) })),
    resources,
    curve: sCurve(state, [id]),
  });
});

// ---------------------------------------------------------------------
// GET /procurement — закупки всех школ
// ---------------------------------------------------------------------
router.get('/procurement', validate(dateQuery, 'query'), async (req, res) => {
  const date = req.valid.query.date ?? todayIso();
  const rows = await query(
    `SELECT o.id AS schoolId, o.short_name AS school, mt.id AS materialId, mt.category, mt.name, mt.period_text AS period,
            m.maker, m.supplier, m.qty, m.unit, m.pay_pct AS pay, m.delivered_pct AS delivered, m.installed_pct AS installed,
            m.delivery_date AS deliveryDate, m.done_date AS doneDate
       FROM sch_object_materials m
       JOIN sch_materials mt ON mt.id = m.material_id
       JOIN sch_objects o ON o.id = m.object_id AND o.archived = 0
      ORDER BY mt.sort_order, mt.code, o.sort_order`,
  );
  const items = rows.map((r) => ({
    ...r,
    overdueDelivery: Boolean(r.deliveryDate && r.deliveryDate < date && r.delivered < 1),
    overdueDone: Boolean(r.doneDate && r.doneDate < date && r.installed < 1),
  }));
  // Итоги по категориям: средние доли оплаты, поставки, монтажа (как в прежнем модуле)
  const cats = [...new Set(items.map((i) => i.category))].map((c) => {
    const list = items.filter((i) => i.category === c);
    const avg = (k) => list.reduce((a, i) => a + (Number(i[k]) || 0), 0) / list.length;
    return { category: c, n: list.length, pay: avg('pay'), delivered: avg('delivered'), installed: avg('installed'), overdue: list.filter((i) => i.overdueDelivery).length };
  });
  res.json({ date, items, categories: cats, overdue: items.filter((i) => i.overdueDelivery).length });
});

// ---------------------------------------------------------------------
// GET /systems — испытания систем
// ---------------------------------------------------------------------
router.get('/systems', async (req, res) => {
  const [systems, schools, cells] = await Promise.all([
    query('SELECT id, name FROM sch_systems ORDER BY sort_order, code'),
    query('SELECT id, short_name AS short, ii_complex AS complex FROM sch_objects WHERE archived = 0 ORDER BY sort_order, id'),
    query('SELECT object_id AS schoolId, system_id AS systemId, state, has_id_docs AS idDocs FROM sch_object_systems'),
  ]);
  res.json({ systems, schools, cells: cells.map((c) => ({ ...c, idDocs: Boolean(c.idDocs) })) });
});

// ---------------------------------------------------------------------
// PUT /days/:date — ежедневный ввод
// ---------------------------------------------------------------------
const count = z.number({ invalid_type_error: 'Целое число' }).int('Целое число').min(0, 'Не может быть отрицательным').max(10000, 'Слишком много');
const dayBody = z.object({
  objects: z.array(z.object({
    objectId: z.number().int().positive(),
    works: z.array(z.object({
      workTypeId: z.number().int().positive(),
      pct: z.number({ invalid_type_error: 'Процент — число' }).min(0, 'От 0 до 100').max(100, 'От 0 до 100'),
      factVolume: z.number({ invalid_type_error: 'Объём — число' }).min(0, 'Не может быть отрицательным').max(1e9).nullable(),
    })).max(200).default([]),
    resources: z.object({ people: count, tech: count, peopleLandscape: count, techLandscape: count }).nullable().default(null),
  })).min(1, 'Нет данных для сохранения').max(50),
});

router.put('/days/:date', validate(dayParams, 'params'), validate(dayBody), async (req, res) => {
  const d = req.direction;
  const { date } = req.valid.params;
  const today = todayIso();
  if (date > today) throw badRequest('Нельзя вносить данные за будущую дату');
  if (date < '2025-01-01') throw badRequest('Слишком ранняя дата');
  const input = req.body.objects;
  const ids = input.map((x) => x.objectId);
  if (new Set(ids).size !== ids.length) throw badRequest('Одна школа передана дважды');

  const editable = await editableObjectIds(req.user, d);
  const schools = await query('SELECT id, short_name, archived FROM sch_objects WHERE id IN (?)', [ids]);
  const byId = new Map(schools.map((s) => [s.id, s]));
  const missing = ids.filter((id) => !byId.has(id) || byId.get(id).archived);
  if (missing.length) throw badRequest(`Школы не найдены или в архиве: ${missing.join(', ')}`);
  const foreign = schools.filter((s) => editable !== 'all' && !editable.has(s.id));
  if (foreign.length) throw forbidden(`Вы не ответственный за школу: ${foreign.map((s) => s.short_name).join('; ')}`);

  const works = new Map((await loadWorkTypes()).map((w) => [w.id, w]));
  const badWork = input.flatMap((x) => x.works.map((w) => w.workTypeId)).filter((wid) => !works.has(wid));
  if (badWork.length) throw badRequest(`Неизвестные виды работ: ${[...new Set(badWork)].join(', ')}`);

  const result = await withTransaction(async (conn) => {
    // Действующее состояние на дату: последняя запись истории не позже даты + проектные объёмы
    const prevRows = await query(
      `SELECT ow.object_id, ow.work_type_id, ow.plan_volume, p.pct, p.fact_volume
         FROM sch_object_works ow
         LEFT JOIN (SELECT object_id, work_type_id, MAX(report_date) AS d FROM sch_work_progress
                     WHERE report_date <= ? AND object_id IN (?) GROUP BY object_id, work_type_id) l
           ON l.object_id = ow.object_id AND l.work_type_id = ow.work_type_id
         LEFT JOIN sch_work_progress p ON p.object_id = l.object_id AND p.work_type_id = l.work_type_id AND p.report_date = l.d
        WHERE ow.object_id IN (?)`,
      [date, ids, ids], conn,
    );
    const prev = new Map(prevRows.map((r) => [`${r.object_id}|${r.work_type_id}`, r]));
    const resRows = await query('SELECT * FROM sch_daily_resources WHERE report_date = ? AND object_id IN (?)', [date, ids], conn);
    const resPrev = new Map(resRows.map((r) => [r.object_id, r]));

    let savedWorks = 0;
    let savedRes = 0;
    for (const x of input) {
      const school = byId.get(x.objectId);
      const parts = [];
      const changes = {};

      for (const w of x.works) {
        const p = prev.get(`${x.objectId}|${w.workTypeId}`);
        if (!p) throw badRequest(`У школы «${school.short_name}» нет вида работ «${works.get(w.workTypeId).name}»`);
        // Если есть проектный объём и введён факт объёмом — процент считается из объёма (как в прежнем модуле)
        const fv = p.plan_volume > 0 ? round3(w.factVolume) : null;
        const pct = fv !== null ? round4(Math.min(1, fv / p.plan_volume)) : round4(w.pct / 100);
        const before = { pct: round4(p.pct ?? 0), fv: round3(p.fact_volume ?? null) };
        if (before.pct === pct && before.fv === fv) continue;

        await query(
          `INSERT INTO sch_work_progress (object_id, work_type_id, report_date, pct, fact_volume, source, entered_by, entered_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, NOW())
           ON DUPLICATE KEY UPDATE pct = VALUES(pct), fact_volume = VALUES(fact_volume), source = 'manual',
                                   entered_by = VALUES(entered_by), entered_at = NOW()`,
          [x.objectId, w.workTypeId, date, pct, fv, req.user.id], conn,
        );
        // «Текущее» выполнение обновляем, только если это самая свежая запись по виду работ
        await query(
          `UPDATE sch_object_works SET pct = ?, fact_volume = ?, updated_by = ?
            WHERE object_id = ? AND work_type_id = ?
              AND ? >= (SELECT MAX(report_date) FROM sch_work_progress WHERE object_id = ? AND work_type_id = ?)`,
          [pct, fv, req.user.id, x.objectId, w.workTypeId, date, x.objectId, w.workTypeId], conn,
        );
        const name = works.get(w.workTypeId).name;
        parts.push(`${name}: ${pctText(before.pct)} → ${pctText(pct)}${fv !== null ? ` (${fv} ${works.get(w.workTypeId).unit ?? ''})` : ''}`);
        changes[name] = [before, { pct, fv }];
        savedWorks++;
      }

      if (x.resources) {
        const r = x.resources;
        const old = resPrev.get(x.objectId);
        const same = old && old.people === r.people && old.tech === r.tech && old.people_landscape === r.peopleLandscape && old.tech_landscape === r.techLandscape;
        if (!same) {
          await query(
            `INSERT INTO sch_daily_resources (object_id, report_date, people, tech, people_landscape, tech_landscape, source, entered_by, entered_at)
             VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, NOW())
             ON DUPLICATE KEY UPDATE people = VALUES(people), tech = VALUES(tech), people_landscape = VALUES(people_landscape),
                                     tech_landscape = VALUES(tech_landscape), source = 'manual', entered_by = VALUES(entered_by), entered_at = NOW()`,
            [x.objectId, date, r.people, r.tech, r.peopleLandscape, r.techLandscape, req.user.id], conn,
          );
          parts.push(`ресурсы: здание ${r.people} чел. / ${r.tech} ед., благоустройство ${r.peopleLandscape} чел. / ${r.techLandscape} ед.`);
          changes.resources = [old ? { people: old.people, tech: old.tech, peopleLandscape: old.people_landscape, techLandscape: old.tech_landscape } : null, r];
          savedRes++;
        }
      }

      if (parts.length) {
        await audit(conn, {
          req, directionId: d.id, entity: 'sch_object', entityId: x.objectId, entityName: school.short_name,
          action: 'update', summary: `Данные за ${date}: ${parts.join('; ')}`.slice(0, 500), changes,
        });
      }
    }
    return { savedWorks, savedResources: savedRes };
  });

  // Снимок показателей школ — на сегодня (план школ считается «на сегодня»)
  if (result.savedWorks || result.savedResources) await saveSnapshot(d, await computeKpi('schools', today), today);
  const total = result.savedWorks + result.savedResources;
  res.json({
    ...result,
    message: total ? `Сохранено: работ — ${result.savedWorks}, ресурсов — ${result.savedResources}` : 'Изменений нет — сохранять нечего',
  });
});

export default router;
