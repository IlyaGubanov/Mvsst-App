// =====================================================================
//  KPI «Благоустройство улиц» — перенос формул из streets.html.
//
//  Берётся последний отчёт программы КБУ (не позже даты).
//  Готовность = доля позиций (объект × вид работ с проектным объёмом > 0), где факт ≥ проекта.
//  «Завершены» — статусы ровно «Работы завершены» и «Сдан ЦККБ» (как в прежнем модуле).
//  Плана в отчёте нет — отставание не считается.
// =====================================================================

import { query, queryOne } from '../../db.js';
import { plural } from './common.js';

const DONE_STATUSES = ['Работы завершены', 'Сдан ЦККБ'];
const num = (x) => (x == null ? '—' : Number(x).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
const fdate = (iso) => (iso ? iso.split('-').reverse().join('.') : '—');

// Короткие подписи для очень длинных названий (как compactName в прежнем модуле)
const SHORT_NAMES = [
  ['Проезд от ул. Перерва до Иловайской ул. (ул. Перерва 1с.1)', 'Перерва → Иловайская'],
  ['Проезд от Новорогожской ул. до Рабочей ул, вл.93', 'Новорогожская → Рабочая, 93'],
  ['Проезд от улицы Радио до набережной Академика Туполева', 'Радио → наб. Туполева'],
  ['Проезд от Варшавского ш. д.146 до Кировоградской улицы (подъездная дорога к универсаму №70)', 'Варшавское, 146 → Кировоградская'],
  ['Донецкая улица, д.40(проезд около строения ОАО МОЭК и прилегающая территория к недостроенному гаражному комплексу)', 'Донецкая, 40 · проезд'],
  ['Пр-д от Хлебозаводского проезда до проектируемого проезда №3716', 'Хлебозаводский → пр-д № 3716'],
  ['Пр-д от Железнодорожного проезда к д.8а (завод "Стройдеталь")', 'Железнодорожный → д. 8а'],
  ['Территория вокруг производственных баз строительных трестов', 'Территория строительных баз'],
  ['Подъезд к заводу (в границах Ступинской улицы)', 'Подъезд к заводу · Ступинская'],
  ['Подъездная дорога к «ул. Кубанская д. 27»', 'Кубанская, 27 · подъезд'],
];
const compactName = (name) => SHORT_NAMES.reduce((s, [from, to]) => s.replace(from, to), name);

const lastReport = (program, date) => queryOne(
  'SELECT id, report_date FROM st_reports WHERE program = ? AND report_date <= ? ORDER BY report_date DESC LIMIT 1',
  [program, date],
);

export async function computeStreetsKpi(direction, date) {
  const report = await lastReport('kbu', date);
  if (!report) return null;

  // Строки отчёта в порядке Excel (порядок вставки при переносе)
  const rows = await query(
    `SELECT ro.id, ro.status, ro.people, ro.tech, ro.remarks, o.id AS object_id, o.code, o.name
       FROM st_report_objects ro JOIN st_objects o ON o.id = ro.object_id
      WHERE ro.report_id = ? ORDER BY ro.id`,
    [report.id],
  );
  const values = await query(
    `SELECT v.report_object_id, v.plan_volume, v.fact_volume
       FROM st_report_values v JOIN st_report_objects ro ON ro.id = v.report_object_id
      WHERE ro.report_id = ?`,
    [report.id],
  );

  // Позиции: только виды работ с проектным объёмом > 0
  let positions = 0;
  let positionsDone = 0;
  const open = new Map(); // строка отчёта → сколько позиций с остатком
  for (const v of values) {
    if (!(v.plan_volume > 0)) continue;
    positions++;
    if (v.fact_volume != null && v.fact_volume + 1e-7 >= v.plan_volume) positionsDone++;
    else open.set(v.report_object_id, (open.get(v.report_object_id) ?? 0) + 1);
  }
  const isDone = (r) => DONE_STATUSES.includes(r.status);
  const sumN = (key) => {
    const vals = rows.map((r) => r[key]).filter((x) => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const current = await lastReport('current', date);
  let extra = null;
  if (current) {
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM st_report_objects WHERE report_id = ?', [current.id]);
    extra = { label: 'Текущий ремонт', value: `${n} объект${plural(n, ['', 'а', 'ов'])} · отчёт ${fdate(current.report_date)}` };
  }

  const withRemarks = rows
    .map((r, i) => [r, i])
    .filter(([r]) => r.remarks > 0)
    .sort((a, b) => b[0].remarks - a[0].remarks || a[1] - b[1])
    .map(([r]) => r);

  return {
    asOf: report.report_date,
    asOfKind: 'report',
    local: false,
    readonly: false, // ручной ввод отчётов теперь возможен
    objects: rows.length,
    unit: direction.unitLabel,
    lagging: null,
    critical: null,
    fact: positions ? positionsDone / positions : null,
    plan: null,
    factLabel: 'Позиций с выполненным проектным объёмом',
    people: sumN('people'),
    tech: sumN('tech'),
    money: null,
    kpis: [
      { l: 'Завершены по статусу', v: `${rows.filter(isDone).length} из ${rows.length}` },
      { l: 'Есть остаток объёмов', v: String(rows.filter((r) => !isDone(r) && open.get(r.id) > 0).length) },
      { l: 'Замечаний в отчёте', v: num(sumN('remarks')) },
    ],
    extra,
    remarks: withRemarks.slice(0, 8).map((r) => ({
      id: r.object_id, code: r.code, name: compactName(r.name),
      sub: (r.status || 'статус не указан') + (open.get(r.id) ? ` · остаток по ${open.get(r.id)} поз.` : ''),
      n: r.remarks,
    })),
  };
}
