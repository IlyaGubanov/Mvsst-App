// =====================================================================
//  errorHandler.js — превращает любую ошибку в аккуратный JSON-ответ.
//  Формат ответа с ошибкой всегда одинаковый, интерфейс показывает поле error:
//      { "error": "Текст для пользователя", "details": { … } }
// =====================================================================

import { HttpError } from '../errors.js';

/** Неизвестный адрес под /api — отвечаем 404 в JSON (а не HTML-страницей). */
export function apiNotFound(req, res) {
  res.status(404).json({ error: `Адрес API не найден: ${req.method} ${req.originalUrl}` });
}

// У обработчика ошибок в Express ровно 4 параметра — по этому Express его и узнаёт.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Наши «ожидаемые» ошибки: нет прав, неверные данные и т.п.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Ошибки разбора запроса, которые выдаёт сам Express
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Запрос содержит некорректный JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }

  // Повтор уникального значения в базе (например, логин уже занят) — если маршрут сам не обработал
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Такая запись уже существует' });
  }

  // Всё остальное — непредвиденная ошибка. Пользователю — общий текст (подробности ошибки могут
  // раскрыть устройство системы), а полный текст — в журнал сервера (pm2 logs).
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\n`, err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера. Подробности — в журнале сервера.' });
}
