// =====================================================================
//  itemForm.js — правила формы ввода позиции МКД (без разметки — так их проще проверить).
//  Ошибки (блокируют сохранение) повторяют проверки сервера; предупреждения — только подсказки.
// =====================================================================

import { numberToInput, parseNumber, pct100, rub } from '../../utils/format.js';

/** Значения позиции в виде текста для полей ввода. */
export function toForm(item) {
  return {
    status: item.status,
    pct: numberToInput(item.pct),
    ks: numberToInput(item.ks),
    paid: numberToInput(item.paid),
    note: item.statusNote ?? '',
  };
}

/** Статусы, при которых готовность фиксирована: КС-2/оплачено — 100 %, исключено — 0 %. */
export const fixedPct = (status) => (status === 'ks' || status === 'paid' ? 100 : status === 'excl' ? 0 : null);

/** Текст формы → числа для сервера (готовность — 0..100). */
export function fromForm(form) {
  const fixed = fixedPct(form.status);
  return {
    status: form.status,
    pct: fixed ?? parseNumber(form.pct),
    ks: parseNumber(form.ks),
    paid: parseNumber(form.paid),
    note: form.note.trim() || null,
  };
}

/** Изменилась ли позиция по сравнению с исходными значениями. */
export function isChanged(form, original) {
  const a = fromForm(form);
  const b = fromForm(original);
  return a.status !== b.status || a.pct !== b.pct || a.ks !== b.ks || a.paid !== b.paid || a.note !== b.note;
}

/** Ошибки по полям: { pct: 'текст', ks: …, paid: … }. Пустой объект — ошибок нет. */
export function validate(form) {
  const v = fromForm(form);
  const e = {};
  if (Number.isNaN(v.pct)) e.pct = 'Введите число';
  else if (v.pct < 0 || v.pct > 100) e.pct = 'От 0 до 100';
  if (Number.isNaN(v.ks)) e.ks = 'Введите сумму';
  else if (v.ks < 0) e.ks = 'Не может быть отрицательной';
  if (Number.isNaN(v.paid)) e.paid = 'Введите сумму';
  else if (v.paid < 0) e.paid = 'Не может быть отрицательной';
  if (!e.ks && !e.paid && Math.round(v.paid * 100) > Math.round(v.ks * 100)) e.paid = 'Больше, чем закрыто КС-2';
  if (!e.ks && (v.status === 'ks' || v.status === 'paid') && !(v.ks > 0)) e.ks = 'Для этого статуса укажите сумму КС-2';
  return e;
}

/** Предупреждения (не мешают сохранению): уменьшение готовности или КС-2, КС-2 больше договора. */
export function warnings(form, original, item) {
  const v = fromForm(form);
  const o = fromForm(original);
  const w = [];
  if (!Number.isNaN(v.pct) && v.pct < o.pct) w.push(`Готовность уменьшилась: было ${pct100(o.pct)}. Если это исправление ошибки — укажите причину в примечании.`);
  if (!Number.isNaN(v.ks) && v.ks < o.ks) w.push(`Сумма КС-2 уменьшилась: было ${rub(o.ks)}.`);
  if (!Number.isNaN(v.ks) && v.ks > item.contract) w.push(`КС-2 больше стоимости договора (${rub(item.contract)}) — проверьте сумму.`);
  return w;
}
