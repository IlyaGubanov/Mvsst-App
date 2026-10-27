// =====================================================================
//  Перенос «Благоустройство улиц» из streets.html
//  (блоки <script id="data"> — отчёты и <script id="geodata"> — координаты).
//
//  Было (JSON)                                      → Стало (таблица)
//  works                                            → st_work_types
//  catalog + geodata.verified / unverified          → st_objects (с координатами для карты)
//  snapshots[] {program, date, sheet}               → st_reports (source = 'import', закрыты)
//  snapshots[].objects[] {status, people, remarks}  → st_report_objects (meta → source_meta)
//  snapshots[].objects[].works.curbOld {p, f, a}    → st_report_values (a → alt_fact_volume)
//  source, excluded, discrepancies, unitsNote       → app_settings 'streets.source'
//
//  Контуры карты (mapdata, ~6 МБ) в базу не переносим: карта будет брать подложку OpenStreetMap.
// =====================================================================

import { query } from '../../db.js';
import { text, num, count, date, json, insertMany, codeMap, saveSetting, readJsonBlock } from './common.js';

export const meta = {
  code: 'streets',
  file: 'streets',
  block: 'data',
  mainTable: 'st_objects',
  tables: ['st_report_values', 'st_report_objects', 'st_reports', 'st_objects', 'st_work_types'],
};

/** Для благоустройства нужен ещё блок с координатами — читаем его из того же файла. */
export function readExtra(file) {
  return { geo: readJsonBlock(file, 'geodata') };
}

// Значение «процента из таблицы» должно влезть в DECIMAL(9,6)
const MAX_SOURCE_PCT = 999;

export async function run(conn, T, { report, extra, importId }) {
  const geo = extra?.geo ?? { verified: {}, unverified: {} };

  // ---------- 1. Виды работ ----------
  report.add('st_work_types', await insertMany(conn, 'st_work_types', ['code', 'name', 'unit', 'sort_order'],
    T.works.map((w, i) => [w.id, text(w.name), text(w.unit), i + 1])));
  const workIds = await codeMap(conn, 'st_work_types');

  // ---------- 2. Объекты: каталог + все, что встречаются в отчётах ----------
  const objects = new Map(); // код → { name, okrug }
  for (const c of T.catalog ?? []) objects.set(c.id, { name: text(c.name), okrug: text(c.okrug) });
  for (const s of [...T.snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const o of s.objects) {
      if (!objects.has(o.id)) objects.set(o.id, { name: text(o.name), okrug: text(o.okrug) });
    }
  }
  const objectRows = [...objects.entries()].map(([code, o], i) => {
    const v = geo.verified?.[code];
    const unverified = geo.unverified?.[code];
    return [
      code, o.name ?? code, o.okrug ?? text(v?.verifiedDistrict),
      num(v?.lat), num(v?.lon), text(v?.precision ?? unverified), text(v?.source), v ? 1 : 0, 0,
    ];
  });
  report.add('st_objects', await insertMany(conn, 'st_objects',
    ['code', 'name', 'okrug', 'lat', 'lon', 'geo_precision', 'geo_source', 'geo_verified', 'archived'], objectRows));
  const objectIds = await codeMap(conn, 'st_objects');

  // ---------- 3. Отчёты: шапка → строки по объектам → объёмы ----------
  let rowsInSource = 0;
  let valuesInSource = 0;
  const numericStatuses = new Set();
  let lowercaseDone = 0;

  for (const s of [...T.snapshots].sort((a, b) => a.date.localeCompare(b.date) || a.program.localeCompare(b.program))) {
    const reportDate = date(s.date, report, `Отчёт «${s.sheet}»`);
    if (!reportDate) continue;
    const r = await query(
      `INSERT INTO st_reports (program, report_date, source, sheet_name, import_id, is_closed)
       VALUES (?, ?, 'import', ?, ?, 1)`,
      [s.program, reportDate, text(s.sheet), importId ?? null], conn,
    );
    const reportId = r.insertId;
    report.add('st_reports', 1);

    const rowObjects = [];
    for (const o of s.objects) {
      rowsInSource++;
      const status = text(o.status);
      // Качество данных: в части листов в столбец статуса попала дата Excel (число вроде 46143)
      if (status && /^\d{5}$/.test(status)) numericStatuses.add(s.sheet);
      if (status === 'работы завершены') lowercaseDone++;
      rowObjects.push([reportId, objectIds.get(o.id), status, count(o.row), count(o.people), count(o.tech), count(o.remarks), json(o.meta)]);
    }
    report.add('st_report_objects', await insertMany(conn, 'st_report_objects',
      ['report_id', 'object_id', 'status', 'source_row', 'people', 'tech', 'remarks', 'source_meta'], rowObjects));

    // id строк отчёта, чтобы привязать к ним объёмы
    const rowIds = new Map((await query('SELECT id, object_id FROM st_report_objects WHERE report_id = ?', [reportId], conn))
      .map((x) => [x.object_id, x.id]));

    const values = [];
    for (const o of s.objects) {
      for (const [workCode, v] of Object.entries(o.works ?? {})) {
        const p = num(v.p);
        const f = num(v.f);
        const a = num(v.a);
        if (p === null && f === null && a === null) continue; // пустая ячейка — не храним
        valuesInSource++;
        const workId = workIds.get(workCode);
        if (!workId) { report.warn(`Отчёт ${s.date}: неизвестный вид работ «${workCode}» — пропущен`); continue; }
        let pct = num(v.sourcePct);
        if (pct !== null && Math.abs(pct) > MAX_SOURCE_PCT) pct = null;
        values.push([rowIds.get(objectIds.get(o.id)), workId, p, f, a, pct]);
      }
    }
    report.add('st_report_values', await insertMany(conn, 'st_report_values',
      ['report_object_id', 'work_type_id', 'plan_volume', 'fact_volume', 'alt_fact_volume', 'source_pct'], values));
  }

  if (numericStatuses.size) {
    report.warn(`Качество данных: в ${numericStatuses.size} листах в столбце «Статус» число (дата Excel, например 46143 = 01.05.2026) — перенесено как есть`);
  }
  if (lowercaseDone) {
    report.warn(`Качество данных: ${lowercaseDone} раз статус «работы завершены» со строчной буквы — прежний модуль не считает их завершёнными; перенесено как есть`);
  }

  // ---------- 4. Сведения об источнике ----------
  await saveSetting(conn, 'streets.source', {
    source: T.source, sheetCount: T.sheetCount, unitsNote: T.unitsNote,
    excluded: T.excluded ?? [], discrepancies: T.discrepancies ?? [],
    geoDate: geo.date ?? null, geoAttribution: geo.attribution ?? null,
  });

  // ---------- 5. Сверка ----------
  report.expect('st_work_types', T.works.length);
  report.expect('st_objects', objects.size);
  report.expect('st_reports', T.snapshots.length);
  report.expect('st_report_objects', rowsInSource);
  report.expect('st_report_values', valuesInSource);

  const lastKbu = T.snapshots.filter((s) => s.program === 'kbu').sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (lastKbu) {
    const [db] = await query(
      `SELECT SUM(ro.remarks) AS remarks, SUM(ro.people) AS people
         FROM st_report_objects ro JOIN st_reports r ON r.id = ro.report_id
        WHERE r.program = 'kbu' AND r.report_date = ?`,
      [lastKbu.date], conn,
    );
    report.sum(`Замечаний в отчёте КБУ ${lastKbu.date}`, lastKbu.objects.reduce((a, o) => a + (count(o.remarks) ?? 0), 0), db.remarks);
    report.sum(`Людей в отчёте КБУ ${lastKbu.date}`, lastKbu.objects.reduce((a, o) => a + (count(o.people) ?? 0), 0), db.people);
  }
}
