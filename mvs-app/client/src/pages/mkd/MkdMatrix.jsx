// =====================================================================
//  «Капремонт МКД» → вкладка «Матрица» (vMatrix прежнего модуля): вся программа на одном экране.
//  Строки — адреса, столбцы — виды работ, последний столбец — итог по адресу.
//  Режимы (?mx=): статус (по умолчанию) · готовность % (pct) · отклонение от графика (lag).
//  Красная рамка — срок прошёл, ■ — критичное отставание. Нажатие на ячейку открывает адрес.
// =====================================================================

import { useNavigate, useSearchParams } from 'react-router';
import { useMkdMatrix } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { nf, pct100 } from '../../utils/format.js';
import { STATUS, RISK } from './ui.jsx';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

const MODES = [
  { id: 'status', name: 'Статус' },
  { id: 'pct', name: 'Готовность %' },
  { id: 'lag', name: 'Отклонение от графика' },
];
const LEGEND_ORDER = ['paid', 'ks', 'work', 'stop', 'plan', 'excl'];
const STATUS_FULL = { ...Object.fromEntries(Object.entries(STATUS).map(([k, s]) => [k, s.name])), ks: 'КС-2 подписаны, к оплате' };
// На светлых заливках (жёлтая «приостановлено», серые) — тёмный текст, на остальных — белый
const DARK_TEXT = new Set(['stop', 'excl']);
const mlnN = (v) => nf((v || 0) / 1e6, 1);
const ppText = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf(Math.abs(v), 1)} п.п.`);

/** Цвет и текст ячейки для режима. Смешение цветов — через color-mix, поэтому работает в обеих темах. */
function look(c, mode) {
  if (mode === 'status') {
    const inWork = c.st === 'work' || c.st === 'stop';
    let text = inWork ? String(Math.round(c.pct)) : '';
    if (c.st === 'work' && c.risk === 'crit') text = `■${text}`;
    return { bg: STATUS[c.st].color, ink: DARK_TEXT.has(c.st) ? 'var(--ink)' : '#fff', text };
  }
  if (mode === 'pct') {
    const t = Math.max(0, Math.min(100, c.pct));
    return { bg: `color-mix(in srgb, var(--accent) ${t}%, var(--surface-2))`, ink: t > 55 ? '#fff' : 'var(--ink)', text: String(Math.round(c.pct)) };
  }
  if (c.lag == null) return { bg: 'var(--surface-2)', ink: 'var(--muted)', text: '' };
  const l = Math.max(-40, Math.min(40, c.lag));
  const t = Math.abs(l) / 40;
  return { bg: `color-mix(in srgb, ${l < 0 ? 'var(--crit)' : 'var(--accent)'} ${Math.round(t * 100)}%, var(--surface-2))`, ink: t > 0.6 ? '#fff' : 'var(--ink)', text: String(Math.round(c.lag)) };
}

/** Подсказка при наведении — как в прежнем модуле. */
const tip = (title, c) => [
  title, `Статус: ${STATUS_FULL[c.st]}`, `Готовность: ${pct100(c.pct)}`, `План на дату: ${pct100(c.plan)}`,
  `Отклонение: ${ppText(c.lag)} (${RISK[c.risk]?.name ?? '—'})`, `Договор: ${mlnN(c.contract)} млн`, `КС-2: ${mlnN(c.ks)} млн`, `Оплачено: ${mlnN(c.paid)} млн`,
  c.overdue ? '⚠ срок прошёл' : null,
].filter(Boolean).join('\n');

export default function MkdMatrix({ meta, period }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filterState = useMkdFilters();
  const mx = useMkdMatrix(period, filterState.filters);
  const mode = MODES.some((m) => m.id === params.get('mx')) ? params.get('mx') : 'status';
  const setMode = (m) => {
    const next = new URLSearchParams(params);
    if (m === 'status') next.delete('mx'); else next.set('mx', m);
    setParams(next, { replace: true });
  };
  const open = (id) => navigate(`/mkd/${id}${period ? `?period=${period}` : ''}`);
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (mx.isPending) return <>{filterBar}<Loading text="Строим матрицу…" /></>;
  if (mx.isError) return <>{filterBar}<ErrorBox error={mx.error} onRetry={mx.refetch} /></>;
  const { types, objects } = mx.data;
  if (!objects.length) return <>{filterBar}<div className="card">Нет позиций под выбранные фильтры.</div></>;

  const cell = (c, title, objectId, key, total) => {
    if (!c) return <td key={key} className="mxc empty" />;
    const { bg, ink, text } = look(c, mode);
    return (
      <td key={key} className={'mxc' + (c.overdue ? ' od' : '') + (total ? ' tot' : '')} style={{ background: bg, color: ink }}
        title={tip(title, c)} onClick={() => open(objectId)}>{text}</td>
    );
  };

  return (
    <>
      {filterBar}
      <section className="card" aria-labelledby="mxH">
        <div className="sec-h">
          <div>
            <h2 id="mxH">Матрица «адрес × вид работ»</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>Вся программа на одном экране. Нажмите на ячейку, чтобы открыть адрес.</p>
          </div>
          <div className="chips" role="group" aria-label="Что показывать в ячейках">
            {MODES.map((m) => <button key={m.id} type="button" className="chip" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.name}</button>)}
          </div>
        </div>

        {mode === 'status' && (
          <div className="legend-row">
            {LEGEND_ORDER.map((k) => <span key={k}><i className="sw" style={{ background: STATUS[k].color }} />{STATUS_FULL[k]}</span>)}
            <span className="hint">Число в ячейке «В работе» — % готовности; ■ — критичное отставание; красная рамка — срок прошёл.</span>
          </div>
        )}
        {mode === 'pct' && (
          <div className="mx-scale">0 %<span style={{ background: 'linear-gradient(90deg, var(--surface-2), var(--accent))' }} />100 % готовности</div>
        )}
        {mode === 'lag' && (
          <div className="mx-scale">отстаёт −40 п.п.<span style={{ background: 'linear-gradient(90deg, var(--crit), var(--surface-2), var(--accent))' }} />опережает +40 п.п.</div>
        )}

        <div className="tbl-wrap flat mx-wrap">
          <table className="mx">
            <thead>
              <tr>
                <th className="addr-h" />
                {types.map((t) => <th key={t.id} className="vh" title={t.fullName || t.name}><div>{t.name}</div></th>)}
                <th className="vh"><div>Итого по адресу</div></th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.id}>
                  <td className="addr" title={o.address} onClick={() => open(o.id)}>{o.address}</td>
                  {types.map((t) => cell(o.cells[t.id], `${o.address} — ${t.name}`, o.id, t.id))}
                  {cell(o.total, `${o.address} — итого`, o.id, 'total', true)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
