// =====================================================================
//  npm run verify-kpi -- --file "<путь к kpi_defaults.json>" [--date ГГГГ-ММ-ДД]
//
//  Сверка: показатели, которые считает сервер, сравниваются поле за полем с показателями,
//  которые считали прежние HTML-модули (src/kpi_defaults.json из архива дашборда).
//  --date — «сегодня» для расчёта (план школ зависит от даты); по умолчанию — сегодня.
//
//  Допуски: доли (факт, план, отклонение) — 0,0001; деньги — 0,05 ₽ (база хранит копейки,
//  а в исходном Excel встречались доли копейки). Поля local и readonly не сравниваются:
//  в новом приложении нет «правок в браузере», а благоустройство теперь можно вводить вручную.
// =====================================================================

import fs from 'node:fs';
import { pool, explainDbError } from '../db.js';
import { computeKpi } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';

const SKIP = new Set(['local', 'readonly']);
const MONEY_KEYS = new Set(['portfolio', 'closed', 'paid']);

function parseArgs(argv) {
  const args = { file: null, date: todayIso() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--date') args.date = argv[++i];
  }
  if (!args.file) throw new Error('Укажите файл: npm run verify-kpi -- --file "C:\\путь\\kpi_defaults.json"');
  return args;
}

/** Сравнить два значения; вернуть список расхождений вида { path, expected, actual }. */
function compare(expected, actual, path, out) {
  const key = path.split('.').at(-1);
  if (SKIP.has(key)) return out;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = MONEY_KEYS.has(key) ? 0.05 : 1e-4;
    if (Math.abs(expected - actual) > tol) out.push({ path, expected, actual });
    return out;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push({ path: `${path}.length`, expected: expected.length, actual: Array.isArray(actual) ? actual.length : actual });
      return out;
    }
    expected.forEach((e, i) => compare(e, actual[i], `${path}[${i}]`, out));
    return out;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') { out.push({ path, expected, actual }); return out; }
    for (const k of Object.keys(expected)) {
      // В прежних модулях id объекта — его старый код ('o40', 'kol182'); у нас старый код — в поле code
      if (k === 'id' && 'code' in actual) compare(expected.id, actual.code, `${path}.id→code`, out);
      else compare(expected[k], actual[k], `${path}.${k}`, out);
    }
    return out;
  }
  if (expected !== actual) out.push({ path, expected, actual });
  return out;
}

const show = (v) => (typeof v === 'string' ? `«${v}»` : JSON.stringify(v));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reference = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  console.log(`\nСверка показателей с ${args.file}\nДата расчёта: ${args.date}\n`);

  let failedDirections = 0;
  for (const code of ['schools', 'mkd', 'networks', 'streets']) {
    if (!reference[code]) continue;
    const actual = await computeKpi(code, args.date);
    if (!actual) {
      console.log(`✖ ${code}: нет данных для расчёта`);
      failedDirections++;
      continue;
    }
    const diffs = compare(reference[code], actual, code, []);
    const ref = reference[code];
    const fmt = (x) => (x == null ? '—' : (x * 100).toFixed(2) + ' %');
    console.log(`${diffs.length ? '✖' : '✔'} ${code.padEnd(9)} факт ${fmt(actual.fact)} (было ${fmt(ref.fact)}), план ${fmt(actual.plan)} (было ${fmt(ref.plan)}), `
      + `отстают ${actual.lagging ?? '—'}, критично ${actual.critical ?? '—'}`);
    diffs.slice(0, 20).forEach((d) => console.log(`    ${d.path}: ожидалось ${show(d.expected)}, получено ${show(d.actual)}`));
    if (diffs.length > 20) console.log(`    … и ещё ${diffs.length - 20}`);
    if (diffs.length) failedDirections++;
  }

  console.log(failedDirections
    ? `\n✖ Расхождения в ${failedDirections} направлениях (см. выше).`
    : '\n✔ Все показатели совпадают с прежними модулями.');
  if (failedDirections) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
