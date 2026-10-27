// =====================================================================
//  client.js — одна функция для всех запросов к серверу.
//
//      const data = await api('/overview?date=2026-10-27');
//      await api('/auth/login', { method: 'POST', body: { login, password } });
//
//  • Ответ сервера (JSON) возвращается как объект.
//  • При ошибке выбрасывается ApiError: в нём код ответа (status) и понятный текст (message).
//  • 401 (сеанс закончился) и 403 «смените временный пароль» сообщаются всему приложению событиями —
//    их ловит AuthContext и отправляет пользователя на нужную страницу.
// =====================================================================

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin', // отправлять cookie сеанса
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет или что сервер запущен.');
  }

  let data = null;
  try { data = await response.json(); } catch { /* пустой ответ */ }

  if (!response.ok) {
    const error = new ApiError(response.status, data?.error || `Ошибка сервера (${response.status})`, data?.details);
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('mvs:unauthorized'));
    }
    if (response.status === 403 && data?.details?.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('mvs:password-change-required'));
    }
    throw error;
  }
  return data;
}
