// =====================================================================
//  schoolForm.js — правила формы ежедневного ввода по школе (без разметки).
//
//  Форма — текст полей:
//    { works: { [workId]: { pct: '42,5', fv: '7 175' } },
//      res: { people: '205', tech: '2', peopleLandscape: '0', techLandscape: '0' } }
//  • pct — выполнение в процентах (0..100), как вводит человек;
//  • fv  — факт объёмом. Если у работы есть проектный объём и fv заполнен, процент
//          считается из объёма (fv / проект) — поле процента тогда только показывает результат;
//  • res — ресурсы ЗА ЭТУ ДАТУ. Пустые все четыре поля — ресурсы за день не вносятся.
//  Ошибки повторяют проверки сервера; предупреждения — только подсказки.
// =====================================================================

import { numberToInput, parseNumber, pct as pctText } from '../../utils/format.js';

const RES_KEYS = ['people', 'tech', 'peopleLandscape', 'techLandscape'];
const round4 = (v) => Math.round(v * 10000) / 10000;
const round3 = (v) => Math.round(v * 1000) / 1000;
const hasVolume = (w) => Number(w.planVolume) > 0;

/** Значения формы из карточки школы на дату. Ресурсы — только если вносились именно за эту дату. */
export function toForm(works, resourcesOfDay) {
  return {
    works: Object.fromEntries(works.map((w) => [w.id, {
      pct: numberToInput(round4(w.pct) * 100),
      fv: hasVolume(w) && w.factVolume != null ? numberToInput(w.factVolume) : '',
    }])),
    res: Object.fromEntries(RES_KEYS.map((k) => [k, resourcesOfDay ? String(resourcesOfDay[k] ?? 0) : ''])),
  };
}

/** Ресурсы из записи за другой день — для кнопки «те же, что за …». */
export const resToForm = (r) => Object.fromEntries(RES_KEYS.map((k) => [k, String(r[k] ?? 0)]));

/** Значение работы так, как его сохранит сервер: { pct: доля 0..1, fv: число | null }. */
export function workValue(w, field) {
  const fvText = String(field.fv ?? '').trim();
  if (hasVolume(w) && fvText !== '') {
    const fv = parseNumber(fvText);
    return { pct: Number.isNaN(fv) ? NaN : round4(Math.min(1, Math.max(0, fv) / w.planVolume)), fv: Number.isNaN(fv) ? NaN : round3(fv) };
  }
  const p = parseNumber(field.pct);
  return { pct: Number.isNaN(p) ? NaN : round4(p / 100), fv: null };
}

const resEmpty = (res) => RES_KEYS.every((k) => String(res[k] ?? '').trim() === '');

/** Изменённые работы (только они уходят на сервер). */
export function changedWorks(form, original, works) {
  return works.filter((w) => {
    const a = workValue(w, form.works[w.id]);
    const b = workValue(w, original.works[w.id]);
    return a.pct !== b.pct || a.fv !== b.fv;
  });
}
const resChanged = (form, original) => RES_KEYS.some((k) => String(form.res[k]).trim() !== String(original.res[k]).trim());

export const isChanged = (form, original, works) => changedWorks(form, original, works).length > 0 || resChanged(form, original);

/** Тело запроса для одной школы. */
export function fromForm(form, original, works, objectId) {
  return {
    objectId,
    works: changedWorks(form, original, works).map((w) => {
      const v = workValue(w, form.works[w.id]);
      return { workTypeId: w.id, pct: Math.round(v.pct * 1000000) / 10000, factVolume: v.fv };
    }),
    resources: resChanged(form, original) && !resEmpty(form.res)
      ? Object.fromEntries(RES_KEYS.map((k) => [k, parseNumber(form.res[k])]))
      : null,
  };
}

const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;

/** Ошибки: { works: { [id]: { pct?, fv? } }, res: { [key]: текст } }. */
export function validate(form, works) {
  const e = { works: {}, res: {} };
  works.forEach((w) => {
    const f = form.works[w.id];
    const err = {};
    if (hasVolume(w) && String(f.fv).trim() !== '') {
      const fv = parseNumber(f.fv);
      if (Number.isNaN(fv)) err.fv = 'Введите число';
      else if (fv < 0) err.fv = 'Не может быть отрицательным';
    } else {
      const p = parseNumber(f.pct);
      if (Number.isNaN(p)) err.pct = 'Введите число';
      else if (p < 0 || p > 100) err.pct = 'От 0 до 100';
    }
    if (err.pct || err.fv) e.works[w.id] = err;
  });
  if (!resEmpty(form.res)) {
    RES_KEYS.forEach((k) => {
      const v = parseNumber(form.res[k]);
      if (String(form.res[k]).trim() === '') e.res[k] = 'Заполните (можно 0)';
      else if (!isCount(v)) e.res[k] = 'Целое число от 0';
    });
  }
  return e;
}
export const hasErrors = (e) => Object.keys(e.works).length > 0 || Object.keys(e.res).length > 0;

/** Предупреждения: выполнение уменьшилось, объём больше проекта, резкий скачок, никого на объекте. */
export function warnings(form, original, works) {
  const w = [];
  changedWorks(form, original, works).forEach((work) => {
    const a = workValue(work, form.works[work.id]);
    const b = workValue(work, original.works[work.id]);
    if (a.pct < b.pct) w.push(`«${work.name}»: выполнение уменьшилось (было ${pctText(b.pct, 1)}). Вносится накопительно — с начала работ.`);
    if (a.fv != null && a.fv > work.planVolume) w.push(`«${work.name}»: факт больше проекта (${numberToInput(work.planVolume)} ${work.unit ?? ''}) — учитывается не больше 100 %.`);
    if (a.pct - b.pct > 0.3) w.push(`«${work.name}»: рост сразу на ${Math.round((a.pct - b.pct) * 100)} п.п. — проверьте значение.`);
  });
  if (!resEmpty(form.res) && resChanged(form, original) && parseNumber(form.res.people) === 0 && parseNumber(form.res.peopleLandscape) === 0) {
    w.push('На объекте указано 0 человек — так и есть?');
  }
  return w;
}

/** Готовность школы по введённым значениям: Σ вес × выполнение (как на сервере). */
export function previewFact(form, works) {
  return works.reduce((a, w) => {
    const v = workValue(w, form.works[w.id]).pct;
    return a + (Number(w.weight) || 0) * (Number.isNaN(v) ? 0 : v);
  }, 0);
}
