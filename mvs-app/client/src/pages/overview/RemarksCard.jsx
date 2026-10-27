// «Замечания» — объекты благоустройства с наибольшим числом замечаний в последнем отчёте.
import { useNavigate } from 'react-router';
import { directionUi } from '../../directions.js';
import { asOfText, nf } from '../../utils/format.js';

export default function RemarksCard({ dirs }) {
  const navigate = useNavigate();
  const dir = dirs.find((d) => d.kpi?.remarks?.length);
  if (!dir) return null;
  const ui = directionUi(dir.code);

  return (
    <section className="card" aria-labelledby="remH" style={{ '--tc': ui.color }}>
      <div className="sec-h" style={{ marginBottom: 0 }}>
        <h2 id="remH">Замечания: {ui.name.toLowerCase()}</h2>
        <span className="hint">{asOfText(dir.kpi)}</span>
      </div>
      <div className="list">
        {dir.kpi.remarks.slice(0, 6).map((r) => (
          <button key={r.id} type="button" className="row" onClick={() => navigate(`/${dir.code}/${r.id}`)}>
            <i aria-hidden="true" />
            <span className="nm">{r.name}</span>
            <span className={`pill ${r.n >= 10 ? 'crit' : 'warn'}`}>{nf(r.n)} зам.</span>
            <span className="sb">{r.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
