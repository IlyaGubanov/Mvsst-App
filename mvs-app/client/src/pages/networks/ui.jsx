// Мелкие элементы раздела «Сети»: статусы объектов и отклонение.
import { pp } from '../../utils/format.js';

export const NET_STATUS = {
  crit: { name: 'Критично', tone: 'crit', icon: '✕' },
  warn: { name: 'Отставание', tone: 'warn', icon: '!' },
  ok: { name: 'В графике', tone: 'good', icon: '●' },
  done: { name: 'Выполнено', tone: 'good', icon: '✓' },
  wait: { name: 'Не начато', tone: 'idle', icon: '○' },
};
export const NET_STATUS_ORDER = ['crit', 'warn', 'ok', 'done', 'wait'];

/** Статус объекта; для отстающих — сразу с отклонением в п.п. dev — доля (факт − план). */
export function NetStatus({ status, dev }) {
  const s = NET_STATUS[status] ?? NET_STATUS.wait;
  const text = (status === 'warn' || status === 'crit') && dev != null ? `▼ ${pp(dev)}` : `${s.icon} ${s.name}`;
  return <span className={`pill ${s.tone}`} title={s.name}>{text}</span>;
}

/** Документ объекта: «+» — есть (зелёный), «нет» — красный, остальное — как текст. */
export function Doc({ label, value }) {
  if (!value) return null;
  const v = String(value).trim();
  const cls = v === '+' ? 'ok' : /^нет$/i.test(v) ? 'no' : '';
  return <span className={`doc ${cls}`}><b>{label}</b>{v === '+' ? '✓' : v}</span>;
}
