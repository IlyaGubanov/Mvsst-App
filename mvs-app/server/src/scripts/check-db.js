// =====================================================================
//  npm run check-db — проверить подключение к MySQL и что все таблицы на месте.
//  Запускайте после установки базы и при любых проблемах с подключением.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pool, query, checkConnection, explainDbError } from '../db.js';
import { config } from '../config.js';

// Что должно быть после database/schema.sql
const EXPECTED_TABLES = [
  'schema_migrations', 'directions', 'users', 'user_directions', 'user_objects', 'sessions', 'people', 'organizations',
  'reporting_periods', 'audit_log', 'imports', 'kpi_snapshots', 'app_settings',
  'sch_objects', 'sch_expertise', 'sch_work_types', 'sch_object_works', 'sch_work_progress',
  'sch_materials', 'sch_object_materials', 'sch_systems', 'sch_object_systems', 'sch_daily_resources',
  'mkd_sections', 'mkd_work_types', 'mkd_objects', 'mkd_items', 'mkd_item_status',
  'net_sections', 'net_work_kinds', 'net_objects', 'net_contracts', 'net_lines', 'net_line_fact', 'net_object_period',
  'st_work_types', 'st_objects', 'st_reports', 'st_report_objects', 'st_report_values',
];
const EXPECTED_VIEWS = ['v_sch_resources_latest', 'v_net_object_money', 'v_mkd_item_period'];

async function main() {
  console.log(`\nПодключение к ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.name} …`);
  const info = await checkConnection();
  console.log(`✔ MySQL ${info.version}`);

  const rows = await query('SHOW FULL TABLES');
  // Первая колонка называется «Tables_in_<имя базы>», вторая — Table_type
  const nameKey = Object.keys(rows[0] ?? {})[0];
  const tables = new Set(rows.filter((r) => r.Table_type === 'BASE TABLE').map((r) => r[nameKey]));
  const views = new Set(rows.filter((r) => r.Table_type === 'VIEW').map((r) => r[nameKey]));

  const missingTables = EXPECTED_TABLES.filter((t) => !tables.has(t));
  const missingViews = EXPECTED_VIEWS.filter((v) => !views.has(v));
  console.log(`  таблиц: ${tables.size} (ожидается ${EXPECTED_TABLES.length}), представлений: ${views.size} (ожидается ${EXPECTED_VIEWS.length})`);

  if (missingTables.length || missingViews.length) {
    console.log('✖ Не хватает: ' + [...missingTables, ...missingViews].join(', '));
    if (missingTables.length === 1 && missingTables[0] === 'schema_migrations') {
      console.log('  База создана до появления миграций — выполните: npm run migrate');
    } else {
      console.log('  Выполните database/schema.sql (docs/03-deployment.md, пункт 1.4 или 2.4).');
    }
    process.exitCode = 1;
    return;
  }

  // Есть ли неприменённые миграции
  const migrationsDir = path.resolve(config.serverRoot, '..', 'database', 'migrations');
  const files = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter((f) => /^\d+_.+\.sql$/.test(f)) : [];
  const applied = new Set((await query('SELECT version FROM schema_migrations')).map((r) => r.version));
  const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')));
  if (pending.length) {
    console.log(`⚠ Не применены миграции: ${pending.join(', ')} — выполните: npm run migrate`);
    process.exitCode = 1;
  }

  const [{ n: directions }] = await query('SELECT COUNT(*) AS n FROM directions');
  const [{ n: admins }] = await query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1");
  console.log(`✔ Структура в порядке. Направлений: ${directions}, активных администраторов: ${admins}`);
  if (!admins) console.log('  Следующий шаг: npm run create-admin');

  // Кодировка базы: должна быть utf8mb4, иначе кириллица превратится в «????»
  const [{ cs }] = await query('SELECT @@character_set_database AS cs');
  if (cs !== 'utf8mb4') console.log(`⚠ Кодировка базы ${cs}, нужна utf8mb4 (см. docs/03-deployment.md, пункт 1.4)`);
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
