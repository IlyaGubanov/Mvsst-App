// =====================================================================
//  «Капремонт МКД» → вкладка «График работ» — диаграмма Ганта (vGantt прежнего модуля).
//  Строка — адрес: полоса — срок работ (без ПСД), тёмная часть — фактическая готовность,
//  цвет полосы — отставание адреса. Нажатие на адрес раскрывает его виды работ.
//  Красная линия — дата среза (плановая дата выбранного периода), красная рамка — срок прошёл.
//  Параметры в адресе: ?psd=1 — показать ПСД, ?gs=lag|addr — сортировка (по умолчанию — по окончанию).
// =====================================================================

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMkdGantt } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { fdate, nf, pct100 } from '../../utils/format.js';
import { STATUS } from './ui.jsx';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const SORTS = {
  end: { name: 'по окончанию', fn: (a, b) => (a.end || '').localeCompare(b.end || '') },
  lag: { name: 'по отставанию', fn: (a, b) => (a.lag ?? 0) - (b.lag ?? 0) },
  addr: { name: 'по адресу', fn: (a, b) => a.address.localeCompare(b.address, 'ru') },
};
// Цвет полосы адреса — по отставанию; остаток работ — полупрозрачный, готовность — зелёная
const BAR = {
  crit: 'color-mix(in srgb, var(--crit) 35%, transparent)',
  warn: 'color-mix(in srgb, var(--warn) 50%, transparent)',
  ok: 'color-mix(in srgb, var(--accent) 30%, transparent)',
  na: 'color-mix(in srgb, var(--accent) 30%, transparent)',
};
const ms = (iso) => Date.parse(`${iso}T00:00:00`);
// Первое число месяца в виде ГГГГ-ММ-01 по местному времени (toISOString сдвинул бы дату в UTC на день назад)
const monthIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const ppText = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf(Math.abs(v), 1)} п.п.`);

export default function MkdGantt({ meta, period }) {
  const [params, setParams] = useSearchParams();
  const filterState = useMkdFilters();
  const psd = params.get('psd') === '1';
  const sort = SORTS[params.get('gs')] ? params.get('gs') : 'end';
  const g = useMkdGantt(period, filterState.filters, psd);
  const [open, setOpen] = useState(() => new Set());   // раскрытые адреса

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (g.isPending) return <>{filterBar}<Loading text="Строим график работ…" /></>;
  if (g.isError) return <>{filterBar}<ErrorBox error={g.error} onRetry={g.refetch} /></>;
  const { scale, objects, planDate } = g.data;
  if (!scale) return <>{filterBar}<div className="card">Нет позиций с датами.</div></>;

  const t0 = ms(scale.start);
  const span = ms(scale.end) - t0;
  const X = (iso) => Math.max(0, Math.min(100, ((ms(iso) - t0) / span) * 100)); // положение даты на шкале, %
  const months = [];
  for (let d = new Date(t0); d.getTime() < ms(scale.end); d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const today = planDate >= scale.start && planDate <= scale.end ? X(planDate) : null;
  const list = [...objects].sort(SORTS[sort].fn);
  const allOpen = list.length > 0 && list.every((o) => open.has(o.id));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Сетка месяцев и линия среза — фон каждой дорожки
  const grid = (
    <>
      {months.map((m) => <i key={m.getTime()} className="g-line" style={{ left: `${X(monthIso(m))}%` }} />)}
      {today != null && <i className="g-today" style={{ left: `${today}%` }} />}
    </>
  );
  const bar = (start, end, pct, color, fill, overdue, tip) => (start && end ? (
    <div className={'g-bar' + (overdue ? ' od' : '')} style={{ left: `${X(start)}%`, width: `${Math.max(0.4, X(end) - X(start))}%`, background: color }} title={tip}>
      <div className="g-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: fill }} />
    </div>
  ) : null);

  return (
    <>
      {filterBar}
      <section className="card" aria-labelledby="gH">
        <div className="sec-h">
          <div>
            <h2 id="gH">График работ</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              Полоса — срок работ, тёмная часть — фактическая готовность; красная линия — дата среза ({fdate(planDate)}); красная рамка — срок прошёл.
              Нажмите на адрес, чтобы раскрыть виды работ.
            </p>
          </div>
          <div className="toolbar">
            <label className="check"><input type="checkbox" checked={psd} onChange={(e) => setParam('psd', e.target.checked ? '1' : null)} />показать ПСД</label>
            <select className="tb-select" value={sort} onChange={(e) => setParam('gs', e.target.value === 'end' ? null : e.target.value)} aria-label="Сортировка">
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Сортировка {s.name}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((o) => o.id)))}>
              {allOpen ? 'Свернуть все' : 'Раскрыть все'}
            </button>
          </div>
        </div>
        <div className="legend-row">
          <span><i className="sw" style={{ background: 'var(--good)' }} />Фактическая готовность</span>
          <span><i className="sw" style={{ background: BAR.ok }} />Остаток работ</span>
          <span><i className="sw" style={{ background: BAR.warn }} />Адрес с отставанием</span>
          <span><i className="sw" style={{ background: BAR.crit }} />Критично</span>
        </div>

        <div className="g-wrap">
          <div className="gantt">
            <div className="g-row g-head">
              <div className="g-lab hint">Адрес / вид работ</div>
              <div className="g-track">
                {months.map((m, k) => (
                  <span key={m.getTime()} className="g-month" style={{ left: `${X(monthIso(m))}%` }}>
                    {MONTHS[m.getMonth()]}{m.getMonth() === 0 || k === 0 ? ` ${m.getFullYear()}` : ''}
                  </span>
                ))}
              </div>
            </div>
            {list.map((o) => {
              const isOpen = open.has(o.id);
              const tip = [o.address, `Сроки: ${fdate(o.start)} – ${fdate(o.end)}`, `Готовность: ${pct100(o.pct)}`, `План на дату: ${pct100(o.plan)}`,
                `Отклонение: ${ppText(o.lag)}`, `Просрочено позиций: ${o.overdue}`].join('\n');
              return (
                <div key={o.id} className="g-group">
                  <div className="g-row obj">
                    <button type="button" className="g-lab" aria-expanded={isOpen} onClick={() => toggle(o.id)} title={o.address}>
                      <span className="g-caret">{isOpen ? '▾' : '▸'}</span>{o.address}
                    </button>
                    <div className="g-track">{grid}{bar(o.start, o.end, o.pct, BAR[o.risk] ?? BAR.ok, 'var(--good)', false, tip)}</div>
                  </div>
                  {isOpen && o.items.map((it) => {
                    const t = [it.workType, `Статус: ${STATUS[it.st]?.name}`, `Сроки: ${fdate(it.start)} – ${fdate(it.end)}`, `Готовность: ${pct100(it.pct)}`,
                      `План на дату: ${pct100(it.plan)}`, `Ответственный: ${it.responsible ?? '—'}`].join('\n');
                    const color = it.done ? STATUS[it.st].color : BAR.ok;
                    return (
                      <div key={it.id} className="g-row sub">
                        <div className="g-lab" title={it.workType}>{it.workType}</div>
                        <div className="g-track">{grid}{bar(it.start, it.end, it.done ? 100 : it.pct, color, it.done ? STATUS[it.st].color : 'var(--good)', it.overdue, t)}</div>
                      </div>
                    );
                  })}
                  {isOpen && <div className="g-row sub"><div className="g-lab"><Link to={`/mkd/${o.id}${period ? `?period=${period}` : ''}`}>Открыть карточку адреса →</Link></div><div className="g-track" /></div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
