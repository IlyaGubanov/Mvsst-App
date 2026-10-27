// =====================================================================
//  netForm.js — правила формы ввода объекта «Сетей» (без разметки).
//  Форма — текст полей: { ks, workers, machines, lines: { [lineId]: '42,5' } }.
//  Ошибки повторяют проверки сервера; предупреждения — только подсказки.
// =====================================================================

import { numberToInput, parseNumber, rub } from '../../utils/format.js';

export function toForm(object, lines) {
  return {
    ks: numberToInput(object.ks),
    workers: String(object.workers ?? 0),
    machines: String(object.machines ?? 0),
    lines: Object.fromEntries(lines.map((l) => [l.id, numberToInput(l.fact)])),
  };
}

/** Текст → числа для сервера. */
export function fromForm(form, lines) {
  return {
    ks: parseNumber(form.ks),
    workers: parseNumber(form.workers),
    machines: parseNumber(form.machines),
    lines: lines.map((l) => ({ lineId: l.id, fact: parseNumber(form.lines[l.id]) })),
  };
}

export function isChanged(form, original, lines) {
  const a = fromForm(form, lines);
  const b = fromForm(original, lines);
  return a.ks !== b.ks || a.workers !== b.workers || a.machines !== b.machines
    || a.lines.some((l, i) => l.fact !== b.lines[i].fact);
}

const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;

/** Ошибки: { ks, workers, machines, lines: { [lineId]: текст } }. */
export function validate(form, lines) {
  const v = fromForm(form, lines);
  const e = { lines: {} };
  if (Number.isNaN(v.ks)) e.ks = 'Введите сумму';
  else if (v.ks < 0) e.ks = 'Не может быть отрицательной';
  if (!isCount(v.workers)) e.workers = 'Целое число от 0';
  if (!isCount(v.machines)) e.machines = 'Целое число от 0';
  v.lines.forEach((l) => {
    if (Number.isNaN(l.fact)) e.lines[l.lineId] = 'Введите число';
    else if (l.fact < 0) e.lines[l.lineId] = 'Не может быть отрицательным';
  });
  return e;
}
export const hasErrors = (e) => Boolean(e.ks || e.workers || e.machines || Object.keys(e.lines).length);

/** Предупреждения: уменьшение факта или КС, факт больше проекта, КС больше договоров. */
export function warnings(form, original, lines, object) {
  const v = fromForm(form, lines);
  const o = fromForm(original, lines);
  const w = [];
  v.lines.forEach((l, i) => {
    const line = lines[i];
    if (l.fact < o.lines[i].fact) w.push(`«${line.label}»: факт уменьшился (было ${numberToInput(o.lines[i].fact)} ${line.unit}). Факт вносится накопительно — с начала работ.`);
    if (line.plan && l.fact > line.plan) w.push(`«${line.label}»: факт больше проекта (${numberToInput(line.plan)} ${line.unit}) — в выполнении учитывается не больше проекта.`);
  });
  if (!Number.isNaN(v.ks) && v.ks < o.ks) w.push(`Закрыто КС уменьшилось: было ${rub(o.ks)}.`);
  if (!Number.isNaN(v.ks) && object.cost && v.ks > object.cost) w.push(`Закрыто КС больше стоимости договоров (${rub(object.cost)}) — проверьте сумму.`);
  return w;
}

/**
 * Выполнение объекта по введённым значениям (та же формула, что на сервере):
 * одни единицы у всех линий → Σ min(факт, проект) / Σ проект; иначе — среднее долей по линиям.
 */
export function previewFact(form, lines) {
  if (!lines.length) return 0;
  const fact = (l) => Math.max(0, parseNumber(form.lines[l.id]) || 0);
  if (lines.every((l) => l.unit === lines[0].unit)) {
    const plan = lines.reduce((a, l) => a + (Number(l.plan) || 0), 0);
    return plan ? lines.reduce((a, l) => a + Math.min(fact(l), Number(l.plan) || 0), 0) / plan : 0;
  }
  return lines.reduce((a, l) => a + (l.plan ? Math.min(1, fact(l) / l.plan) : 0), 0) / lines.length;
}
