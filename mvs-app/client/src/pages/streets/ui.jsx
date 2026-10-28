// Общие элементы раздела «Благоустройство»: статус объекта, состояние позиции, изменения к прошлому отчёту.
import { fdate, numberToInput } from '../../utils/format.js';

/** Объём для показа: 3439 → «3 439», 12.5 → «12,5», null → «—». */
export const vol = (v) => (v == null ? '—' : numberToInput(v));

/** Статус объекта из отчёта: завершённые — зелёные, остальные — как есть. */
export function StStatus({ status, complete }) {
  if (!status) return <span className="pill idle">статус не указан</span>;
  return <span className={`pill ${complete ? 'good' : 'warn'}`}>{complete ? '✓ ' : ''}{status}</span>;
}

/** Изменение к отчёту сравнения: «+12», «−3»; kind=remarks — рост замечаний плохо (красный). */
export function Delta({ v, kind = 'fact', unit = '' }) {
  if (v == null || v === 0) return null;
  const bad = kind === 'remarks' ? v > 0 : v < 0;
  return <span className={`delta ${bad ? 'bad' : 'good'}`}>{v > 0 ? '+' : '−'}{vol(Math.abs(v))}{unit ? ` ${unit}` : ''}</span>;
}

// Состояния позиции «объект × вид работ»
export const POS_STATE = {
  done: { name: 'Выполнено', icon: '✓' },
  partial: { name: 'Остаток', icon: '◷' },
  missing: { name: 'Нет факта', icon: '?' },
  na: { name: 'Не предусмотрено', icon: '' },
};

/** Ячейка матрицы: цвет по состоянию, внутри — процент выполнения; ! — факт снизился. */
export function PosCell({ v, work }) {
  if (!v || v.state === 'na') return <td className="pos na" />;
  const rate = v.p > 0 && v.f != null ? Math.min(1, v.f / v.p) : null;
  const text = v.state === 'done' ? '✓' : v.state === 'missing' ? '?' : `${Math.floor((rate ?? 0) * 100)}%`;
  const tip = `${work.name}: проект ${vol(v.p)}, факт ${vol(v.f)}${work.unit ? ` ${work.unit}` : ''}${v.df ? `, изменение ${v.df > 0 ? '+' : ''}${vol(v.df)}` : ''}`;
  return <td className={`pos ${v.state}${v.df < 0 ? ' issue' : ''}${v.df > 0 ? ' up' : ''}`} title={tip}>{text}{v.df < 0 && <b>!</b>}</td>;
}

/**
 * Подпись отчёта в списках: «23.10.2026 · вручную · закрыт».
 * «Закрыт» — только у ручных: отчёты из Excel всегда только для чтения, и писать это у каждого незачем.
 */
export const reportLabel = (r) => `${fdate(r.date)}${r.source === 'manual' ? ` · вручную${r.isClosed ? ' · закрыт' : ''}` : ''}`;
