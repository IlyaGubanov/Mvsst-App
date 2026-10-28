// Общие элементы раздела «Школы»: статус, S-кривая, тройная полоса закупок, состояние систем.
import DynamicsChart from '../../components/DynamicsChart.jsx';
import { fdm, pct } from '../../utils/format.js';

// Статусы школ те же, что у объектов «Сетей» (crit / warn / ok / done / wait) — берём готовый значок
export { NetStatus as SchStatus } from '../networks/ui.jsx';

const ms = (iso) => Date.parse(`${iso}T00:00:00`);

/**
 * S-кривая: план по неделям на всю шкалу работ + фактические точки (дни ввода).
 * Сервер отдаёт их двумя списками — здесь сливаем в один по датам (t — положение по оси X).
 */
export function SCurve({ curve, title }) {
  const byDate = new Map();
  curve.plan.forEach((p) => byDate.set(p.date, { t: ms(p.date), label: fdm(p.date), plan: p.plan, fact: null }));
  curve.fact.forEach((f) => byDate.set(f.date, { t: ms(f.date), label: fdm(f.date), plan: f.plan, fact: f.fact }));
  const points = [...byDate.values()].sort((a, b) => a.t - b.t);
  return <DynamicsChart points={points} title={title} markerT={ms(curve.today)} maxLabels={9} />;
}

/** Цвет ячейки по отклонению факта от плана (доли) и порогам направления (п.п.). */
export function devTone(fact, plan, thr = { warn: 2, crit: 10 }) {
  if (fact >= 0.999) return 'good';
  const d = (fact - plan) * 100;
  if (d < -thr.crit) return 'crit';
  if (d < -thr.warn) return 'warn';
  return plan > 0 || fact > 0 ? 'good' : '';
}

/** Оплата → поставка → монтаж: три короткие полосы (доли 0..1). */
export function Triple({ pay, delivered, installed }) {
  const row = (name, v) => (
    <div><span>{name}</span><span className="bar"><i style={{ width: `${Math.min(100, (v || 0) * 100)}%` }} /></span><span>{pct(v)}</span></div>
  );
  return <div className="triple">{row('оплата', pay)}{row('поставка', delivered)}{row('монтаж', installed)}</div>;
}

/** Статус экспертизы: в таблице прописными и длинный — показываем коротко, полный текст в подсказке. */
export function MgeStatus({ status }) {
  if (!status) return <span className="sub">—</span>;
  const positive = /ПОЛОЖ/i.test(status);
  const text = positive ? '✓ положительное' : /ОТРИЦ/i.test(status) ? '✕ отрицательное' : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={'pill ' + (positive ? 'good' : /ОТРИЦ/i.test(status) ? 'crit' : 'warn')} title={status}>{text}</span>;
}

// Состояния систем на индивидуальных испытаниях (как в прежнем модуле)
export const SYS_STATE = {
  'работоспособна': { cls: 'sys-ok', icon: '✓', name: 'работоспособна' },
  'готово': { cls: 'sys-ready', icon: '●', name: 'готово к испытаниям' },
  'отсутствует': { cls: 'sys-none', icon: '✕', name: 'отсутствует' },
};

export function SysCell({ state, idDocs }) {
  const s = SYS_STATE[state];
  if (!s) return <span className="sub">{state || '—'}</span>;
  return <span className={s.cls} title={`${s.name}${idDocs ? ' · есть ИД' : ''}`}>{s.icon}{idDocs ? ' ИД' : ''}</span>;
}
