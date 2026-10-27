// =====================================================================
//  config.js — все настройки сервера в одном месте.
//  Значения берутся из файла server/.env (образец — server/.env.example).
//  Остальной код НЕ читает process.env напрямую, а импортирует отсюда объект config:
//      import { config } from './config.js';
// =====================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Папка server/ (на уровень выше папки src/, где лежит этот файл)
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Загружаем .env встроенной функцией Node.js (отдельная библиотека dotenv не нужна).
// Если файла нет — не страшно: настройки могут прийти из переменных окружения сервера.
try {
  process.loadEnvFile(path.join(SERVER_ROOT, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err; // ENOENT = «файл не найден» — пропускаем, остальное — ошибка
}

// ---------- маленькие помощники для чтения настроек ----------

/** Обязательная настройка: если её нет — сервер не запустится и скажет, чего не хватает. */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`В файле server/.env не задана настройка ${name} (образец — server/.env.example)`);
  }
  return value;
}

/** Число со значением по умолчанию. */
function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Настройка ${name} должна быть числом, сейчас: "${raw}"`);
  return value;
}

/** Да/нет: true, 1, yes → true; false, 0, no → false. */
function boolean(name, fallback) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'yes', 'да'].includes(raw)) return true;
  if (['false', '0', 'no', 'нет'].includes(raw)) return false;
  throw new Error(`Настройка ${name} должна быть true или false, сейчас: "${raw}"`);
}

// ---------- сами настройки ----------

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// Часовой пояс задаём для всего процесса ДО любых расчётов с датами
process.env.TZ = process.env.TZ || 'Europe/Moscow';

export const config = {
  env,
  isProd,
  port: number('PORT', 3000),
  tz: process.env.TZ,
  serverRoot: SERVER_ROOT,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: number('DB_PORT', 3306),
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    connectionLimit: number('DB_CONNECTION_LIMIT', 10),
  },

  session: {
    secret: required('SESSION_SECRET'),
    cookieName: 'mvs.sid',
    maxAgeMs: number('SESSION_HOURS', 12) * 60 * 60 * 1000,
    // В production cookie передаётся только по HTTPS
    secureCookie: boolean('COOKIE_SECURE', isProd),
  },

  trustProxy: boolean('TRUST_PROXY', false),
  serveClient: boolean('SERVE_CLIENT', false),
  clientDist: path.resolve(SERVER_ROOT, '..', 'client', 'dist'),

  // Правила безопасности входа
  security: {
    maxFailedLogins: 5,      // после стольких неверных паролей подряд…
    lockMinutes: 15,         // …вход блокируется на столько минут
    minPasswordLength: 10,
  },
};

// Защита от забытой настройки: короткий секрет легко подобрать
if (isProd && config.session.secret.length < 32) {
  throw new Error('SESSION_SECRET слишком короткий: для production нужно не меньше 32 символов');
}
