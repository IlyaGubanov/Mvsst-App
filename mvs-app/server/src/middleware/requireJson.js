// =====================================================================
//  requireJson.js — изменяющие запросы (POST, PUT, PATCH, DELETE) принимаем только
//  с заголовком Content-Type: application/json.
//
//  Зачем: чужой сайт может незаметно отправить из браузера пользователя обычную HTML-форму
//  на наш адрес (атака CSRF). Форма не умеет ставить тип application/json — такой запрос
//  будет отклонён. Это вторая линия защиты после cookie с SameSite=Lax.
//  Наш интерфейс всегда отправляет JSON, поэтому ему это не мешает.
// =====================================================================

const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Адреса, куда будут загружаться файлы (Excel) — у них другой тип, multipart/form-data.
// Пополним список на шаге с загрузкой отчётов.
const UPLOAD_PATHS = [];

export function requireJson(req, res, next) {
  if (!CHANGING_METHODS.has(req.method)) return next();
  // Смотрим сам заголовок, а не req.is(): req.is() возвращает null для запросов без тела
  // (например, POST /logout), и такие запросы ошибочно отклонялись бы.
  const type = (req.get('content-type') || '').toLowerCase();
  if (type.startsWith('application/json')) return next();
  if (UPLOAD_PATHS.some((p) => req.path.startsWith(p)) && type.startsWith('multipart/form-data')) return next();
  res.status(415).json({ error: 'Запрос должен быть в формате JSON (Content-Type: application/json)' });
}
