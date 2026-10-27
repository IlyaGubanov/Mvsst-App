// =====================================================================
//  Перенос «Сети, коллекторы, водные объекты» из networks.html (блок <script id="seed">).
//
//  Было (JSON)                                   → Стало (таблица)
//  meta.sections                                 → net_sections
//  виды работ (из кода модуля + из линий)        → net_work_kinds
//  objects {sub, designer, curator, docs…}       → net_objects (+ организации и кураторы)
//  objects[].contracts                           → net_contracts
//  objects[].lines                               → net_lines
//  weeks                                         → reporting_periods: пн–ср, план на пятницу, is_legacy = 1
//  weekly['2026-10-26'].rec7.f.open0             → net_line_fact (накопительно)
//  weekly['2026-10-26'].rec7 {ks, w, m}          → net_object_period (КС, рабочие, техника)
// =====================================================================

import { query } from '../../db.js';
import { text, num, count, date, json, addDays, insertMany, codeMap, moneySum } from './common.js';

export const meta = {
  code: 'networks',
  file: 'networks',
  block: 'seed',
  mainTable: 'net_objects',
  tables: ['net_line_fact', 'net_object_period', 'net_lines', 'net_contracts', 'net_objects', 'net_work_kinds', 'net_sections'],
};

// Справочник видов работ — в старом модуле он задан в коде (DEFAULT_WORKS), а не в данных
const DEFAULT_WORKS = [
  { id: 'open', name: 'Открытая прокладка', unit: 'п.м', group: 'Сети' },
  { id: 'closed', name: 'Закрытая прокладка', unit: 'п.м', group: 'Сети' },
  { id: 'san', name: 'Санация', unit: 'п.м', group: 'Сети' },
  { id: 'kol', name: 'Коллектор: ремонт/реконструкция', unit: 'п.м', group: 'Коллекторы' },
  { id: 'clean', name: 'Очистка пруда', unit: 'м³', group: 'Водные объекты' },
  { id: 'shore', name: 'Береговая полоса', unit: 'м', group: 'Водные объекты' },
  { id: 'memb', name: 'Мембрана', unit: 'м²', group: 'Водные объекты' },
];

const SECTION_SHORT = { rec: 'Реконструкция', avr: 'Аварийные', pond: 'Пруды', tp: 'Тех. присоединение', kol: 'Коллекторы' };

export async function run(conn, N, { dict, report, direction }) {
  // ---------- 1. Разделы и виды работ ----------
  // Короткие названия разделов (для подписей) в старом модуле заданы в коде — SEC_SHORT0
  report.add('net_sections', await insertMany(conn, 'net_sections', ['code', 'title', 'short_title', 'sort_order'],
    N.meta.sections.map((s, i) => [s.id, text(s.title), text(s.short) ?? SECTION_SHORT[s.id] ?? text(s.title), i + 1])));
  const sectionIds = await codeMap(conn, 'net_sections');

  const kinds = new Map(DEFAULT_WORKS.map((w) => [w.id, w]));
  for (const o of N.objects) {
    for (const l of o.lines) {
      if (!kinds.has(l.kind)) {
        kinds.set(l.kind, { id: l.kind, name: String(l.label || l.kind).replace(/ Ø.*$/, ''), unit: l.unit || 'п.м', group: 'Прочее' });
        report.warn(`Вид работ «${l.kind}» не было в справочнике модуля — добавлен по названию линии`);
      }
    }
  }
  report.add('net_work_kinds', await insertMany(conn, 'net_work_kinds', ['code', 'name', 'unit', 'group_name', 'sort_order'],
    [...kinds.values()].map((w, i) => [w.id, w.name, w.unit, w.group, i + 1])));
  const kindIds = await codeMap(conn, 'net_work_kinds');

  // ---------- 2. Объекты ----------
  const objectRows = [];
  for (const o of N.objects) {
    const sectionId = sectionIds.get(o.sec);
    if (!sectionId) { report.warn(`Объект ${o.id}: неизвестный раздел «${o.sec}» — пропущен`); continue; }
    const d = o.docs ?? {};
    objectRows.push([
      o.id, num(o.n), sectionId, text(o.name), text(o.short) ?? text(o.name), text(o.status),
      date(o.start, report, `Объект ${o.id}, начало`), date(o.end, report, `Объект ${o.id}, окончание`),
      await dict.orgId(o.sub), await dict.orgId(o.designer), await dict.personId(o.curator),
      text(d.psd), text(d.dwg), text(d.mge), text(d.sogl), text(d.soglG), text(d.order),
      text(o.note), text(o.note_end), o.archived ? 1 : 0, json(o.ex),
    ]);
  }
  report.add('net_objects', await insertMany(conn, 'net_objects',
    ['code', 'seq_no', 'section_id', 'name', 'short_name', 'source_status', 'plan_start', 'plan_end',
      'sub_org_id', 'designer_org_id', 'curator_person_id',
      'doc_psd', 'doc_dwg', 'doc_mge', 'doc_sogl', 'doc_sogl_g', 'doc_order', 'note', 'note_end', 'archived', 'example_fields'],
    objectRows));
  const objectIds = await codeMap(conn, 'net_objects');

  // Имена, которые в источнике встречаются ТОЛЬКО в полях-примерах (ex), — подставные: помечаем их
  const onlyExamples = (field) => {
    const real = new Set(N.objects.filter((o) => !o.ex?.includes(field)).map((o) => o[field]));
    return [...new Set(N.objects.filter((o) => o.ex?.includes(field)).map((o) => o[field]))].filter((n) => n && !real.has(n));
  };
  const marked = await dict.markExamples({
    people: onlyExamples('curator'),
    orgs: [...onlyExamples('sub'), ...onlyExamples('designer')],
  });
  if (marked.people || marked.orgs) {
    report.warn(`Качество данных: ${marked.people} кураторов и ${marked.orgs} организаций встречаются только как «пример» — помечены is_example`);
  }

  // ---------- 3. Договоры и линии ----------
  const contractRows = [];
  const lineRows = [];
  for (const o of N.objects) {
    const objectId = objectIds.get(o.id);
    if (!objectId) continue;
    o.contracts.forEach((c, i) => contractRows.push([
      objectId, text(c.no), date(c.date, report, `Объект ${o.id}, договор ${c.no}`), date(c.end, report, `Объект ${o.id}, договор ${c.no}`),
      num(c.cost) ?? 0, num(c.adv) ?? 0, num(c.ks) ?? 0, i + 1,
    ]));
    o.lines.forEach((l, i) => lineRows.push([
      objectId, l.id, kindIds.get(l.kind), text(l.label) ?? l.kind, text(l.unit) ?? 'п.м', num(l.plan),
      text(l.d), text(l.sn), i + 1,
    ]));
  }
  report.add('net_contracts', await insertMany(conn, 'net_contracts',
    ['object_id', 'contract_no', 'contract_date', 'end_date', 'cost', 'advance', 'ks_total', 'sort_order'], contractRows));
  report.add('net_lines', await insertMany(conn, 'net_lines',
    ['object_id', 'code', 'kind_id', 'label', 'unit', 'plan_volume', 'diameter', 'sn', 'sort_order'], lineRows));

  // Линия однозначно определяется парой «объект + код линии» ('open0' есть у многих объектов)
  const lineIds = new Map((await query('SELECT id, object_id, code FROM net_lines', [], conn))
    .map((r) => [`${r.object_id}|${r.code}`, r.id]));

  // ---------- 4. Периоды и недельные данные ----------
  // В отличие от МКД (план на пятницу), прежний модуль «Сетей» считал план на САМ понедельник недели
  // (planPct брал дату недели) — сохраняем это, чтобы история показателей не изменилась.
  const weeks = [...N.weeks].sort();
  report.add('reporting_periods', await insertMany(conn, 'reporting_periods',
    ['direction_id', 'period_start', 'period_end', 'plan_date', 'is_legacy', 'is_closed'],
    weeks.map((w, i) => [direction.id, w, addDays(w, 2), w, 1, i < weeks.length - 1 ? 1 : 0])));

  const periodRows = [];
  const factRows = [];
  let factsInSource = 0;
  for (const [week, byObject] of Object.entries(N.weekly)) {
    for (const [objectCode, e] of Object.entries(byObject)) {
      const objectId = objectIds.get(objectCode);
      if (!objectId) { report.warn(`Неделя ${week}: неизвестный объект ${objectCode} — пропущен`); continue; }
      periodRows.push([objectId, week, num(e.ks) ?? 0, count(e.w) ?? 0, count(e.m) ?? 0]);
      for (const [lineCode, fact] of Object.entries(e.f ?? {})) {
        factsInSource++;
        const lineId = lineIds.get(`${objectId}|${lineCode}`);
        if (!lineId) { report.warn(`Неделя ${week}, объект ${objectCode}: нет линии ${lineCode} — факт пропущен`); continue; }
        factRows.push([lineId, week, num(fact) ?? 0]);
      }
    }
  }
  report.add('net_object_period', await insertMany(conn, 'net_object_period',
    ['object_id', 'period_start', 'ks_closed', 'workers', 'machines'], periodRows));
  report.add('net_line_fact', await insertMany(conn, 'net_line_fact', ['line_id', 'period_start', 'fact_volume'], factRows));

  // ---------- 5. Сверка ----------
  report.expect('net_sections', N.meta.sections.length);
  report.expect('net_objects', N.objects.length);
  report.expect('net_contracts', N.objects.reduce((a, o) => a + o.contracts.length, 0));
  report.expect('net_lines', N.objects.reduce((a, o) => a + o.lines.length, 0));
  report.expect('net_object_period', Object.values(N.weekly).reduce((a, w) => a + Object.keys(w).length, 0));
  report.expect('net_line_fact', factsInSource);

  const [db] = await query('SELECT SUM(cost) AS cost, SUM(advance) AS adv FROM net_contracts', [], conn);
  const all = N.objects.flatMap((o) => o.contracts);
  report.sum('Стоимость договоров, ₽', moneySum(all.map((c) => c.cost), report, 'Стоимость договоров'), db.cost);
  report.sum('Аванс, ₽', moneySum(all.map((c) => c.adv), report, 'Аванс'), db.adv);
  const last = weeks.at(-1);
  const [ks] = await query('SELECT SUM(ks_closed) AS ks, SUM(workers) AS w, SUM(machines) AS m FROM net_object_period WHERE period_start = ?', [last], conn);
  const src = Object.values(N.weekly[last] ?? {});
  report.sum(`Закрыто КС на ${last}, ₽`, moneySum(src.map((e) => e.ks), report, `Закрыто КС на ${last}`), ks.ks);
  report.sum(`Рабочих на ${last}`, src.reduce((a, e) => a + (count(e.w) ?? 0), 0), ks.w);
  report.sum(`Техники на ${last}`, src.reduce((a, e) => a + (count(e.m) ?? 0), 0), ks.m);
}
