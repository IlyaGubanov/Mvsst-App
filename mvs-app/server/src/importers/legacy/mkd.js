// =====================================================================
//  Перенос «Капремонт МКД» из mkd.html (блок <script id="seed">).
//
//  Было (JSON)                                 → Стало (таблица)
//  sections, workTypes                         → mkd_sections, mkd_work_types
//  people, orgs                                → people, organizations (общие справочники)
//  objects                                     → mkd_objects
//  items                                       → mkd_items
//  weeks (понедельники)                        → reporting_periods: пн–ср, план на пятницу, is_legacy = 1
//  snaps.i1['2026-10-26'] {st, pct, ks, paid}  → mkd_item_status (pct 0–100 → доля 0–1)
//  meta (сверочные итоги документа)            → app_settings 'mkd.source'
//  log                                         → audit_log (действие «import»)
// =====================================================================

import { query } from '../../db.js';
import { text, num, date, dateTime, json, addDays, insertMany, codeMap, saveSetting, moneySum } from './common.js';

export const meta = {
  code: 'mkd',
  file: 'mkd',
  block: 'seed',
  mainTable: 'mkd_objects',
  tables: ['mkd_item_status', 'mkd_items', 'mkd_objects', 'mkd_work_types', 'mkd_sections'],
};

const STATUSES = new Set(['plan', 'work', 'stop', 'ks', 'paid', 'excl']);

export async function run(conn, M, { dict, report, direction }) {
  // ---------- 1. Справочники ----------
  report.add('mkd_sections', await insertMany(conn, 'mkd_sections', ['code', 'name', 'note', 'sort_order'],
    M.sections.map((s, i) => [s.id, text(s.name), text(s.note), i + 1])));

  report.add('mkd_work_types', await insertMany(conn, 'mkd_work_types', ['code', 'name', 'full_name', 'group_name', 'unit', 'sort_order'],
    M.workTypes.map((w, i) => [w.id, text(w.name), text(w.full), text(w.group), text(w.unit), i + 1])));

  const personIds = new Map();
  for (const p of M.people) {
    personIds.set(p.id, await dict.personId(p.name, { code: p.id, position: p.role, phone: p.phone, email: p.email, isExample: p.ex }));
  }
  const orgIds = new Map();
  for (const g of M.orgs) orgIds.set(g.id, await dict.orgId(g.name, { code: g.id, isExample: g.ex }));

  const sectionIds = await codeMap(conn, 'mkd_sections');
  const typeIds = await codeMap(conn, 'mkd_work_types');

  // ---------- 2. Адреса и позиции ----------
  report.add('mkd_objects', await insertMany(conn, 'mkd_objects',
    ['code', 'address', 'section_id', 'curator_person_id', 'entry_person_id', 'note', 'archived', 'example_fields'],
    M.objects.map((o) => [
      o.id, text(o.addr), sectionIds.get(o.sectionId) ?? null, personIds.get(o.curatorId) ?? null,
      personIds.get(o.entryId) ?? null, text(o.note), o.archived ? 1 : 0, json(o.ex),
    ])));
  const objectIds = await codeMap(conn, 'mkd_objects');

  const itemRows = [];
  for (const it of M.items) {
    const objectId = objectIds.get(it.objId);
    const typeId = typeIds.get(it.typeId);
    if (!objectId || !typeId) { report.warn(`Позиция ${it.id}: неизвестный адрес или вид работ — пропущена`); continue; }
    itemRows.push([
      it.id, objectId, typeId, num(it.n), num(it.srcRow), num(it.contract) ?? 0, num(it.inwork), num(it.approx),
      date(it.start, report, `Позиция ${it.id}, начало`), date(it.end, report, `Позиция ${it.id}, окончание`),
      personIds.get(it.respId) ?? null, orgIds.get(it.orgId) ?? null, text(it.note), it.archived ? 1 : 0, json(it.ex),
    ]);
  }
  report.add('mkd_items', await insertMany(conn, 'mkd_items',
    ['code', 'object_id', 'work_type_id', 'item_no', 'src_row', 'contract_amount', 'inwork_amount', 'approx_amount',
      'plan_start', 'plan_end', 'responsible_person_id', 'org_id', 'note', 'archived', 'example_fields'], itemRows));
  const itemIds = await codeMap(conn, 'mkd_items');

  // ---------- 3. Отчётные недели → периоды ----------
  // Старые недели становятся периодами пн–ср; план — на пятницу, как считал прежний модуль.
  // Все, кроме последней, закрываем: это история. Последняя остаётся открытой для ввода.
  const weeks = [...M.weeks].sort();
  report.add('reporting_periods', await insertMany(conn, 'reporting_periods',
    ['direction_id', 'period_start', 'period_end', 'plan_date', 'is_legacy', 'is_closed'],
    weeks.map((w, i) => [direction.id, w, addDays(w, 2), addDays(w, 4), 1, i < weeks.length - 1 ? 1 : 0])));

  // ---------- 4. Статусы позиций по неделям ----------
  const statusRows = [];
  for (const [itemCode, history] of Object.entries(M.snaps)) {
    const itemId = itemIds.get(itemCode);
    if (!itemId) { report.warn(`Статусы позиции ${itemCode}: позиции нет — пропущены`); continue; }
    for (const [week, s] of Object.entries(history)) {
      const status = STATUSES.has(s.st) ? s.st : 'plan';
      if (status !== s.st) report.warn(`Позиция ${itemCode}, неделя ${week}: неизвестный статус «${s.st}» → «plan»`);
      const pct = Math.min(100, Math.max(0, num(s.pct) ?? 0)) / 100; // в старом модуле 0–100, у нас доля 0–1
      statusRows.push([
        itemId, week, status, Math.round(pct * 10000) / 10000, num(s.ks) ?? 0, num(s.paid) ?? 0, text(s.note),
        personIds.get(s.by) ?? null, dateTime(s.at) ?? `${week} 00:00:00`, s.ex ? 1 : 0,
      ]);
    }
  }
  report.add('mkd_item_status', await insertMany(conn, 'mkd_item_status',
    ['item_id', 'period_start', 'status', 'pct', 'ks_amount', 'paid_amount', 'note', 'entered_by_person_id', 'entered_at', 'is_example'],
    statusRows));

  // ---------- 5. Настройки и журнал ----------
  // Сверочные итоги из исходного документа — пригодятся в разделе «Качество данных»
  await saveSetting(conn, 'mkd.source', {
    title: M.meta.title, subtitle: M.meta.subtitle, source: M.meta.source,
    docContract: M.meta.docContract, docRows: M.meta.docRows, created: M.meta.created,
  });
  // Пороги отставания из данных модуля (в данных они отрицательные: −5, −15)
  if (M.meta.thr) {
    await query('UPDATE directions SET thr_warn = ?, thr_crit = ? WHERE id = ?',
      [Math.abs(num(M.meta.thr.warn) ?? 5), Math.abs(num(M.meta.thr.crit) ?? 15), direction.id], conn);
  }
  const logRows = (M.log ?? []).map((l) => [
    dateTime(l.t) ?? new Date().toISOString().slice(0, 19).replace('T', ' '), null, text(l.u) ?? 'Система',
    direction.id, 'legacy_log', null, null, 'import', `${text(l.a) ?? ''}: ${text(l.d) ?? ''}`.slice(0, 500), null, null,
  ]);
  if (logRows.length) {
    await insertMany(conn, 'audit_log',
      ['created_at', 'user_id', 'user_name', 'direction_id', 'entity', 'entity_id', 'entity_name', 'action', 'summary', 'changes', 'ip'], logRows);
  }

  // ---------- 6. Сверка ----------
  report.expect('mkd_sections', M.sections.length);
  report.expect('mkd_work_types', M.workTypes.length);
  report.expect('mkd_objects', M.objects.length);
  report.expect('mkd_items', M.items.length);
  report.expect('mkd_item_status', Object.values(M.snaps).reduce((a, h) => a + Object.keys(h).length, 0));

  const [db] = await query('SELECT SUM(contract_amount) AS c FROM mkd_items', [], conn);
  report.sum('Стоимость договоров по позициям, ₽', moneySum(M.items.map((i) => i.contract), report, 'Стоимость договоров'), db.c);
  const last = weeks.at(-1);
  const [st] = await query('SELECT SUM(ks_amount) AS ks, SUM(paid_amount) AS paid FROM mkd_item_status WHERE period_start = ?', [last], conn);
  const srcLast = Object.values(M.snaps).map((h) => h[last]).filter(Boolean);
  report.sum(`КС-2 на ${last}, ₽`, moneySum(srcLast.map((s) => s.ks), report, `КС-2 на ${last}`), st.ks);
  report.sum(`Оплачено на ${last}, ₽`, moneySum(srcLast.map((s) => s.paid), report, `Оплачено на ${last}`), st.paid);
}
