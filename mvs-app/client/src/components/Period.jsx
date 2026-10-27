// Общие элементы разделов направлений: полоса «факт против плана» и выбор отчётного периода.
import { periodLabel, pct100 } from '../utils/format.js';

/** Полоса «факт против плана» (проценты 0..100). Цвет — переменная --tc или параметр color. */
export function ProgressBar({ pct, plan, color }) {
  const f = Math.max(0, Math.min(100, pct ?? 0));
  const p = plan == null ? null : Math.max(0, Math.min(100, plan));
  return (
    <div className="mini-bar" role="img" aria-label={`Факт ${pct100(pct)}${p == null ? '' : `, план ${pct100(plan)}`}`} style={color ? { '--tc': color } : undefined}>
      {p != null && <div className="pz" style={{ width: `${p}%` }} />}
      <div className="fill" style={{ width: `${f}%` }} />
      {p != null && <div className="pm" style={{ left: `${p}%` }} />}
    </div>
  );
}

/** Подпись периода для списков: «26.10–28.10 · неделя · закрыт». */
export function periodOption(p) {
  return `${periodLabel(p)}${p.isLegacy ? ' · неделя' : ''}${p.isClosed ? ' · закрыт' : ''}`;
}

/** Выбор отчётного периода. */
export function PeriodSelect({ periods, value, onChange, label = 'Период' }) {
  return (
    <label className="period-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {periods.map((p) => <option key={p.start} value={p.start}>{periodOption(p)}</option>)}
      </select>
    </label>
  );
}
