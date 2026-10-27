// «Наибольшее отставание от графика»: худшие объекты всех направлений, фильтр по направлению.
// Клик по строке открывает карточку объекта в разделе направления.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { directionUi } from '../../directions.js';
import { pp } from '../../utils/format.js';

export default function AttentionCard({ dirs }) {
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();
  const withList = dirs.filter((d) => d.kpi?.attention);

  const rows = withList
    .filter((d) => filter === 'all' || d.code === filter)
    .flatMap((d) => d.kpi.attention.map((a) => ({ ...a, dir: d.code })))
    .sort((a, b) => a.d - b.d)
    .slice(0, filter === 'all' ? 12 : 8);

  return (
    <section className="card" aria-labelledby="attH">
      <div className="sec-h" style={{ marginBottom: 6 }}>
        <h2 id="attH">Наибольшее отставание от графика</h2>
        <span className="hint">факт минус план, п.п.</span>
      </div>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все направления</button>
        {withList.map((d) => {
          const ui = directionUi(d.code);
          return (
            <button key={d.code} type="button" className="chip" style={{ '--tc': ui.color }} aria-pressed={filter === d.code} onClick={() => setFilter(d.code)}>
              <i />{ui.name}
            </button>
          );
        })}
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">Отставаний от графика нет.</div>}
        {rows.map((r) => {
          const ui = directionUi(r.dir);
          return (
            <button
              key={`${r.dir}-${r.id}`} type="button" className="row" style={{ '--tc': ui.color }}
              title={`${ui.name}: открыть объект`} onClick={() => navigate(`/${r.dir}/${r.id}`)}
            >
              <i aria-hidden="true" />
              <span className="nm">{r.name}</span>
              <span className={`pill ${r.crit ? 'crit' : 'warn'}`}>{pp(r.d)}</span>
              <span className="sb">{ui.name} · {r.sub}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
