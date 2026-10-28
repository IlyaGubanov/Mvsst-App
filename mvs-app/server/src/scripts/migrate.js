// =====================================================================
//  npm run migrate            — применить к базе новые файлы из database/migrations/
//  npm run migrate -- --status — только показать, какие миграции применены, а какие нет
//
//  КАК УСТРОЕНЫ МИГРАЦИИ
//  • database/schema.sql — полная структура для НОВОЙ установки (в ней уже учтены все миграции).
//  • database/migrations/NNN_описание.sql — изменения для УЖЕ РАБОТАЮЩЕЙ базы, по порядку номеров.
//  • Таблица schema_migrations помнит, какие файлы уже применены, поэтому повторный запуск безопасен.
//
//  ⚠ Перед migrate на рабочем сервере сделайте резервную копию базы (docs/03-deployment.md, пункт 2.12; на сервере это делает deploy/update.sh):
//    изменения структуры (ALTER TABLE) в MySQL нельзя откатить транзакцией.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { pool, explainDbError } from '../db.js';

const MIGRATIONS_DIR = path.resolve(config.serverRoot, '..', 'database', 'migrations');
const statusOnly = process.argv.includes('--status');

async function main() {
  // Отдельное подключение, которому разрешено выполнять несколько команд за раз (весь файл миграции)
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    charset: 'UTF8MB4_UNICODE_CI',
    multipleStatements: true,
  });

  try {
    // В базах, созданных до появления миграций, этой таблицы ещё нет
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
      : [];
    const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')));

    console.log(`\nМиграций в папке: ${files.length}, применено: ${files.length - pending.length}, новых: ${pending.length}`);
    files.forEach((f) => console.log(`  ${pending.includes(f) ? '○ новая     ' : '✔ применена '} ${f}`));
    if (statusOnly || !pending.length) {
      if (!pending.length) console.log('База в актуальном состоянии.');
      return;
    }

    for (const file of pending) {
      const version = file.replace(/\.sql$/, '');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/^﻿/, '');
      console.log(`\n→ Применяю ${file} …`);
      try {
        await conn.query(sql);
      } catch (err) {
        console.error(`✖ Ошибка в ${file}: ${err.message}`);
        console.error('  Часть изменений могла примениться. Исправьте файл или базу и запустите migrate снова');
        console.error('  (или восстановите резервную копию, сделанную перед обновлением).');
        process.exitCode = 1;
        return;
      }
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      console.log(`✔ ${file} применена`);
    }
    console.log('\nГотово. Проверьте: npm run check-db');
  } finally {
    await conn.end();
  }
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
