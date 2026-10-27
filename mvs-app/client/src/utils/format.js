// =====================================================================
//  format.js — числа, деньги, проценты и даты по-русски (как в прежнем дашборде).
// =====================================================================

const NNBSP = ' '; // узкий неразрывный пробел: «35 %», не разрывается при переносе строки

/** Число с разделителями тысяч: 16120 → «16 120». */
export const nf = (x, digits = 0) => Number(x || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Доля → процент: 0.3345 → «33 %». */
export const pct = (x, digits = 0) => (x == null || Number.isNaN(x) ? '—' : nf(x * 100, digits) + NNBSP + '%');

/** Отклонение в процентных пунктах: −0.039 → «−4 п.п.». */
export const pp = (x) => {
  const v = Math.round(x * 100);
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + ' п.п.';
};

/** Деньги крупно: «1,73 млрд ₽», «193 млн ₽». */
export const bn = (v) => (v == null ? '—' : v >= 1e9 ? nf(v / 1e9, v >= 1e10 ? 1 : 2) + ' млрд ₽' : nf(v / 1e6, 0) + ' млн ₽');

/** Миллиарды без подписи: «6,92». */
export const bnShort = (v) => (v == null ? '—' : nf(v / 1e9, v >= 1e10 ? 1 : 2));

/** '2026-10-26' → «26.10.2026». */
export const fdate = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

/** '2026-10-26' → «26.10». */
export const fdm = (s) => {
  if (!s) return '—';
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${d}.${m}`;
};

/** Склонение: plural(5, 'объект', 'объекта', 'объектов') → «объектов». */
export function plural(n, one, few, many) {
  const n100 = Math.abs(n) % 100;
  const n10 = n100 % 10;
  if (n100 > 10 && n100 < 20) return many;
  if (n10 > 1 && n10 < 5) return few;
  if (n10 === 1) return one;
  return many;
}

/** Подпись «на какую дату данные» для карточки направления. */
export function asOfText(kpi) {
  if (!kpi?.asOf) return '';
  switch (kpi.asOfKind) {
    case 'week': return `отчётная неделя ${fdm(kpi.asOf)}`;
    case 'period': return `отчётный период с ${fdm(kpi.asOf)}`;
    case 'report': return `отчёт на ${fdate(kpi.asOf)}`;
    case 'updated': return `обновлено ${fdate(kpi.asOf)}`;
    default: return `данные на ${fdate(kpi.asOf)}`;
  }
}

/** Рубли полностью: 1234567.8 → «1 234 567,80 ₽»; без копеек, если их нет. */
export const rub = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  return n.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + ' ₽';
};

/** Деньги кратко, как в прежнем дашборде «Сетей»: «6,9 млрд ₽», «193,5 млн ₽», «12 тыс. ₽». */
export const moneyShortRu = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return nf((v || 0) / 1e9, 1).replace(/,0$/, '') + ' млрд ₽';
  if (a >= 1e6) return nf((v || 0) / 1e6, 1) + ' млн ₽';
  if (a >= 1e3) return nf((v || 0) / 1e3, 0) + ' тыс. ₽';
  return nf(v || 0, 0) + ' ₽';
};

/** Миллионы рублей: 193537731 → «193,5 млн ₽». */
export const mln = (v) => (v == null ? '—' : nf((v || 0) / 1e6, 1) + ' млн ₽');

/** Проценты, которые уже в шкале 0..100: 54.2 → «54 %». */
export const pct100 = (v, digits = 0) => (v == null || Number.isNaN(v) ? '—' : nf(v, digits) + NNBSP + '%');

/**
 * Число из поля ввода: понимает пробелы-разделители и запятую — «1 234 567,89» → 1234567.89.
 * Пустое поле → 0. Не число → NaN (поле подсветится ошибкой).
 */
export function parseNumber(text) {
  const s = String(text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return 0;
  return /^-?\d*\.?\d+$/.test(s) || /^-?\d+\.$/.test(s) ? Number(s) : NaN;
}

/** Число → текст для поля ввода: 1234567.8 → «1 234 567,8». */
export const numberToInput = (v) => (v == null ? '' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));

/** Период отчёта: { start: '2026-10-26', end: '2026-10-28' } → «26.10–28.10». */
export const periodLabel = (p) => (p ? `${fdm(p.start)}–${fdm(p.end)}` : '—');

/** Сегодня в формате 'ГГГГ-ММ-ДД' (по часам компьютера пользователя). */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
