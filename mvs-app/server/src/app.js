// =====================================================================
//  app.js — сборка Express-приложения.
//
//  Express обрабатывает запрос как конвейер: запрос проходит через «прослойки» (middleware)
//  сверху вниз, пока какая-нибудь не отправит ответ. Поэтому ПОРЯДОК строк здесь важен:
//    защита заголовков → разбор JSON → сеанс → проверка JSON → маршруты API → интерфейс → ошибки.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';

import { config } from './config.js';
import { requireJson } from './middleware/requireJson.js';
import { errorHandler, apiNotFound } from './middleware/errorHandler.js';
import { requireLogin, requireRole } from './middleware/auth.js';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import directionsRouter from './routes/directions.js';
import overviewRouter from './routes/overview.js';
import mkdRouter from './routes/mkd.js';
import networksRouter from './routes/networks.js';
import schoolsRouter from './routes/schools.js';
import streetsRouter from './routes/streets.js';
import { useDirection } from './middleware/access.js';
import usersRouter from './routes/users.js';
import assignmentsRouter from './routes/assignments.js';

export function createApp() {
  const app = express();

  // За Nginx: доверяем его заголовку X-Forwarded-For, чтобы видеть настоящий IP пользователя
  // (нужно для журнала и ограничения попыток входа) и понимать, что соединение — HTTPS.
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by'); // не сообщаем всем, что у нас Express

  // ---------- 1. Защитные заголовки (helmet) ----------
  // Content-Security-Policy говорит браузеру, откуда можно грузить скрипты, картинки и т.д.
  // Картинки подложки карты благоустройства (вкладка «Карта») берутся с tile.openstreetmap.org —
  // разрешаем этот адрес и только для картинок (img-src); скрипты и запросы к нему запрещены.
  // Если подложку нужно отключить или заменить своим сервером — поменяйте адрес здесь и
  // TILES в client/src/pages/streets/StreetsMap.jsx.
  //
  // «Только HTTPS» (заголовок HSTS и правило upgrade-insecure-requests) включаем, только если сайт
  // работает по HTTPS (COOKIE_SECURE=true, по умолчанию в production). Иначе — например, сервер во
  // внутренней сети без сертификата — браузер стал бы запрашивать https:// и интерфейс не загрузился бы.
  const httpsOnly = config.session.secureCookie;
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
        'upgrade-insecure-requests': httpsOnly ? [] : null, // null — правило не отправляется
      },
    },
    strictTransportSecurity: httpsOnly,
  }));

  // ---------- 2. Разбор тела запроса в формате JSON (не больше 2 МБ) ----------
  app.use(express.json({ limit: '2mb' }));

  // ---------- 3. Сеансы входа ----------
  // Браузер получает cookie «mvs.sid» со случайным номером сеанса; сами данные сеанса
  // (кто вошёл) хранятся на сервере в таблице sessions. Подделать вход, изменив cookie, нельзя.
  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    createDatabaseTable: false,            // таблица уже создана в schema.sql
    clearExpired: true,                    // сам удаляет просроченные сеансы
    checkExpirationInterval: 15 * 60 * 1000,
    schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  });

  app.use(session({
    name: config.session.cookieName,
    secret: config.session.secret,
    store: sessionStore,
    resave: false,                 // не перезаписывать сеанс, если он не менялся
    saveUninitialized: false,      // не создавать сеанс, пока человек не вошёл
    rolling: true,                 // каждый запрос продлевает срок — выкидывает только после бездействия
    cookie: {
      httpOnly: true,              // cookie недоступна JavaScript-коду страницы (защита от кражи)
      sameSite: 'lax',             // не отправляется с запросами с чужих сайтов (защита от CSRF)
      secure: config.session.secureCookie, // только по HTTPS (в production)
      maxAge: config.session.maxAgeMs,
    },
  }));

  // ---------- 4. Изменяющие запросы принимаем только в JSON (дополнительная защита от CSRF) ----------
  app.use('/api', requireJson);

  // ---------- 5. Маршруты API ----------
  app.use('/api/health', healthRouter);                                   // проверка «жив ли сервер»
  app.use('/api/auth', authRouter);                                       // вход, выход, «кто я», смена пароля
  app.use('/api/overview', requireLogin, overviewRouter);                 // «Сводка» по направлениям
  app.use('/api/directions', requireLogin, directionsRouter);             // направления: KPI, история, «мои объекты»
  app.use('/api/mkd', requireLogin, useDirection('mkd'), mkdRouter);      // «Капремонт МКД»
  app.use('/api/networks', requireLogin, useDirection('networks'), networksRouter); // «Сети, коллекторы, водные объекты»
  app.use('/api/schools', requireLogin, useDirection('schools'), schoolsRouter);    // «Капремонт школ»
  app.use('/api/streets', requireLogin, useDirection('streets'), streetsRouter);    // «Благоустройство улиц»
  app.use('/api/users', requireLogin, requireRole('admin'), usersRouter); // пользователи — только администратор
  app.use('/api/assignments', requireLogin, requireRole('admin'), assignmentsRouter); // ответственные за объекты
  app.use('/api', apiNotFound);                                           // неизвестный адрес API → 404 в JSON

  // ---------- 6. Собранный интерфейс React (только если SERVE_CLIENT=true, вариант без Nginx) ----------
  if (config.serveClient) {
    const indexHtml = path.join(config.clientDist, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      console.warn(`⚠ SERVE_CLIENT=true, но нет ${indexHtml}. Соберите интерфейс: cd client && npm run build`);
    }
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    // Любой другой адрес (/mkd, /networks/rec7) — отдаём index.html, маршрут разберёт React
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(indexHtml);
    });
  }

  // ---------- 7. Обработчик ошибок — всегда последним ----------
  app.use(errorHandler);

  return { app, sessionStore };
}
