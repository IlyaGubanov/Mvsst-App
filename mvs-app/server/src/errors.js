// =====================================================================
//  errors.js — «ошибки с кодом ответа».
//  Вместо того чтобы в каждом маршруте писать res.status(403).json(...), мы просто
//      throw forbidden('Недостаточно прав');
//  а общий обработчик (middleware/errorHandler.js) превратит это в ответ браузеру.
//
//  Коды ответа HTTP, которые мы используем:
//    400 — неверные данные в запросе       401 — не выполнен вход
//    403 — нет прав                        404 — не найдено
//    409 — конфликт (например, логин занят) 423 — вход временно заблокирован
// =====================================================================

export class HttpError extends Error {
  /**
   * @param {number} status  — код ответа HTTP
   * @param {string} message — текст для пользователя (на русском)
   * @param {object} [details] — подробности: например, список полей с ошибками
   */
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Войдите в систему') => new HttpError(401, message);
export const forbidden = (message = 'Недостаточно прав', details) => new HttpError(403, message, details);
export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
