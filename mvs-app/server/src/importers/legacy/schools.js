// =====================================================================
//  Перенос «Капремонт школ» из schools.html (блок <script id="data">).
//
//  Было (JSON)                              → Стало (таблица)
//  ref.works.items.w13 {name, group, w…}    → sch_work_types
//  ref.materials.items / ref.systems.items  → sch_materials / sch_systems
//  objects.o1 {name, okrug, fin…}           → sch_objects (+ организации и ответственный)
//  objects.o1.mge                           → sch_expertise
//  objects.o1.works.w13 {pct, pv, fv}       → sch_object_works + первая запись истории sch_work_progress на дату asOf
//  objects.o1.proc.m01 / objects.o1.ii.s01  → sch_object_materials / sch_object_systems
//  log['2026-08-24_o2'] + objects.o1.res    → sch_daily_resources (peopleBl/techBl → *_landscape)
// =====================================================================

import { query } from '../../db.js';
import { text, num, count, date, ruPeriod, insertMany, codeMap, moneySum } from './common.js';

export const meta = {
  code: 'schools',
  file: 'schools',
  block: 'data',
  mainTable: 'sch_objects',
  // порядок удаления при повторном переносе (--replace): сначала зависимые таблицы
  tables: [
    'sch_work_progress', 'sch_object_works', 'sch_object_materials', 'sch_object_systems',
    'sch_daily_resources', 'sch_expertise', 'sch_objects', 'sch_work_types', 'sch_materials', 'sch_systems',
  ],
};

export async function run(conn, S, { dict, report }) {
  const asOf = date(S.asOf, report, 'Дата данных (asOf)');
  if (!asOf) throw new Error('В данных школ нет даты asOf — не на что записать историю выполнения');

  // ---------- 1. Справочники ----------
  const workRows = Object.entries(S.ref.works.items).map(([code, w]) => [
    code, text(w.name), text(w.group) ?? 'Прочее', num(w.w) ?? 0,
    date(w.start, report, `Вид работ ${code}, начало`), date(w.end, report, `Вид работ ${code}, окончание`),
    text(w.unit), num(w.order) ?? 0,
  ]);
  report.add('sch_work_types', await insertMany(conn, 'sch_work_types',
    ['code', 'name', 'group_name', 'weight', 'plan_start', 'plan_end', 'unit', 'sort_order'], workRows));

  const materialRows = Object.entries(S.ref.materials.items).map(([code, m]) => {
    const [start, end] = ruPeriod(m.period);
    return [code, text(m.cat) ?? 'Прочее', text(m.name), text(m.period), start, end, num(m.order) ?? 0];
  });
  report.add('sch_materials', await insertMany(conn, 'sch_materials',
    ['code', 'category', 'name', 'period_text', 'period_start', 'period_end', 'sort_order'], materialRows));

  const systemRows = Object.entries(S.ref.systems.items).map(([code, s]) => [code, text(s.name), num(s.order) ?? 0]);
  report.add('sch_systems', await insertMany(conn, 'sch_systems', ['code', 'name', 'sort_order'], systemRows));

  const workIds = await codeMap(conn, 'sch_work_types');
  const materialIds = await codeMap(conn, 'sch_materials');
  const systemIds = await codeMap(conn, 'sch_systems');

  // ---------- 2. Школы и всё, что к ним относится ----------
  const objectIds = new Map();
  const works = [];
  const progress = [];
  const materials = [];
  const systems = [];

  for (const [code, o] of Object.entries(S.objects)) {
    const contractorId = await dict.orgId(o.contractor);
    const designerId = await dict.orgId(o.designer);
    const responsibleId = await dict.personId(o.responsible);

    const r = await query(
      `INSERT INTO sch_objects
         (code, name, short_name, okrug, district, building_type, area_m2, territory_ha,
          contractor_org_id, designer_org_id, responsible_person_id, kitchen_status, ii_complex, ii_source_demo,
          limit_total, limit_2026, paid, proc_pay_total, sort_order, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, text(o.name), text(o.short) ?? text(o.name), text(o.okrug), text(o.district), text(o.type),
        num(o.area), num(o.terr), contractorId, designerId, responsibleId,
        text(o.kitchen), text(o.iiComplex), text(o.iiSourceDemo),
        num(o.fin?.limitTotal), num(o.fin?.limit2026), num(o.fin?.paid), num(o.procPayTotal),
        num(o.order) ?? 0, o.archived ? 1 : 0,
      ],
      conn,
    );
    const objectId = r.insertId;
    objectIds.set(code, objectId);
    report.add('sch_objects', 1);

    // Проектирование и МГЭ
    if (o.mge) {
      const g = o.mge;
      const where = `Школа ${code}, МГЭ`;
      await query(
        `INSERT INTO sch_expertise (object_id, designer_name, reviewer, pir_start, project_done, exp_in, exp_out, status, handover)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [objectId, text(g.designer), text(g.reviewer), date(g.pirStart, report, where), date(g.pDone, report, where),
          date(g.expIn, report, where), date(g.expOut, report, where), text(g.status), date(g.handover, report, where)],
        conn,
      );
      report.add('sch_expertise', 1);
    }

    // Выполнение работ: текущее + первая точка истории на дату данных
    for (const [wcode, w] of Object.entries(o.works ?? {})) {
      const workTypeId = workIds.get(wcode);
      if (!workTypeId) { report.warn(`Школа ${code}: вид работ ${wcode} отсутствует в справочнике — пропущен`); continue; }
      const pct = Math.min(1, Math.max(0, num(w.pct) ?? 0));
      works.push([objectId, workTypeId, pct, num(w.pv), num(w.fv)]);
      progress.push([objectId, workTypeId, asOf, pct, num(w.fv), 'import']);
    }

    // Закупки: оплата → поставка → монтаж (доли 0..1)
    for (const [mcode, p] of Object.entries(o.proc ?? {})) {
      const materialId = materialIds.get(mcode);
      if (!materialId) { report.warn(`Школа ${code}: материал ${mcode} отсутствует в справочнике — пропущен`); continue; }
      materials.push([
        objectId, materialId, text(p.maker), text(p.supplier), num(p.qty), text(p.unit),
        num(p.pay) ?? 0, num(p.deliv) ?? 0, num(p.inst) ?? 0,
        date(p.dDeliv, report, `Школа ${code}, ${mcode}, поставка`), date(p.dDone, report, `Школа ${code}, ${mcode}, завершение`),
      ]);
    }

    // Индивидуальные испытания систем
    for (const [scode, s] of Object.entries(o.ii ?? {})) {
      const systemId = systemIds.get(scode);
      if (!systemId) { report.warn(`Школа ${code}: система ${scode} отсутствует в справочнике — пропущена`); continue; }
      systems.push([objectId, systemId, text(s.st), s.idDocs ? 1 : 0]);
    }
  }

  report.add('sch_object_works', await insertMany(conn, 'sch_object_works',
    ['object_id', 'work_type_id', 'pct', 'plan_volume', 'fact_volume'], works));
  report.add('sch_work_progress', await insertMany(conn, 'sch_work_progress',
    ['object_id', 'work_type_id', 'report_date', 'pct', 'fact_volume', 'source'], progress));
  report.add('sch_object_materials', await insertMany(conn, 'sch_object_materials',
    ['object_id', 'material_id', 'maker', 'supplier', 'qty', 'unit', 'pay_pct', 'delivered_pct', 'installed_pct', 'delivery_date', 'done_date'], materials));
  report.add('sch_object_systems', await insertMany(conn, 'sch_object_systems',
    ['object_id', 'system_id', 'state', 'has_id_docs'], systems));

  // ---------- 3. Ресурсы по дням: журнал + «текущие» ресурсы школы ----------
  const resources = new Map(); // 'objectId|дата' → строка
  for (const [key, l] of Object.entries(S.log ?? {})) {
    const objectId = objectIds.get(l.obj);
    const day = date(l.date, report, `Журнал ресурсов ${key}`);
    if (!objectId || !day) { report.warn(`Журнал ресурсов ${key}: неизвестная школа или дата — пропущено`); continue; }
    resources.set(`${objectId}|${day}`, [objectId, day, count(l.people) ?? 0, count(l.tech) ?? 0,
      count(l.peopleBl) ?? 0, count(l.techBl) ?? 0, l.src === 'excel' ? 'excel' : 'import']);
  }
  for (const [code, o] of Object.entries(S.objects)) {
    const day = date(o.res?.date, report, `Школа ${code}, ресурсы`);
    if (!day) continue;
    const key = `${objectIds.get(code)}|${day}`;
    const row = [objectIds.get(code), day, count(o.res.people) ?? 0, count(o.res.tech) ?? 0,
      count(o.res.peopleBl) ?? 0, count(o.res.techBl) ?? 0, 'import'];
    const fromLog = resources.get(key);
    if (fromLog && fromLog.slice(2, 6).join() !== row.slice(2, 6).join()) {
      report.warn(`Школа ${code}: ресурсы на ${day} в карточке (${row.slice(2, 6)}) и в журнале (${fromLog.slice(2, 6)}) различаются — взяты из карточки`);
    }
    if (!fromLog || fromLog.slice(2, 6).join() !== row.slice(2, 6).join()) resources.set(key, row);
  }
  report.add('sch_daily_resources', await insertMany(conn, 'sch_daily_resources',
    ['object_id', 'report_date', 'people', 'tech', 'people_landscape', 'tech_landscape', 'source'], [...resources.values()]));

  // ---------- 4. Что ожидаем увидеть в базе (для сверки) и контрольные суммы ----------
  const objs = Object.values(S.objects);
  report.expect('sch_objects', objs.length);
  report.expect('sch_work_types', Object.keys(S.ref.works.items).length);
  report.expect('sch_materials', Object.keys(S.ref.materials.items).length);
  report.expect('sch_systems', Object.keys(S.ref.systems.items).length);
  report.expect('sch_object_works', objs.reduce((a, o) => a + Object.keys(o.works ?? {}).length, 0));
  report.expect('sch_work_progress', objs.reduce((a, o) => a + Object.keys(o.works ?? {}).length, 0));
  report.expect('sch_object_materials', objs.reduce((a, o) => a + Object.keys(o.proc ?? {}).length, 0));
  report.expect('sch_object_systems', objs.reduce((a, o) => a + Object.keys(o.ii ?? {}).length, 0));
  report.expect('sch_expertise', objs.filter((o) => o.mge).length);

  const [db] = await query('SELECT SUM(limit_total) AS lim, SUM(paid) AS paid FROM sch_objects', [], conn);
  report.sum('Лимит всего, ₽', moneySum(objs.map((o) => o.fin?.limitTotal), report, 'Лимит'), db.lim);
  report.sum('Оплачено, ₽', moneySum(objs.map((o) => o.fin?.paid), report, 'Оплачено'), db.paid);
  const [w] = await query('SELECT SUM(weight) AS w FROM sch_work_types', [], conn);
  report.sum('Сумма весов видов работ', Object.values(S.ref.works.items).reduce((a, x) => a + (num(x.w) ?? 0), 0), w.w);
}
