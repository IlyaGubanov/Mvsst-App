// =====================================================================
//  «Капремонт МКД» — экран «Сводка» раздела (vSummary, seriesByWeek, weekEvents прежнего модуля).
//
//  Считается сразу по ВСЕМ отчётным периодам: позиция на период — последний статус не позже него
//  (как snapAt прежнего модуля). Отсюда — график освоения нарастающим итогом и «что изменилось»
//  между выбранным периодом и предыдущим.
//
//  Фильтры, как в прежнем модуле: раздел (лот), группа работ, сотрудник (куратор адреса,
//  ответственный за ввод или ответственный за позицию), поиск по адресу и виду работ.
// =====================================================================

import { query, queryOne } from '../../db.js';
import { agg, calcItem, makeRisk } from './mkd.js';

/** Настройка из app_settings (значение — JSON). */
async function getSetting(key) {
  const row = await queryOne('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
  return typeof row?.setting_value === 'string' ? JSON.parse(row.setting_value) : row?.setting_value ?? null;
}

const ST_ORDER = ['paid', 'ks', 'work', 'stop', 'plan', 'excl'];

/** Позиции (не в архиве) с адресом, разделом, группой и названием вида работ. */
function loadItems() {
  return query(
    `SELECT i.id, i.object_id, i.contract_amount, i.inwork_amount, i.approx_amount, i.plan_start, i.plan_end,
            i.responsible_person_id, o.address, o.section_id, o.curator_person_id, o.entry_person_id,
            t.name AS type_name, t.group_name, t.code AS type_code
       FROM mkd_items i JOIN mkd_objects o ON o.id = i.object_id JOIN mkd_work_types t ON t.id = i.work_type_id
      WHERE i.archived = 0 AND o.archived = 0 ORDER BY i.id`,
  );
}

/** Отбор позиций по фильтрам (filtItems прежнего модуля). */
export function filterItems(items, f) {
  const q = (f.q || '').trim().toLowerCase();
  return items.filter((i) => {
    if (f.section && i.section_id !== f.section) return false;
    if (f.group && (i.group_name || 'Прочее') !== f.group) return false;
    if (f.person && ![i.curator_person_id, i.entry_person_id, i.responsible_person_id].includes(f.person)) return false;
    if (q && !(i.address.toLowerCase().includes(q) || i.type_name.toLowerCase().includes(q))) return false;
    return true;
  });
}
export const isFiltered = (f) => Boolean(f.section || f.group || f.person || (f.q || '').trim());

/**
 * История МКД: позиции, все периоды (по возрастанию) и функция calcAt(period) →
 * Map(itemId → { c: расчёт позиции, s: статус }) с запоминанием, как calcAll прежнего модуля.
 */
export async function loadMkdHistory(direction) {
  const [items, periods, statuses] = await Promise.all([
    loadItems(),
    query(
      `SELECT period_start, period_end, plan_date, is_legacy, is_closed FROM reporting_periods
        WHERE direction_id = ? ORDER BY period_start`,
      [direction.id],
    ),
    query('SELECT item_id, period_start, status, pct, ks_amount, paid_amount, note FROM mkd_item_status ORDER BY period_start'),
  ]);
  const byItem = new Map();
  statuses.forEach((s) => {
    if (!byItem.has(s.item_id)) byItem.set(s.item_id, []);
    byItem.get(s.item_id).push(s); // по возрастанию периода
  });
  const riskOf = makeRisk({ warn: direction.thrWarn, crit: direction.thrCrit });
  const cache = new Map();
  const calcAt = (p) => {
    if (cache.has(p.period_start)) return cache.get(p.period_start);
    const m = new Map();
    for (const it of items) {
      let s;
      for (const x of byItem.get(it.id) ?? []) { if (x.period_start > p.period_start) break; s = x; }
      m.set(it.id, { s, c: calcItem(it, s, p.plan_date, riskOf) });
    }
    cache.set(p.period_start, m);
    return m;
  };
  return { items, periods, calcAt, riskOf };
}

/** Деньги и готовность «агрегата» для интерфейса (проценты 0..100, суммы в рублях). */
const money = (a) => ({
  n: a.n, contract: a.contract, ks: a.ks, paid: a.paid, topay: a.topay, inwork: a.inwork,
  openForecast: a.openForecast, forecast: a.forecast, econ: a.econ,
  pct: a.pct, plan: a.plan, lag: a.lag, risk: a.riskLvl, overdue: a.overdue,
});

/**
 * «Сводка» раздела на период.
 * @param {string} periodStart — начало выбранного периода
 * @param {object} f — фильтры { section, group, person, q }
 */
export async function computeMkdSummary(direction, periodStart, f) {
  const H = await loadMkdHistory(direction);
  const idx = H.periods.findIndex((p) => p.period_start === periodStart);
  const period = H.periods[idx];
  const prev = idx > 0 ? H.periods[idx - 1] : null;
  const items = filterItems(H.items, f);

  const C = H.calcAt(period);
  const P = prev ? H.calcAt(prev) : null;
  const cs = items.map((i) => C.get(i.id).c);
  const a = agg(cs, H.riskOf);
  const b = P ? agg(items.map((i) => P.get(i.id).c), H.riskOf) : null;

  // Адреса и их риск («светофор»); отставание — 10 худших
  const byObject = new Map();
  items.forEach((i) => {
    if (!byObject.has(i.object_id)) byObject.set(i.object_id, { id: i.object_id, address: i.address, sectionId: i.section_id, cs: [] });
    byObject.get(i.object_id).cs.push(C.get(i.id).c);
  });
  const objects = [...byObject.values()].map((o) => ({ ...o, a: agg(o.cs, H.riskOf) }));
  const objRisk = { ok: 0, warn: 0, crit: 0, na: 0 };
  objects.forEach((o) => objRisk[o.a.riskLvl]++);
  const worst = objects.filter((o) => o.a.lag != null).sort((x, y) => x.a.lag - y.a.lag).slice(0, 10)
    .map((o) => ({ id: o.id, address: o.address, pct: o.a.pct, plan: o.a.plan, lag: o.a.lag, risk: o.a.riskLvl }));

  // Разделы (лоты) — с отдельной строкой «Без раздела», если такие адреса есть
  const sections = await query('SELECT id, name FROM mkd_sections ORDER BY sort_order, id');
  const known = new Set(sections.map((s) => s.id));
  const sectionRows = [...sections, { id: null, name: 'Без раздела' }].map((s) => {
    const its = items.filter((i) => (known.has(i.section_id) ? i.section_id : null) === s.id);
    if (!its.length) return null;
    return { id: s.id, name: s.name, objects: new Set(its.map((i) => i.object_id)).size, ...money(agg(its.map((i) => C.get(i.id).c), H.riskOf)) };
  }).filter(Boolean);

  // Освоение нарастающим итогом по всем периодам (seriesByWeek): деньги — в рублях
  const series = H.periods.map((p) => {
    const M = H.calcAt(p);
    const list = items.map((i) => M.get(i.id).c);
    const x = agg(list, H.riskOf);
    return {
      start: p.period_start, end: p.period_end, isLegacy: Boolean(p.is_legacy),
      pct: x.pct, planPct: x.plan, ks: x.ks, paid: x.paid, topay: x.topay,
      fact: list.reduce((s, c) => s + (c.forecast * c.pct) / 100, 0),                 // выполнено физически
      plan: list.reduce((s, c) => s + (c.plan == null ? 0 : (c.forecast * c.plan) / 100), 0), // план по графику
    };
  });

  // Что изменилось за период (weekEvents)
  const changes = { dPaid: 0, dKs: 0, nPaid: 0, nKs: 0, dPct: b ? a.pct - b.pct : null, events: [] };
  if (P) {
    for (const i of items) {
      const { c, s } = C.get(i.id);
      const { c: p, s: ps } = P.get(i.id);
      const dp = c.paid - p.paid;
      const dk = c.ks - p.ks;
      if (dp > 0.5) { changes.dPaid += dp; changes.nPaid++; }
      if (dk > 0.5) { changes.dKs += dk; changes.nKs++; }
      const base = { objectId: i.object_id, address: i.address, workType: i.type_name };
      if (c.st !== p.st) changes.events.push({ ...base, kind: 'status', sort: 3, from: p.st, to: c.st, paid: dp > 0.5 ? dp : null, ks: dp > 0.5 ? null : dk > 0.5 ? dk : null });
      else if (c.pct - p.pct >= 10) changes.events.push({ ...base, kind: 'pct', sort: 2, from: p.pct, to: c.pct });
      // Комментарий — только если он внесён именно за этот период и отличается от прежнего
      if (s?.note && (!ps || ps.note !== s.note) && s.period_start === period.period_start) {
        changes.events.push({ ...base, kind: 'note', sort: 1, note: s.note });
      }
    }
    changes.events.sort((x, y) => y.sort - x.sort);
  }

  const source = isFiltered(f) ? null : await getSetting('mkd.source');
  return {
    total: money(a),
    prevTotal: b ? money(b) : null,
    prevPeriod: prev ? { start: prev.period_start, end: prev.period_end, isLegacy: Boolean(prev.is_legacy) } : null,
    objects: objects.length,
    objRisk,
    statuses: ST_ORDER.filter((k) => a.st[k]).map((k) => ({ code: k, n: a.st[k] })),
    sections: sectionRows,
    worst,
    series,
    changes,
    docContract: source?.docContract ?? null, // итог договоров в исходной таблице (до исключений) — для сверки
    filtered: isFiltered(f),
  };
}
