// =====================================================================
//  common.js — общие части переноса данных из старых HTML-дашбордов.
//
//  Старый дашборд хранит данные внутри HTML-файла в блоке
//      <script id="data" type="application/json"> { … } </script>
//  Мы находим этот блок, читаем JSON и раскладываем по таблицам MySQL.
//  Код старого дашборда НЕ выполняется — читаются только данные.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { query } from '../../db.js';

// ---------------------------------------------------------------------
// Чтение файлов
// ---------------------------------------------------------------------

/**
 * Найти файл модуля: подходит папка с html-файлами напрямую, корень распакованного
 * архива (src/originals/ или modules/).
 */
export function findModuleFile(dir, name) {
  const candidates = [
    path.join(dir, `${name}.html`),
    path.join(dir, 'src', 'originals', `${name}.html`),
    path.join(dir, 'modules', `${name}.html`),
  ];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error(`Не найден файл ${name}.html в папке ${dir} (искали также src/originals и modules)`);
  return found;
}

/** Достать JSON из блока <script id="…" type="application/json">. */
export function readJsonBlock(file, blockId) {
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(new RegExp(`<script id="${blockId}" type="application/json">([\\s\\S]*?)</script>`));
  if (!match) throw new Error(`В файле ${path.basename(file)} нет блока данных <script id="${blockId}">`);
  return JSON.parse(match[1]);
}

// ---------------------------------------------------------------------
// Приведение значений: в старых данных встречаются пустые строки, null, текст вместо чисел
// ---------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Текст: обрезать пробелы, пустое → null. */
export function text(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Число или null (пусто, «#REF!», мусор → null). */
export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Деньги: округлить до копеек (так их хранит база — DECIMAL(15,2)). */
export function money(value) {
  const n = num(value);
  return n === null ? null : Math.round(n * 100) / 100;
}

/**
 * Сумма денег для сверки: складываем уже округлённые до копеек значения — ровно то, что лежит в базе.
 * Если в источнике были доли копейки (артефакты формул Excel), пишем предупреждение с разницей.
 */
export function moneySum(values, report, label) {
  let raw = 0;
  let rounded = 0;
  let fractional = 0;
  for (const v of values) {
    const n = num(v) ?? 0;
    raw += n;
    rounded += money(n);
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) fractional++;
  }
  if (fractional) {
    report.warn(`${label}: ${fractional} сумм в источнике с долями копейки — округлены до копеек (разница в итоге ${(rounded - raw).toFixed(4)} ₽)`);
  }
  return rounded;
}

/** Целое неотрицательное число (люди, техника) или null. */
export function count(value) {
  const n = num(value);
  return n === null || n < 0 ? null : Math.round(n);
}

/** Дата 'ГГГГ-ММ-ДД' или null. Нераспознанное значение попадает в предупреждения. */
export function date(value, report, where) {
  const s = text(value);
  if (s === null) return null;
  if (ISO_DATE.test(s)) return s;
  report.warn(`${where}: «${s}» — не дата, поле оставлено пустым`);
  return null;
}

/** «14.07.2026-10.08.2026» → ['2026-07-14', '2026-08-10']; иначе [null, null]. */
export function ruPeriod(value) {
  const m = text(value)?.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? [`${m[3]}-${m[2]}-${m[1]}`, `${m[6]}-${m[5]}-${m[4]}`] : [null, null];
}

/** Прибавить дни к дате 'ГГГГ-ММ-ДД'. */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Массив/объект → JSON-строка для колонки JSON; пустое → null. */
export function json(value) {
  if (!value) return null;
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  return empty ? null : JSON.stringify(value);
}

/** '2026-09-25T11:12' → '2026-09-25 11:12:00' (формат DATETIME). */
export function dateTime(value) {
  const s = text(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]} ${m[2]}${m[3] || ':00'}` : null;
}

// ---------------------------------------------------------------------
// Работа с базой
// ---------------------------------------------------------------------

/**
 * Вставить много строк пачками по 1000 (один запрос на пачку — в сотни раз быстрее, чем по одной).
 * Имя таблицы и колонок задаёт только наш код, значения передаются через «?».
 */
export async function insertMany(conn, table, columns, rows, chunkSize = 1000) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows.slice(i, i + chunkSize)], conn);
  }
  return rows.length;
}

/** Соответствие «старый код → новый id» для таблицы с колонкой code. */
export async function codeMap(conn, table) {
  const rows = await query(`SELECT id, code FROM ${table}`, [], conn);
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Записать настройку в app_settings (создать или заменить). */
export async function saveSetting(conn, key, value) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, JSON.stringify(value)], conn,
  );
}

// ---------------------------------------------------------------------
// Общие справочники: сотрудники (people) и организации (organizations).
// Одна и та же организация может встретиться в нескольких направлениях —
// ищем по названию (без учёта регистра), чтобы не создавать дублей.
// ---------------------------------------------------------------------

export class Dictionaries {
  constructor(conn, report) {
    this.conn = conn;
    this.report = report;
    this.people = new Map();
    this.orgs = new Map();
    // Что создано в этом переносе — только их можно пометить «примером» (уже существующие не трогаем)
    this.createdPeople = new Set();
    this.createdOrgs = new Set();
  }

  /**
   * Пометить «примером» (is_example = 1) сотрудников и организации, созданные в этом переносе.
   * Нужны для данных, где имя было подставлено вместо настоящего (в старом модуле такие поля подсвечивались).
   */
  async markExamples({ people = [], orgs = [] }) {
    const pick = (names, map, created) => names
      .map((n) => map.get(Dictionaries.clean(n)?.toLowerCase()))
      .filter((id) => id && created.has(id));
    const p = pick(people, this.people, this.createdPeople);
    const o = pick(orgs, this.orgs, this.createdOrgs);
    if (p.length) await query('UPDATE people SET is_example = 1 WHERE id IN (?)', [p], this.conn);
    if (o.length) await query('UPDATE organizations SET is_example = 1 WHERE id IN (?)', [o], this.conn);
    return { people: p.length, orgs: o.length };
  }

  async load() {
    for (const r of await query('SELECT id, full_name FROM people', [], this.conn)) this.people.set(r.full_name.toLowerCase(), r.id);
    for (const r of await query('SELECT id, name FROM organizations', [], this.conn)) this.orgs.set(r.name.toLowerCase(), r.id);
    return this;
  }

  /** Имя без лишних пробелов; заглушки «?», «—» и пустые → null. */
  static clean(name) {
    const s = text(name)?.replace(/\s+/g, ' ');
    return !s || /^[?\-—–.]+$/.test(s) ? null : s;
  }

  /** id сотрудника по ФИО (создаёт, если нет). extra: { code, position, phone, email, isExample } */
  async personId(name, extra = {}) {
    const clean = Dictionaries.clean(name);
    if (!clean) return null;
    const key = clean.toLowerCase();
    if (!this.people.has(key)) {
      const r = await query(
        'INSERT INTO people (code, full_name, position, phone, email, is_example) VALUES (?, ?, ?, ?, ?, ?)',
        [extra.code ?? null, clean, text(extra.position), text(extra.phone), text(extra.email), extra.isExample ? 1 : 0],
        this.conn,
      );
      this.people.set(key, r.insertId);
      this.createdPeople.add(r.insertId);
      this.report.add('people', 1);
    }
    return this.people.get(key);
  }

  /** id организации по названию (создаёт, если нет). extra: { code, isExample } */
  async orgId(name, extra = {}) {
    const clean = Dictionaries.clean(name);
    if (!clean) return null;
    const key = clean.toLowerCase();
    if (!this.orgs.has(key)) {
      const r = await query(
        'INSERT INTO organizations (code, name, is_example) VALUES (?, ?, ?)',
        [extra.code ?? null, clean, extra.isExample ? 1 : 0],
        this.conn,
      );
      this.orgs.set(key, r.insertId);
      this.createdOrgs.add(r.insertId);
      this.report.add('organizations', 1);
    }
    return this.orgs.get(key);
  }
}

// ---------------------------------------------------------------------
// Отчёт о переносе: сколько строк записано, что ожидалось, предупреждения
// ---------------------------------------------------------------------

export class ImportReport {
  constructor(direction) {
    this.direction = direction;
    this.written = {};   // таблица → сколько строк записали
    this.expected = {};  // таблица → сколько записей в источнике
    this.sums = [];      // контрольные суммы: { label, source, db }
    this.warnings = [];
  }

  add(table, n) { this.written[table] = (this.written[table] ?? 0) + n; }
  expect(table, n) { this.expected[table] = n; }
  warn(message) { this.warnings.push(message); }
  sum(label, source, db) { this.sums.push({ label, source, db }); }

  get total() { return Object.values(this.written).reduce((a, b) => a + b, 0); }
}

/** Строки, которые сейчас лежат в таблицах (для сверки после записи). */
export async function countRows(conn, tables, where = {}) {
  const result = {};
  for (const t of tables) {
    const cond = where[t];
    const [row] = await query(`SELECT COUNT(*) AS n FROM ${t}${cond ? ` WHERE ${cond.sql}` : ''}`, cond?.params ?? [], conn);
    result[t] = row.n;
  }
  return result;
}
