// =====================================================================
//  streetForm.js — правила формы ввода по объекту благоустройства (без разметки).
//
//  Форма — текст полей: { status, people, tech, remarks, facts: { [workId]: '3 439' } }.
//  Пустое поле людей / техники / замечаний / факта — «не указано» (null), это не ноль.
//  Ошибки повторяют проверки сервера; предупреждения — только подсказки.
// =====================================================================

import { numberToInput, parseNumber } from '../../utils/format.js';

const COUNTS = ['people', 'tech', 'remarks'];
const isEmpty = (s) => String(s ?? '').trim() === '';
const toNum = (s) => (isEmpty(s) ? null : parseNumber(s));
const round3 = (v) => (v == null || Number.isNaN(v) ? v : Math.round(v * 1000) / 1000);

/** Какие виды работ показывать в форме: предусмотренные проектом или уже с фактом. */
export const formWorks = (works, object) => works.filter((w) => {
  const v = object.values[w.id];
  return v && (v.state !== 'na' || v.f != null);
});

export function toForm(object, works) {
  return {
    status: object.status ?? '',
    people: object.people == null ? '' : String(object.people),
    tech: object.tech == null ? '' : String(object.tech),
    remarks: object.remarks == null ? '' : String(object.remarks),
    facts: Object.fromEntries(formWorks(works, object).map((w) => [w.id, numberToInput(object.values[w.id].f)])),
  };
}

/** Тело запроса: все поля строки и только изменённые факты. */
export function fromForm(form, original, works, object) {
  return {
    status: form.status.trim() || null,
    ...Object.fromEntries(COUNTS.map((k) => [k, toNum(form[k])])),
    values: formWorks(works, object)
      .filter((w) => round3(toNum(form.facts[w.id])) !== round3(toNum(original.facts[w.id])))
      .map((w) => ({ workTypeId: w.id, fact: round3(toNum(form.facts[w.id])) })),
  };
}

export function isChanged(form, original, works, object) {
  const a = fromForm(form, original, works, object);
  return a.values.length > 0 || a.status !== (original.status.trim() || null)
    || COUNTS.some((k) => a[k] !== toNum(original[k]));
}

/** Ошибки: { people?, tech?, remarks?, facts: { [workId]: текст } }. */
export function validate(form, works, object) {
  const e = { facts: {} };
  COUNTS.forEach((k) => {
    const v = toNum(form[k]);
    if (v != null && !(Number.isInteger(v) && v >= 0 && v <= 10000)) e[k] = 'Целое число от 0 (или пусто)';
  });
  formWorks(works, object).forEach((w) => {
    const v = toNum(form.facts[w.id]);
    if (Number.isNaN(v)) e.facts[w.id] = 'Введите число';
    else if (v != null && v < 0) e.facts[w.id] = 'Не может быть отрицательным';
  });
  if (form.status.trim().length > 80) e.status = 'Не длиннее 80 знаков';
  return e;
}
export const hasErrors = (e) => Boolean(e.people || e.tech || e.remarks || e.status || Object.keys(e.facts).length);

/** Предупреждения: факт уменьшился, больше проекта; статус «завершены», а объёмы не выполнены. */
export function warnings(form, original, works, object, doneStatuses) {
  const w = [];
  let remaining = 0;
  formWorks(works, object).forEach((work) => {
    const v = toNum(form.facts[work.id]);
    const was = toNum(original.facts[work.id]);
    const p = object.values[work.id].p;
    if (v != null && !Number.isNaN(v)) {
      if (was != null && v < was) w.push(`«${work.name}»: факт уменьшился (было ${numberToInput(was)}). Факт вносится накопительно.`);
      if (p > 0 && v > p) w.push(`«${work.name}»: факт больше проекта (${numberToInput(p)} ${work.unit ?? ''}).`);
    }
    if (p > 0 && (v == null || v < p)) remaining++;
  });
  if (doneStatuses.includes(form.status) && remaining > 0) w.push(`Статус «${form.status}», но по ${remaining} поз. факт меньше проекта — проверьте.`);
  return w;
}

/** Доля выполненных позиций по введённым значениям (как на сервере). */
export function previewRate(form, works, object) {
  const ws = works.filter((w) => object.values[w.id]?.p > 0);
  if (!ws.length) return null;
  const done = ws.filter((w) => {
    const v = toNum(form.facts[w.id]);
    return v != null && !Number.isNaN(v) && v + 1e-7 >= object.values[w.id].p;
  }).length;
  return done / ws.length;
}
