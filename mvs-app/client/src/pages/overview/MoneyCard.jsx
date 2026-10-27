// «Деньги по направлениям»: полоса портфеля, закрашенная часть — закрыто КС-2 (у школ — оплачено),
// светлая вставка — оплачено. Масштаб общий: самая длинная полоса — самый большой портфель.
import { directionUi } from '../../directions.js';
import { bn, bnShort, pct } from '../../utils/format.js';

export default function MoneyCard({ dirs }) {
  const rows = dirs.filter((d) => d.kpi);
  const max = Math.max(1, ...rows.map((d) => d.kpi.money?.portfolio || 0));

  return (
    <section className="card" aria-labelledby="monH">
      <div className="sec-h"><h2 id="monH">Деньги по направлениям</h2><span className="hint">млрд ₽</span></div>
      <div className="money">
        {rows.map((d) => {
          const ui = directionUi(d.code);
          const m = d.kpi.money;
          if (!m?.portfolio) {
            return (
              <div key={d.code} className="mrow" style={{ '--tc': ui.color }}>
                <div className="n"><i /><span>{ui.name}</span></div>
                <div className="mempty">в отчёте нет стоимостных данных</div>
              </div>
            );
          }
          const done = m.closed != null ? m.closed : m.paid || 0;
          const doneLabel = m.closed != null ? 'закрыто КС-2' : 'оплачено';
          const showPaid = m.closed != null && m.paid != null;
          const tip = `${ui.name}: ${m.portfolioLabel || 'стоимость'} ${bn(m.portfolio)}, ${doneLabel} ${bn(done)}${showPaid ? `, оплачено ${bn(m.paid)}` : ''}`;
          return (
            <div key={d.code} className="mrow" style={{ '--tc': ui.color }} title={tip}>
              <div className="n"><i /><span>{ui.name}</span></div>
              <div className="mtrack" role="img" aria-label={tip}>
                <div className="tot-b" style={{ width: `${(m.portfolio / max) * 100}%` }} />
                <div className="done" style={{ width: `${(done / max) * 100}%` }} />
                {showPaid && <div className="paid" style={{ width: `${(m.paid / max) * 100}%` }} />}
              </div>
              <div className="mval">
                <b>{bnShort(done)}</b> из {bnShort(m.portfolio)} · {doneLabel} {pct(done / m.portfolio)}
                {showPaid && ` · оплачено ${bnShort(m.paid)}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mlegend">
        <span><i style={{ background: 'linear-gradient(90deg,var(--d-schools),var(--d-mkd),var(--d-networks))' }} />закрыто КС-2 (школы — оплачено)</span>
        <span><i style={{ background: 'var(--surface-3)' }} />остаток лимита или договора</span>
        <span><i style={{ background: 'var(--surface)', border: '1px solid var(--line-2)' }} />светлая вставка — оплачено</span>
      </div>
    </section>
  );
}
