// =====================================================================
//  «Капремонт МКД» → вкладка «Финансы» (vFin прежнего модуля).
//  Структура стоимости по группам работ / видам работ / разделам (?fin=type|section) ·
//  КС-2 подписаны, но не оплачены (сколько недель ждут) · КС-2 выше договора · ожидаемая экономия.
//  Фильтры — общие с остальными вкладками раздела.
// =====================================================================

import { Link, useSearchParams } from 'react-router';
import { useMkdFinance } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { nf, pct100, rub } from '../../utils/format.js';
import { MoneyBar, MONEY_SEGS } from './ui.jsx';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

const CUTS = [
  { id: 'group', name: 'По группам работ', col: 'Группа работ' },
  { id: 'type', name: 'По видам работ', col: 'Вид работ' },
  { id: 'section', name: 'По разделам', col: 'Раздел' },
];
const mlnN = (v) => nf((v || 0) / 1e6, 1);
const WAIT_ALERT = 4; // ждёт оплату дольше — отмечаем «!»

export default function MkdFinance({ meta, period }) {
  const [params, setParams] = useSearchParams();
  const filterState = useMkdFilters();
  const fin = useMkdFinance(period, filterState.filters);
  const cut = CUTS.find((c) => c.id === params.get('fin')) ?? CUTS[0];
  const setCut = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'group') next.delete('fin'); else next.set('fin', id);
    setParams(next, { replace: true });
  };
  const addrLink = (x) => <Link to={`/mkd/${x.objectId}${period ? `?period=${period}` : ''}`}>{x.address}</Link>;
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (fin.isPending) return <>{filterBar}<Loading text="Считаем финансы…" /></>;
  if (fin.isError) return <>{filterBar}<ErrorBox error={fin.error} onRetry={fin.refetch} /></>;
  const { structure, total: t, waiting, over, econ } = fin.data;
  if (!t.n) return <>{filterBar}<div className="card">Нет позиций под выбранные фильтры.</div></>;

  const rows = structure[cut.id];
  const maxC = Math.max(1, ...rows.map((r) => r.contract));
  const sum = (list, key) => list.reduce((a, x) => a + (x[key] || 0), 0);
  const paidPct = (r) => pct100(r.contract ? (r.paid / r.contract) * 100 : 0);

  return (
    <>
      {filterBar}

      <section className="card" aria-labelledby="stH">
        <div className="sec-h">
          <div>
            <h2 id="stH">Структура стоимости</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>Длина полосы — стоимость по договору; части — стадии денег</p>
          </div>
          <div className="chips" role="group" aria-label="Разрез">
            {CUTS.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={cut.id === c.id} onClick={() => setCut(c.id)}>{c.name}</button>)}
          </div>
        </div>
        <div className="legend-row">
          {MONEY_SEGS.map((s) => <span key={s.k}><i className="sw" style={{ background: s.color }} />{s.name}</span>)}
        </div>
        <div className="tbl-wrap flat" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{cut.col}</th><th className="num">Поз.</th><th style={{ minWidth: 180, width: '30%' }}>Стадии</th>
                <th className="num">Договор</th><th className="num">Оплачено</th><th className="num hide-sm">К оплате</th>
                <th className="num hide-sm">В работе</th><th className="num hide-md">Прогноз КС-2</th><th className="num">Экономия</th><th className="num">Оплачено, %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{r.n}</td>
                  <td><MoneyBar a={r} scale={maxC} /></td>
                  <td className="num">{mlnN(r.contract)}</td>
                  <td className="num">{mlnN(r.paid)}</td>
                  <td className="num hide-sm">{mlnN(r.topay)}</td>
                  <td className="num hide-sm">{mlnN(r.inwork)}</td>
                  <td className="num hide-md">{mlnN(r.forecast)}</td>
                  <td className="num">{mlnN(r.econ)}</td>
                  <td className="num">{paidPct(r)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Итого, млн ₽</td><td className="num">{t.n}</td><td />
                <td className="num">{mlnN(t.contract)}</td><td className="num">{mlnN(t.paid)}</td><td className="num hide-sm">{mlnN(t.topay)}</td>
                <td className="num hide-sm">{mlnN(t.inwork)}</td><td className="num hide-md">{mlnN(t.forecast)}</td><td className="num">{mlnN(t.econ)}</td><td className="num">{paidPct(t)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="waitH">
          <div className="sec-h"><h2 id="waitH">КС-2 подписаны, но не оплачены</h2></div>
          <p className="hint" style={{ marginTop: -6 }}>{waiting.length} позиций на {mlnN(sum(waiting, 'topay'))} млн ₽; сверху — дольше всех ждут оплату</p>
          <div className="tbl-wrap flat fin-list">
            <table className="data">
              <thead><tr><th>Адрес</th><th>Вид работ</th><th className="num">Сумма, ₽</th><th className="num">Ждёт, нед.</th></tr></thead>
              <tbody>
                {waiting.length === 0 && <tr><td colSpan={4} className="empty-row">Нет</td></tr>}
                {waiting.map((w) => (
                  <tr key={w.itemId}>
                    <td>{addrLink(w)}</td><td className="sub">{w.workType}</td><td className="num">{rub(w.topay)}</td>
                    <td className="num">{w.weeks ?? '—'}{(w.weeks ?? 0) >= WAIT_ALERT && <span className="warn-mark" title={`Дольше ${WAIT_ALERT} недель`}> !</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="overH">
          <div className="sec-h"><h2 id="overH">КС-2 выше договора</h2></div>
          <p className="hint" style={{ marginTop: -6 }}>{over.length} позиций, превышение {mlnN(over.reduce((a, x) => a + x.ks - x.contract, 0))} млн ₽ — проверить доп. соглашения</p>
          <div className="tbl-wrap flat fin-list">
            <table className="data">
              <thead><tr><th>Адрес</th><th>Вид работ</th><th className="num hide-sm">Договор</th><th className="num">КС-2</th><th className="num">Превышение</th></tr></thead>
              <tbody>
                {over.length === 0 && <tr><td colSpan={5} className="empty-row">Нет</td></tr>}
                {over.map((x) => (
                  <tr key={x.itemId}>
                    <td>{addrLink(x)}</td><td className="sub">{x.workType}</td><td className="num hide-sm">{rub(x.contract)}</td>
                    <td className="num">{rub(x.ks)}</td><td className="num bad-text">+{nf(x.excessPct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="econH">
        <div className="sec-h"><h2 id="econH">Ожидаемая экономия по работам в работе</h2></div>
        <p className="hint" style={{ marginTop: -6 }}>«В работе» минус «Примерно» (прогноз КС-2) — {econ.length} позиций, {mlnN(sum(econ, 'econ'))} млн ₽</p>
        <div className="tbl-wrap flat fin-list">
          <table className="data">
            <thead><tr><th>Адрес</th><th>Вид работ</th><th className="num hide-sm">В работе, ₽</th><th className="num hide-sm">Прогноз КС-2, ₽</th><th className="num">Экономия, ₽</th><th className="num">%</th></tr></thead>
            <tbody>
              {econ.length === 0 && <tr><td colSpan={6} className="empty-row">Нет</td></tr>}
              {econ.map((x) => (
                <tr key={x.itemId}>
                  <td>{addrLink(x)}</td><td className="sub">{x.workType}</td><td className="num hide-sm">{rub(x.inwork)}</td>
                  <td className="num hide-sm">{rub(x.forecast)}</td><td className="num">{rub(x.econ)}</td><td className="num">{pct100(x.econPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
