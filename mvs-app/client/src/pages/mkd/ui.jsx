// =====================================================================
//  Общие мелкие элементы раздела МКД: подписи статусов и риска, выбор периода, полоса готовности.
// =====================================================================


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

// Полоса готовности и выбор периода — общие для всех направлений (components/Period.jsx)
export { ProgressBar, PeriodSelect, periodOption } from '../../components/Period.jsx';
