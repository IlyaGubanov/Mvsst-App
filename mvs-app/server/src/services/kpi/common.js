// =====================================================================
//  kpi/common.js — общие кирпичики расчёта показателей.
//
//  ВАЖНО: формулы и форматы перенесены из прежних HTML-модулей один в один,
//  чтобы сводка в новом приложении показывала те же цифры. Проверка —
//  команда npm run verify-kpi (сравнивает с src/kpi_defaults.json из архива).
// =====================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- даты ----------
// Все даты в расчётах — строки 'ГГГГ-ММ-ДД'. Превращаем их в число миллисекунд по UTC,
// чтобы часовой пояс и переход на летнее время не влияли на подсчёт дней.

/** 'ГГГГ-ММ-ДД' → миллисекунды (полночь UTC). Пусто → null. */
export function dayMs(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Миллисекунды → 'ГГГГ-ММ-ДД'. */
export function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Сегодняшняя дата в часовом поясе сервера (TZ из .env, по умолчанию Москва). */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  return isoDay(dayMs(iso) + days * DAY_MS);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY_MS);
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * ПЛАН НА ДАТУ — линейно между началом и окончанием (доля 0..1).
 * До начала — 0, после окончания — 1. Если начало или окончание не заданы — null.
 * Если окончание не позже начала — 1 после окончания, иначе 0.
 */
export function linearPlan(startIso, endIso, atIso) {
  const s = dayMs(startIso);
  const e = dayMs(endIso);
  const t = dayMs(atIso);
  if (s === null || e === null) return null;
  if (e <= s) return t >= e ? 1 : 0;
  return clamp((t - s) / (e - s), 0, 1);
}

// ---------- числа ----------

export const sum = (arr) => arr.reduce((a, x) => a + (Number(x) || 0), 0);

// Форматирование по-русски: пробел-разделитель тысяч, запятая в дробной части
export const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Деньги кратко: «3,5 млрд ₽», «193,5 млн ₽», «12 тыс. ₽». */
export function moneyShort(v) {
  v = v || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return nf1.format(v / 1e9).replace(/,0$/, '') + ' млрд ₽';
  if (a >= 1e6) return nf1.format(v / 1e6) + ' млн ₽';
  if (a >= 1e3) return nf0.format(v / 1e3) + ' тыс. ₽';
  return nf0.format(v) + ' ₽';
}

/** Склонение: 1 объект, 2 объекта, 5 объектов. forms = ['', 'а', 'ов']. */
export function plural(n, [one, few, many]) {
  const n100 = Math.abs(n) % 100;
  const n10 = n100 % 10;
  if (n100 > 10 && n100 < 20) return many;
  if (n10 > 1 && n10 < 5) return few;
  if (n10 === 1) return one;
  return many;
}

// ---------- статусы отставания ----------

/**
 * Статус по отклонению факт − план (доли).
 * thr = { warn, crit } в процентных пунктах из таблицы directions (например 5 и 15).
 */
export function lagStatus(diff, thr) {
  if (diff === null || diff === undefined) return 'na';
  if (diff < -thr.crit / 100) return 'crit';
  if (diff < -thr.warn / 100) return 'warn';
  return 'ok';
}

/** Сортировка «по возрастанию» с сохранением исходного порядка при равенстве (как в браузере). */
export function stableSortBy(arr, key) {
  return arr.map((x, i) => [x, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(([x]) => x);
}
