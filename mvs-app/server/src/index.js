// =====================================================================
//  index.js — точка запуска сервера.  Команды: npm run dev (разработка) / npm start (рабочий режим)
//  Порядок: проверить базу → собрать приложение → начать принимать запросы.
// =====================================================================

import { config } from './config.js';
import { pool, checkConnection, explainDbError } from './db.js';
import { createApp } from './app.js';

async function main() {
  // 1. Сразу проверяем базу: лучше упасть при запуске с понятной подсказкой,
  //    чем на первом запросе пользователя.
  const info = await checkConnection();
  console.log(`✔ MySQL ${info.version}, база «${info.db}»`);

  // 2. Собираем Express-приложение (все маршруты и защита — в app.js)
  const { app, sessionStore } = createApp();

  // 3. Начинаем слушать порт
  const server = app.listen(config.port, () => {
    console.log(`✔ Сервер запущен: http://localhost:${config.port}  (режим: ${config.env}, часовой пояс: ${config.tz})`);
    console.log(`  Проверка: http://localhost:${config.port}/api/health`);
  });

  // 4. Аккуратная остановка (Ctrl+C или команда PM2): дождаться текущих запросов и закрыть подключения
  const shutdown = (signal) => {
    console.log(`\nПолучен сигнал ${signal}, останавливаемся…`);
    server.close(async () => {
      try { await sessionStore.close(); } catch { /* уже закрыт — не важно */ }
      try { await pool.end(); } catch { /* уже закрыт — не важно */ }
      console.log('Сервер остановлен.');
      process.exit(0);
    });
    // Если что-то зависло — принудительно через 10 секунд
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('\n✖ Не удалось запустить сервер:\n' + explainDbError(err) + '\n');
  process.exit(1);
});
