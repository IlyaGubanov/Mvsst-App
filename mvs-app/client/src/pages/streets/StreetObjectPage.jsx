// =====================================================================
//  Карточка объекта благоустройства: сведения и местоположение, итоги последнего отчёта,
//  объёмы по видам работ, график и таблица истории по всем отчётам программы.
// =====================================================================

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useStreetObject, useStreetsMeta } from '../../api/streets.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import DynamicsChart from '../../components/DynamicsChart.jsx';
import { fdate, fdm, pct } from '../../utils/format.js';
import { StStatus, vol } from './ui.jsx';

const SHOW_ROWS = 20; // сколько последних отчётов показывать в таблице истории сразу
const ms = (iso) => Date.parse(`${iso}T00:00:00`);

export default function StreetObjectPage() {
  const { objectId } = useParams();
  const meta = useStreetsMeta();
  const card = useStreetObject(objectId);
  const [programIdx, setProgramIdx] = useState(0);
  const [all, setAll] = useState(false);

  if (meta.isPending || card.isPending) return <Loading text="Загружаем объект…" />;
  if (card.isError) return <ErrorBox error={card.error} onRetry={card.refetch} title={card.error.status === 404 ? 'Объект не найден' : undefined} />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;

  const { object: o, histories } = card.data;
  const h = histories[programIdx] ?? histories[0];
  const series = h?.series ?? [];
  const last = series.at(-1);
  const works = meta.data.works.filter((w) => last?.works[w.id]);
  // Куда вносить: последний открытый ручной отчёт программы, где есть объект
  const openManual = h && meta.data.programs.find((p) => p.code === h.program)?.reports.find((r) => r.source === 'manual' && !r.isClosed);
  const osm = o.lat != null ? `https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lon}#map=17/${o.lat}/${o.lon}` : null;
  const rows = [...series].reverse();
  const shown = all ? rows : rows.slice(0, SHOW_ROWS);

  return (
    <div className="page sect st">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Сводка</Link><span>/</span><Link to={`/streets${h?.program === 'current' ? '?program=current' : ''}`}>Благоустройство улиц</Link><span>/</span><span>{o.short}</span>
      </nav>

      <div className="head">
        <div>
          <h1>{o.short}</h1>
          <p className="lead">{o.name !== o.short ? `${o.name} · ` : ''}{o.okrug ?? 'округ не указан'}{o.archived ? ' · в архиве' : ''}</p>
        </div>
        <div className="toolbar">
          {histories.length > 1 && (
            <select className="tb-select" value={programIdx} onChange={(e) => setProgramIdx(Number(e.target.value))} aria-label="Программа">
              {histories.map((x, i) => <option key={x.program} value={i}>{x.name}</option>)}
            </select>
          )}
          {o.canEdit && openManual && <Link className="btn primary" to={`/streets/input?report=${openManual.id}&object=${o.id}`}>Внести данные</Link>}
        </div>
      </div>

      <section className="card info-grid" aria-label="Сведения об объекте">
        <div><span>Программа</span>{h?.name ?? '—'}</div>
        <div><span>Местоположение</span>{osm ? <a href={osm} target="_blank" rel="noreferrer">открыть на карте ↗</a> : 'уточняется'}{o.geoPrecision ? <div className="sub">{o.geoPrecision}</div> : null}</div>
        <div><span>Ответственные за ввод</span>{o.responsible.length ? o.responsible.join(', ') : 'не назначены'}</div>
        <div><span>Отчётов с объектом</span>{series.length}{series.length ? ` · с ${fdate(series[0].date)}` : ''}</div>
      </section>

      {last && (
        <section className="tiles" aria-label="Последний отчёт">
          <div className="tile"><span className="l">Статус на {fdate(last.date)}</span><span className="v"><StStatus status={last.status} complete={last.complete > 0} /></span><span className="s">последний отчёт</span></div>
          <div className="tile"><span className="l">Позиций выполнено</span><span className="v">{pct(last.rate)}</span><span className="s">{last.done} из {last.positions}</span></div>
          <div className="tile"><span className="l">Замечания</span><span className={'v' + (last.remarks ? ' crit' : '')}>{last.remarks ?? '—'}</span><span className="s">в последнем отчёте</span></div>
          <div className="tile"><span className="l">Люди / техника</span><span className="v">{last.people ?? '—'} / {last.tech ?? '—'}</span><span className="s">{last.people == null ? 'не указаны' : 'на объекте'}</span></div>
        </section>
      )}

      <section aria-labelledby="wkH">
        <div className="sec-h"><h2 id="wkH">Объёмы работ</h2><span className="hint">{last ? `по отчёту ${fdate(last.date)}` : ''}</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Вид работ</th><th className="num">Проект</th><th className="num">Факт</th><th className="num hide-sm">Остаток</th><th>Выполнение</th></tr></thead>
            <tbody>
              {works.length === 0 && <tr><td colSpan={5} className="empty-row">Проектных объёмов нет</td></tr>}
              {works.map((w) => {
                const v = last.works[w.id];
                const rate = v.p > 0 ? Math.min(1, (v.f ?? 0) / v.p) : null;
                return (
                  <tr key={w.id}>
                    <td><div className="addr">{w.name}</div><div className="sub">{w.unit ?? 'ед. не указана'}</div></td>
                    <td className="num">{vol(v.p)}</td>
                    <td className="num">{vol(v.f)}</td>
                    <td className="num hide-sm">{vol(Math.max(0, (v.p ?? 0) - (v.f ?? 0)))}</td>
                    <td><div className="prog"><ProgressBar pct={(rate ?? 0) * 100} /><span>{pct(rate)}</span></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {series.length > 1 && (
        <section className="card" aria-labelledby="dyH">
          <div className="sec-h"><h2 id="dyH">Динамика</h2><span className="hint">доля выполненных позиций по отчётам</span></div>
          <DynamicsChart points={series.map((s) => ({ t: ms(s.date), label: fdm(s.date), fact: s.rate, plan: null }))} title={`Динамика: ${o.short}`} maxLabels={9} />
        </section>
      )}

      <section aria-labelledby="hsH">
        <div className="sec-h"><h2 id="hsH">История по отчётам</h2><span className="hint">сначала новые</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Отчёт</th><th>Статус</th><th className="num">Позиции</th><th className="num">Замечания</th><th className="num hide-sm">Люди / техн.</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.reportId}>
                  <td>{fdate(s.date)}{s.source === 'manual' && <span className="sub"> · вручную</span>}</td>
                  <td>{s.status ?? '—'}</td>
                  <td className="num">{s.done} из {s.positions}</td>
                  <td className="num">{s.remarks ?? '—'}</td>
                  <td className="num hide-sm">{s.people ?? '—'} / {s.tech ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > SHOW_ROWS && (
          <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>{all ? 'Свернуть' : `Показать все ${rows.length}`}</button>
        )}
      </section>
    </div>
  );
}
