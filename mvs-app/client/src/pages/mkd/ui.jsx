// =====================================================================
//  Общие мелкие элементы раздела МКД: подписи статусов и риска, деньги по стадиям,
//  выбор периода, полоса готовности.
// =====================================================================

import { nf } from '../../utils/format.js';

export const STATUS = {
  plan: { name: 'Не начато', color: 'var(--muted)' },
  work: { name: 'В работе', color: 'var(--accent)' },
  stop: { name: 'Приостановлено', color: 'var(--warn)' },
  ks: { name: 'КС-2 подписаны', short: 'К оплате', color: 'var(--d-mkd)' },
  paid: { name: 'Оплачено', color: 'var(--good)' },
  excl: { name: 'Исключено', color: 'var(--surface-3)' },
};
export const STATUS_ORDER = ['plan', 'work', 'stop', 'ks', 'paid', 'excl'];

export const RISK = {
  ok: { name: 'В графике', tone: 'good' },
  warn: { name: 'Отставание', tone: 'warn' },
  crit: { name: 'Критично', tone: 'crit' },
  na: { name: 'Нет графика', tone: 'idle' },
};

/** Метка статуса позиции с цветной точкой. */
export function StatusChip({ status }) {
  const s = STATUS[status] ?? STATUS.plan;
  return <span className="st-chip"><i style={{ background: s.color }} />{s.short ?? s.name}</span>;
}

/** Метка риска: «▼ −23 п.п.» или «В графике». lag — в п.п. */
export function RiskPill({ risk, lag }) {
  const r = RISK[risk] ?? RISK.na;
  const text = lag == null || risk === 'na' ? r.name
    : risk === 'ok' ? `● ${lag >= 0 ? '+' : '−'}${Math.abs(Math.round(lag))} п.п.`
      : `▼ −${Math.abs(Math.round(lag))} п.п.`;
  return <span className={`pill ${r.tone}`} title={r.name}>{text}</span>;
}

// Деньги договора по стадиям (MONEY_SEGS прежнего модуля): оплачено / к оплате / в работе / экономия
export const MONEY_SEGS = [
  { k: 'paid', name: 'Оплачено', color: STATUS.paid.color },
  { k: 'topay', name: 'КС-2 подписаны, к оплате', color: STATUS.ks.color },
  { k: 'openForecast', name: 'В работе (прогноз КС-2)', color: STATUS.work.color },
  { k: 'econ', name: 'Экономия / снято с договора', color: 'var(--surface-3)' },
];
const mlnN = (v) => nf((v || 0) / 1e6, 1);

/**
 * Полоса «куда ушли деньги»: цветные части пропорционально суммам стадий.
 * a — итоги с полями paid, topay, openForecast, econ, contract; scale — максимум, чтобы сравнивать строки по длине.
 */
export function MoneyBar({ a, scale, big }) {
  const vals = { paid: a.paid, topay: a.topay, openForecast: a.openForecast, econ: Math.max(0, a.econ) };
  const used = vals.paid + vals.topay + vals.openForecast + vals.econ;
  const tot = scale || Math.max(a.contract, used) || 1;
  const tip = MONEY_SEGS.map((s) => `${s.name}: ${mlnN(vals[s.k])} млн ₽`).concat(`Договор: ${mlnN(a.contract)} млн ₽`).join('\n');
  return (
    <div className={'money-bar' + (big ? ' big' : '')} style={{ width: `${Math.min(100, (used / tot) * 100)}%` }} title={tip}>
      {MONEY_SEGS.map((s) => (vals[s.k] > 0 ? <i key={s.k} style={{ flex: `${vals[s.k]} 1 0`, background: s.color }} /> : null))}
    </div>
  );
}

// Полоса готовности и выбор периода — общие для всех направлений (components/Period.jsx)
export { ProgressBar, PeriodSelect, periodOption } from '../../components/Period.jsx';
