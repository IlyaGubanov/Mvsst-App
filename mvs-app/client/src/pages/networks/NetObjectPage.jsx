// =====================================================================
//  Карточка объекта «Сетей»: сведения и документы, итоги, линии (проект/факт), договоры,
//  динамика выполнения по отчётным периодам (график + таблица).
// =====================================================================

import { Link, useParams, useSearchParams } from 'react-router';
import { useNetMeta, useNetObject } from '../../api/networks.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { PeriodSelect, ProgressBar } from '../../components/Period.jsx';
import DynamicsChart from '../../components/DynamicsChart.jsx';
import { fdate, fdm, moneyShortRu, nf, pct, periodLabel, pp, rub } from '../../utils/format.js';
import { Doc, NetStatus } from './ui.jsx';

const vol = (v) => nf(v ?? 0, Number.isInteger(Number(v)) ? 0 : 1);

export default function NetObjectPage() {
  const { objectId } = useParams();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || undefined;
  const meta = useNetMeta();
  const card = useNetObject(objectId, period);

  if (meta.isPending || card.isPending) return <Loading text="Загружаем объект…" />;
  if (card.isError) return <ErrorBox error={card.error} onRetry={card.refetch} title={card.error.status === 404 ? 'Объект не найден' : undefined} />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;

  const { object: o, lines, contracts, series, period: p } = card.data;
  const setPeriod = (v) => setParams(v === meta.data.periods[0]?.start ? {} : { period: v }, { replace: true });
  const back = `/networks${period ? `?period=${period}` : ''}`;
  const isEx = (field) => o.exampleFields?.includes(field);
  const ex = (field) => isEx(field) && <span className="ex-mark" title="Значение подставлено при переносе из Excel — уточните">пример</span>;
  // Динамика — только до выбранного периода
  const points = series.filter((s) => s.period <= p.start).map((s) => ({ ...s, label: fdm(s.period) }));

  return (
    <div className="page sect net">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Сводка</Link><span>/</span><Link to={back}>Сети и водные объекты</Link><span>/</span><span>{o.short}</span>
      </nav>

      <div className="head">
        <div>
          <h1>{o.short}</h1>
          <p className="lead">{o.section}{o.seqNo ? ` · № ${o.seqNo}` : ''}{o.name !== o.short ? ` · ${o.name}` : ''}</p>
        </div>
        <div className="toolbar">
          <PeriodSelect periods={meta.data.periods} value={p.start} onChange={setPeriod} />
          {o.canEdit && <Link className="btn primary" to={`/networks/input?object=${o.id}`}>Внести данные</Link>}
        </div>
      </div>

      <section className="card info-grid" aria-label="Сведения об объекте">
        <div><span>Сроки работ</span>{fdate(o.start)} – {fdate(o.end)}{ex('end')}{o.noteEnd ? <div className="sub">{o.noteEnd}</div> : null}</div>
        <div><span>Статус по таблице</span>{o.sourceStatus ?? '—'}</div>
        <div><span>Субподрядчик</span>{o.sub ?? '—'}{ex('sub')}</div>
        <div><span>Проектировщик</span>{o.designer ?? '—'}{ex('designer')}</div>
        <div><span>Куратор ГУП МВС</span>{o.curator ?? '—'}{(isEx('curator') || o.curatorIsExample) && <span className="ex-mark">пример</span>}</div>
        <div><span>Ответственные за ввод</span>{o.responsible.length ? o.responsible.join(', ') : 'не назначены'}</div>
        <div><span>Последний ввод</span>{o.enteredBy ? `${o.enteredBy}, ${fdate(o.enteredAt)}` : `данные периода ${fdm(o.entryPeriod)} (перенос)`}</div>
        {o.note && <div><span>Примечание</span>{o.note}</div>}
        <div style={{ gridColumn: '1 / -1' }}>
          <span>Документы</span>
          <div className="docs">
            <Doc label="ПСД" value={o.docs.psd} /><Doc label="РД" value={o.docs.dwg} /><Doc label="МГЭ" value={o.docs.mge} />
            <Doc label="Согласования" value={o.docs.sogl} /><Doc label="Согл. ГКУ" value={o.docs.soglG} /><Doc label="Ордер ОАТИ" value={o.docs.order} />
            {!Object.values(o.docs).some(Boolean) && '—'}
          </div>
        </div>
      </section>

      <section className="tiles" aria-label="Итоги по объекту">
        <div className="tile"><span className="l">Выполнение</span><span className="v">{pct(o.fact)}</span><span className="s">план на {fdate(p.planDate)} — {pct(o.plan)}</span></div>
        <div className="tile"><span className="l">Статус</span><span className="v"><NetStatus status={o.status} dev={o.dev} /></span><span className="s">отклонение {pp(o.dev)}</span></div>
        <div className="tile"><span className="l">Договоры</span><span className="v">{moneyShortRu(o.cost)}</span><span className="s">{o.contracts} шт.</span></div>
        <div className="tile"><span className="l">Аванс</span><span className="v">{moneyShortRu(o.adv)}</span><span className="s">{pct(o.cost ? o.adv / o.cost : 0)} договоров</span></div>
        <div className="tile"><span className="l">Закрыто КС</span><span className="v">{moneyShortRu(o.ks)}</span><span className="s">{pct(o.cost ? o.ks / o.cost : 0)} договоров</span></div>
        <div className="tile"><span className="l">Люди / техника</span><span className="v">{o.workers} / {o.machines}</span><span className="s">период {periodLabel(p)}</span></div>
      </section>

      <section aria-labelledby="linesH">
        <div className="sec-h"><h2 id="linesH">Объёмы работ</h2><span className="hint">факт накопительно на период</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Вид работ</th><th className="num">Проект</th><th className="num">Факт</th><th className="num hide-sm">Остаток</th><th>Выполнение</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  {/* Вид работ под названием показываем, только если он отличается от названия линии */}
                  <td><div className="addr">{l.label}</div><div className="sub">{[l.kind !== l.label && l.kind, l.diameter && `Ø${l.diameter}`, l.sn && `SN${l.sn}`].filter(Boolean).join(' · ')}</div></td>
                  <td className="num">{vol(l.plan)} {l.unit}</td>
                  <td className="num">{vol(l.fact)} {l.unit}</td>
                  <td className="num hide-sm">{vol(Math.max(0, l.plan - l.fact))} {l.unit}</td>
                  <td><div className="prog"><ProgressBar pct={l.pct * 100} /><span>{pct(l.pct)}</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="dynH">
        <div className="sec-h"><h2 id="dynH">Динамика выполнения</h2><span className="hint">по отчётным периодам</span></div>
        <DynamicsChart points={points} title={`Динамика: ${o.short}`} />
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="data">
            <thead><tr><th>Период</th><th className="num">Факт</th><th className="num">План</th><th className="num">Отклонение</th><th className="num hide-sm">Закрыто КС</th><th className="num hide-sm">Люди / техн.</th></tr></thead>
            <tbody>
              {[...points].reverse().map((s) => (
                <tr key={s.period}>
                  <td>{s.label}{s.reported ? '' : <span className="sub"> · не вносили</span>}</td>
                  <td className="num">{pct(s.fact)}</td><td className="num">{pct(s.plan)}</td><td className="num">{pp(s.fact - s.plan)}</td>
                  <td className="num hide-sm">{s.ks ? rub(s.ks) : '—'}</td><td className="num hide-sm">{s.workers} / {s.machines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="contrH">
        <div className="sec-h"><h2 id="contrH">Договоры</h2></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Договор</th><th className="hide-sm">Срок</th><th className="num">Стоимость</th><th className="num hide-sm">Аванс</th><th className="num">КС по договору</th></tr></thead>
            <tbody>
              {contracts.length === 0 && <tr><td colSpan={5} className="empty-row">Договоров нет</td></tr>}
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><div className="addr">{c.no ?? 'без номера'}</div><div className="sub">от {fdate(c.date)}</div></td>
                  <td className="sub hide-sm">до {fdate(c.end)}</td>
                  <td className="num">{rub(c.cost)}</td><td className="num hide-sm">{rub(c.advance)}</td><td className="num">{rub(c.ks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
