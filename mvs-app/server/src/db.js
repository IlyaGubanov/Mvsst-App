// =====================================================================
//  db.js — подключение к MySQL и помощники для запросов.
//
//  «Пул» (pool) — это набор заранее открытых подключений к базе. Запрос берёт свободное
//  подключение, выполняется и возвращает его в пул. Так быстрее, чем подключаться каждый раз.
//
//  ГЛАВНОЕ ПРАВИЛО БЕЗОПАСНОСТИ: значения в SQL передаём ТОЛЬКО через знаки «?»:
//      query('SELECT * FROM users WHERE login = ?', [login])        ✅ правильно
//      query(`SELECT * FROM users WHERE login = '${login}'`)          ❌ НИКОГДА (SQL-инъекция)
// =====================================================================

import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,          // если все подключения заняты — подождать, а не падать
  charset: 'UTF8MB4_UNICODE_CI',     // кириллица, ₽, Ø — без «????»
  dateStrings: true,                 // даты приходят строками '2026-10-26' — без сдвигов часовых поясов
  decimalNumbers: true,              // DECIMAL (деньги, проценты) приходят числами, а не строками
  supportBigNumbers: true,
});

/**
 * Выполнить запрос и вернуть строки.
 * @param {string} sql    — текст запроса с «?» вместо значений
 * @param {Array}  params — значения по порядку «?»
 * @param {object} db     — пул (по умолчанию) или подключение внутри транзакции
 * Для SELECT вернёт массив строк, для INSERT/UPDATE — объект с insertId и affectedRows.
 */
export async function query(sql, params = [], db = pool) {
  const [rows] = await db.query(sql, params);
  return rows;
}

/** Выполнить запрос и вернуть первую строку (или null, если строк нет). */
export async function queryOne(sql, params = [], db = pool) {
  const rows = await query(sql, params, db);
  return rows[0] ?? null;
}

/**
 * Транзакция: «всё или ничего».
 * Внутри функции work используйте переданное подключение conn:
 *     await withTransaction(async (conn) => {
 *       await query('UPDATE …', [...], conn);
 *       await query('INSERT INTO audit_log …', [...], conn);
 *     });
 * Если внутри произойдёт ошибка — все изменения отменятся (ROLLBACK).
 */
export async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release(); // вернуть подключение в пул в любом случае
  }
}

/** Проверить, что база доступна. Возвращает версию MySQL и имя базы. */
export async function checkConnection() {
  return queryOne('SELECT VERSION() AS version, DATABASE() AS db');
}

/** Перевести типовую ошибку MySQL в понятную подсказку на русском. */
export function explainDbError(err) {
  const hints = {
    ECONNREFUSED: `MySQL не отвечает на ${config.db.host}:${config.db.port}. Запущен ли сервер MySQL? Верны ли DB_HOST и DB_PORT в .env?`,
    ENOTFOUND: `Адрес ${config.db.host} не найден. Проверьте DB_HOST в .env.`,
    ER_ACCESS_DENIED_ERROR: `MySQL отказал во входе пользователю «${config.db.user}». Проверьте DB_USER и DB_PASSWORD в .env.`,
    ER_BAD_DB_ERROR: `Базы «${config.db.name}» нет. Создайте её (docs/03-deployment.md, пункт 1.4 или 2.3) или исправьте DB_NAME.`,
    ER_NO_SUCH_TABLE: 'Не хватает таблиц. Выполните database/schema.sql (docs/03-deployment.md, пункт 1.4 или 2.4) и запустите npm run check-db.',
  };
  return hints[err?.code] ? `${hints[err.code]}\n(код ошибки: ${err.code})` : err?.message || String(err);
}
