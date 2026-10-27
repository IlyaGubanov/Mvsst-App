// =====================================================================
//  Карточка направления: готовность (факт против плана), объекты, отставание, деньги,
//  три собственных показателя направления и кнопка «Открыть направление».
// =====================================================================

import { Link } from 'react-router';
import { directionUi } from '../../directions.js';
import { asOfText, bn, nf, pct } from '../../utils/format.js';
import { tone, toneLabel } from './model.js';

export default function DirectionCard({ dir, showOpen = true }) {
  const ui = directionUi(dir.code);
  const k = dir.kpi;
  const style = { '--tc': ui.color };

  if (!k) {
    return (
      <article className="dir" style={style}>
        <div className="dir-h"><span className="dot" /><div className="t"><h3>{ui.name}</h3><div className="meta">Нет данных</div></div></div>
        {showOpen && <div className="dir-f"><span className="hint">{ui.about}</span><Link className="btn" to={`/${dir.code}`}>Открыть</Link></div>}
      </article>
    );
  }

  const hasPlan = k.plan != null;
  const f = Math.max(0, Math.min(1, k.fact || 0));
  const p = hasPlan ? Math.max(0, Math.min(1, k.plan)) : null;
  const m = k.money;

  // Третья ячейка: деньги, иначе люди/техника, иначе первый собственный показатель
  let moneyCell;
  let firstKpiUsed = false;
  if (m?.portfolio) {
    const done = m.closed != null ? { l: 'закрыто КС-2', v: m.closed } : m.paid != null ? { l: 'оплачено', v: m.paid } : null;
    moneyCell = (
      <div>
        <span className="l">{m.portfolioLabel || 'Стоимость'}</span>
        <span className="v">{bn(m.portfolio)}</span>
        {done && <span className="s">{done.l} {pct(done.v / m.portfolio)}</span>}
      </div>
    );
  } else if (k.people != null || k.tech != null) {
    moneyCell = <div><span className="l">Люди / техника</span><span className="v">{nf(k.people || 0)} / {nf(k.tech || 0)}</span></div>;
  } else {
    firstKpiUsed = true;
    moneyCell = <div><span className="l">{k.kpis?.[0]?.l ?? ''}</span><span className="v">{k.kpis?.[0]?.v ?? '—'}</span></div>;
  }

  // Вторая ячейка: отставание (если есть график) или число замечаний
  const remarksKpi = k.kpis?.find((x) => /Замечан/.test(x.l));
  const lagCell = k.lagging != null
    ? <div><span className="l">Отстают</span><span className={'v' + (k.critical ? ' crit' : '')}>{nf(k.lagging)}</span><span className="s">критично {nf(k.critical || 0)}</span></div>
    : <div><span className="l">Замечаний</span><span className="v">{remarksKpi?.v ?? '—'}</span><span className="s">в последнем отчёте</span></div>;

  // Остальные показатели — списком под карточкой
  const extra = (k.kpis ?? []).filter((x, i) => !(k.lagging == null && x === remarksKpi) && !(firstKpiUsed && i === 0));
  if (k.people != null && m?.portfolio) extra.unshift({ l: 'Люди / техника на объектах', v: `${nf(k.people)} чел. · ${nf(k.tech || 0)} ед.` });
  if (k.extra) extra.push({ l: k.extra.label, v: k.extra.value });

  const t = tone(dir);
  return (
    <article className="dir" style={style}>
      <div className="dir-h">
        <span className="dot" aria-hidden="true" />
        <div className="t">
          <h3>{ui.name}</h3>
          <div className="meta">
            {asOfText(k)}
            {dir.canEdit && <span className="src mine">вы вносите данные</span>}
          </div>
        </div>
        <span className={`pill ${t}`}>{toneLabel(dir)}</span>
      </div>

      <div className="ready" title={k.factLabel}>
        <span className="big">{pct(k.fact)}</span>
        <span className="cap">
          {hasPlan && <>план на дату <b>{pct(k.plan)}</b><br /></>}
          {(k.factLabel || '').toLowerCase()}
        </span>
        <div className="bullet" role="img" aria-label={`Факт ${pct(k.fact)}${hasPlan ? `, план ${pct(k.plan)}` : ''}`}>
          {hasPlan && <div className="pz" style={{ width: `${p * 100}%` }} />}
          <div className="fill" style={{ width: `${f * 100}%` }} />
          {hasPlan && <div className="pm" style={{ left: `${p * 100}%` }} />}
        </div>
        <div className="scale" aria-hidden="true"><span>0</span><span>50 %</span><span>100 %</span></div>
      </div>

      <div className="facts">
        <div><span className="l">Объектов</span><span className="v">{nf(k.objects)}</span><span className="s">{k.unit}</span></div>
        {lagCell}
        {moneyCell}
      </div>

      {extra.length > 0 && (
        <dl className="more">
          {extra.map((x) => [<dt key={`${x.l}-t`}>{x.l}</dt>, <dd key={`${x.l}-d`}>{x.v}</dd>])}
        </dl>
      )}

      {showOpen && (
        <div className="dir-f">
          <span className="hint">{ui.about}</span>
          <Link className="btn primary" to={`/${dir.code}`}>Открыть направление →</Link>
        </div>
      )}
    </article>
  );
}
