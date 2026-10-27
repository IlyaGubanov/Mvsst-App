// =====================================================================
//  model.js — расчёты для отображения «Сводки» (без разметки, чтобы их было легко проверить).
//  Сами показатели направлений считает сервер; здесь только итоги «по организации» и подписи.
// =====================================================================

import { directionUi } from '../../directions.js';
import { pp } from '../../utils/format.js';

/** Тон карточки: good / warn / crit / idle (нет графика или данных). Пороги — со статуса сервера. */
export function tone(dir) {
  const k = dir.kpi;
  if (!k || k.plan == null || k.fact == null) return 'idle';
  if (k.fact >= 0.999) return 'good';
  if (dir.status === 'crit') return 'crit';
  if (dir.status === 'warn') return 'warn';
  return 'good';
}

export function toneLabel(dir) {
  const k = dir.kpi;
  const t = tone(dir);
  if (t === 'idle') return k?.fact != null ? 'без графика в отчёте' : 'нет данных';
  if (k.fact >= 0.999) return '✓ выполнено';
  return (t === 'good' ? '● ' : '▼ ') + pp(k.fact - k.plan) + ' к плану';
}

/** Итоги по всем направлениям для верхней полосы. */
export function totals(dirs) {
  const T = {
    objects: 0, lag: 0, crit: 0, schedObjects: 0,
    portfolio: 0, portfolioDirs: [], closed: 0, closedBase: 0, closedDirs: [],
    people: 0, tech: 0, resDirs: [], noSched: [],
  };
  for (const d of dirs) {
    const k = d.kpi;
    if (!k) continue;
    T.objects += k.objects || 0;
    if (k.money?.portfolio) { T.portfolio += k.money.portfolio; T.portfolioDirs.push(d.code); }
    if (k.money?.closed != null) { T.closed += k.money.closed; T.closedBase += k.money.portfolio || 0; T.closedDirs.push(d.code); }
    if (k.people != null || k.tech != null) { T.people += k.people || 0; T.tech += k.tech || 0; T.resDirs.push(d.code); }
    if (k.lagging != null) { T.lag += k.lagging || 0; T.crit += k.critical || 0; T.schedObjects += k.objects || 0; }
    else T.noSched.push(d.code);
  }
  return T;
}

/** ['schools', 'mkd'] → «Школы, МКД» */
export const shortNames = (codes) => codes.map((c) => directionUi(c).short).join(', ');

/** Направление с наибольшим отставанием (по отклонению факт − план). */
export function worstDirection(dirs) {
  return dirs
    .filter((d) => d.kpi && d.kpi.plan != null && d.kpi.fact != null)
    .sort((a, b) => (a.kpi.fact - a.kpi.plan) - (b.kpi.fact - b.kpi.plan))[0] ?? null;
}
