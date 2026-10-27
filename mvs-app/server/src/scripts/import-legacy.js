// =====================================================================
//  npm run import-legacy -- --dir "<папка>" [--only mkd,networks] [--replace]
//
//  Переносит данные из старых HTML-дашбордов в MySQL.
//    --dir      папка с файлами schools.html, mkd.html, networks.html, streets.html
//               (или корень распакованного архива — тогда ищет в src/originals/ и modules/)
//    --only     перенести только перечисленные направления
//    --replace  если в направлении уже есть данные — УДАЛИТЬ их и перенести заново.
//               Удаляются и назначения ответственных по этому направлению (id объектов поменяются).
//               Пользователи, сотрудники и организации НЕ удаляются.
//
//  Каждое направление переносится в своей транзакции: при ошибке база остаётся как была.
//  После переноса число строк и контрольные суммы сверяются с исходником.
//  Пример (PowerShell, из папки server):
//    npm run import-legacy -- --dir "C:\Users\Я\Downloads\МВС_СТ_дашборд"
// =====================================================================

import path from 'node:path';
import { pool, query, queryOne, withTransaction, explainDbError } from '../db.js';
import { getDirectionByCode } from '../services/access.js';
import { audit } from '../services/audit.js';
import { findModuleFile, readJsonBlock, Dictionaries, ImportReport, countRows } from '../importers/legacy/common.js';
import * as schools from '../importers/legacy/schools.js';
import * as mkd from '../importers/legacy/mkd.js';
import * as networks from '../importers/legacy/networks.js';
import * as streets from '../importers/legacy/streets.js';

const IMPORTERS = [schools, mkd, networks, streets];

// ---------- разбор параметров командной строки ----------
function parseArgs(argv) {
  const args = { dir: null, only: null, replace: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--only') args.only = argv[++i]?.split(',').map((s) => s.trim());
    else if (argv[i] === '--replace') args.replace = true;
    else throw new Error(`Непонятный параметр: ${argv[i]}`);
  }
  if (!args.dir) throw new Error('Укажите папку с HTML-файлами: npm run import-legacy -- --dir "C:\\путь\\к\\папке"');
  const known = IMPORTERS.map((m) => m.meta.code);
  const bad = (args.only ?? []).filter((c) => !known.includes(c));
  if (bad.length) throw new Error(`Неизвестные направления: ${bad.join(', ')}. Доступны: ${known.join(', ')}`);
  return args;
}

/** Удалить данные направления перед повторным переносом. */
async function clearDirection(conn, importer, direction) {
  for (const table of importer.meta.tables) await query(`DELETE FROM ${table}`, [], conn);
  await query('DELETE FROM user_objects WHERE direction_id = ?', [direction.id], conn);
  await query('DELETE FROM reporting_periods WHERE direction_id = ?', [direction.id], conn);
  await query('DELETE FROM kpi_snapshots WHERE direction_id = ?', [direction.id], conn);
}

/** Перенос одного направления. Возвращает отчёт. */
async function importDirection(importer, args) {
  const { code, file, block } = importer.meta;
  const direction = await getDirectionByCode(code);
  const report = new ImportReport(direction);

  const sourceFile = findModuleFile(args.dir, file);
  const data = readJsonBlock(sourceFile, block);
  const extra = importer.readExtra ? importer.readExtra(sourceFile) : null;

  // Запись о загрузке создаём ДО транзакции: если перенос упадёт, в истории останется «error»
  const started = await query(
    "INSERT INTO imports (direction_id, file_name, file_kind, status) VALUES (?, ?, 'html', 'running')",
    [direction.id, path.basename(sourceFile)],
  );
  const importId = started.insertId;

  try {
    await withTransaction(async (conn) => {
      // Есть ли хоть что-то в ЛЮБОЙ таблице направления (а не только в таблице объектов):
      // иначе остатки прошлого переноса (разделы, справочники) вызовут ошибку дублей
      const existing = await countRows(conn, importer.meta.tables);
      const nonEmpty = Object.entries(existing).filter(([, n]) => n > 0);
      if (nonEmpty.length) {
        if (!args.replace) {
          const objects = existing[importer.meta.mainTable];
          throw new Error(`В направлении «${direction.name}» уже есть данные (объектов: ${objects}; непустых таблиц: ${nonEmpty.length}). `
            + 'Чтобы перенести заново, добавьте --replace (текущие данные направления будут удалены).');
        }
        await clearDirection(conn, importer, direction);
        report.warn(`Прежние данные направления удалены (--replace), назначения ответственных сброшены`);
      }

      const dict = await new Dictionaries(conn, report).load();
      await importer.run(conn, data, { dict, report, direction, importId, extra });

      // Сверка: сколько строк реально оказалось в таблицах
      const actual = await countRows(conn, Object.keys(report.expected));
      report.checks = Object.entries(report.expected).map(([table, expected]) => ({ table, expected, actual: actual[table] }));
      const failed = report.checks.filter((c) => c.expected !== c.actual);
      const badSums = report.sums.filter((s) => Math.abs((s.source ?? 0) - (s.db ?? 0)) > 0.01);
      if (failed.length || badSums.length) {
        // Расхождение — ошибка: откатываем всё, чтобы в базе не осталось неполных данных
        throw new Error('Сверка не сошлась: ' + [
          ...failed.map((c) => `${c.table}: в источнике ${c.expected}, в базе ${c.actual}`),
          ...badSums.map((s) => `${s.label}: в источнике ${s.source}, в базе ${s.db}`),
        ].join('; '));
      }

      await audit(conn, {
        directionId: direction.id, entity: 'import', entityId: importId, entityName: path.basename(sourceFile),
        action: 'import', summary: `Перенос из старого дашборда: ${report.total} строк`,
        changes: { written: report.written },
      });
    });

    await query(
      'UPDATE imports SET status = ?, rows_total = ?, rows_ok = ?, message = ?, finished_at = NOW() WHERE id = ?',
      [report.warnings.length ? 'partial' : 'ok', report.total, report.total, report.warnings.join('\n') || null, importId],
    );
    report.ok = true;
  } catch (err) {
    await query("UPDATE imports SET status = 'error', message = ?, finished_at = NOW() WHERE id = ?",
      [String(err.message).slice(0, 60000), importId]);
    report.ok = false;
    report.error = err;
  }
  return report;
}

// ---------- печать отчёта ----------
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));

function printReport(report) {
  const { direction } = report;
  console.log(`\n━━━ ${direction.name} ━━━`);
  if (!report.ok) {
    console.log(`✖ НЕ перенесено: ${explainDbError(report.error)}`);
    console.log('  База не изменилась (транзакция отменена).');
    return;
  }
  console.log('  Таблица                     в источнике    в базе');
  for (const c of report.checks) {
    console.log(`  ${c.expected === c.actual ? '✔' : '✖'} ${c.table.padEnd(26)} ${fmt(c.expected).padStart(10)} ${fmt(c.actual).padStart(9)}`);
  }
  const shared = ['people', 'organizations', 'reporting_periods'].filter((t) => report.written[t]);
  if (shared.length) console.log('  + ' + shared.map((t) => `${t}: ${report.written[t]}`).join(', '));
  if (report.sums.length) {
    console.log('  Контрольные суммы:');
    for (const s of report.sums) console.log(`  ✔ ${s.label}: ${fmt(s.db)}`);
  }
  if (report.warnings.length) {
    console.log(`  Предупреждения (${report.warnings.length}):`);
    report.warnings.slice(0, 15).forEach((w) => console.log('  ⚠ ' + w));
    if (report.warnings.length > 15) console.log(`  … и ещё ${report.warnings.length - 15} (полный список — в таблице imports)`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\nПеренос данных из: ${args.dir}${args.replace ? '  (режим --replace)' : ''}`);
  const importers = IMPORTERS.filter((m) => !args.only || args.only.includes(m.meta.code));

  const reports = [];
  for (const importer of importers) {
    process.stdout.write(`→ ${importer.meta.code} … `);
    const t0 = Date.now();
    const report = await importDirection(importer, args);
    console.log(report.ok ? `готово за ${((Date.now() - t0) / 1000).toFixed(1)} с` : 'ошибка');
    reports.push(report);
  }
  reports.forEach(printReport);

  const failed = reports.filter((r) => !r.ok);
  console.log(failed.length
    ? `\n✖ Не перенесены: ${failed.map((r) => r.direction.name).join(', ')}`
    : '\n✔ Все выбранные направления перенесены и сверены с исходником.');
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
