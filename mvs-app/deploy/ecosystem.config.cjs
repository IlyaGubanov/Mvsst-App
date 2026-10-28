// =====================================================================
//  PM2 — «сторож» сервера Node.js на Linux: запускает его в фоне, перезапускает при сбое
//  и после перезагрузки сервера. Настройки приложения (пароли, порт) — в server/.env.
//
//  Запуск (из папки mvs-app):   pm2 start deploy/ecosystem.config.cjs
//  Полезное:  pm2 status · pm2 logs mvs-api · pm2 reload mvs-api · pm2 stop mvs-api
// =====================================================================

const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'mvs-api',
      cwd: path.join(__dirname, '..', 'server'),   // папка server/ — там лежит .env
      script: 'src/index.js',
      instances: 1,                 // один процесс: для организации этого с запасом
      autorestart: true,            // упал — поднять снова
      max_memory_restart: '400M',   // «распух» по памяти — перезапустить
      env: {
        NODE_ENV: 'production',
      },
      time: true,                   // время в каждой строке журнала pm2 logs
    },
  ],
};
