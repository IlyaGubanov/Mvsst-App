// =====================================================================
//  «Капремонт МКД» → вкладка «Сводка» (как экран «Сводка» прежнего модуля mkd.html).
//  Блоки: готовность и итоги денег · куда ушли деньги договора · освоение нарастающим итогом ·
//  позиции по статусу и светофор · разделы · наибольшее отставание · что изменилось за период.
//  Фильтры (раздел, группа работ, сотрудник, поиск) — общие с «Матрицей», см. MkdFilters.jsx.
// =====================================================================

import { Link, useSearchParams } from 'react-router';
import { useMkdSummary } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import DynamicsChart from '../../components/DynamicsChart.jsx';
import LineChart from '../../components/LineChart.jsx';
import { fdm, nf, pct100, periodLabel, plural } from '../../utils/format.js';
import { ProgressBar, RiskPill, RISK, STATUS } from './ui.jsx';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

// Деньги договора по стадиям (MONEY_SEGS прежнего модуля)
const MONEY_SEGS = [
  { k: 'paid', name: 'Оплачено', color: STATUS.paid.color },
  { k: 'topay', name: 'КС-2 подписаны, к оплате', color: STATUS.ks.color },
  { k: 'openForecast', name: 'В работе (прогноз КС-2)', color: STATUS.work.color },
  { k: 'econ', name: 'Экономия / снято с договора', color: 'var(--surface-3)' },
];
const STATUS_FULL = { ...Object.fromEntries(Object.entries(STATUS).map(([k, s]) => [k, s.name])), ks: 'КС-2 подписаны, к оплате' };

const mlnN = (v) => nf((v || 0) / 1e6, 1);              // «1 729,1» — миллионы без подписи
const ppText = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf(Math.abs(v), 1)} п.п.`);

/** Изменение к прошлому периоду: «▲ +2,5 п.п.», «▲ +12,3 млн», «без изменений». good — рост это хорошо. */
function Delta({ v, unit }) {
  if (v == null) return <span>—</span>;
  if (Math.abs(v) < (unit === 'pp' ? 0.5 : 5e4)) return <span className="hint">без изменений</span>;
  const text = unit === 'pp' ? ppText(v) : `${v > 0 ? '+' : '−'}${mlnN(Math.abs(v))} млн`;
  return <span className={v > 0 ? 'delta-up' : 'delta-down'}>{v > 0 ? '▲' : '▼'} {text}</span>;
}

/** Полоса «куда ушли деньги»: оплачено / к оплате / в работе / экономия. scale — максимум для сравнения строк. */
function MoneyBar({ a, scale, big }) {
  const vals = { paid: a.paid, topay: a.topay, openForecast: a.openForecast, econ: Math.max(0, a.econ) };
  const used = vals.paid + vals.topay + vals.openForecast + vals.econ;
  const tot = scale || Math.max(a.contract, used) || 1;
  const tip = MONEY_SEGS.map((s) => `${s.name}: ${mlnN(vals[s.k])} млн ₽`).concat(`Договор: ${mlnN(a.contract)} млн ₽`).join('\n');
  return (
    <div className={'money-bar' + (big ? ' big' : '')} style={{ width: `${Math.min(100, (used / tot) * 100)}%` }} title={tip}>
      {MONEY_SEGS.map((s) => (vals[s.k] > 0 ? <i key={s.k} style={{ flex: `${vals[s.k]} 1 0`, background: s.color }} /> : null))}
    </div>
  );
}

export default function MkdSummary({ meta, period }) {
  const [params] = useSearchParams();
  const filterState = useMkdFilters();
  const sum = useMkdSummary(period, filterState.filters);
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (sum.isPending) return <>{filterBar}<Loading text="Считаем сводку…" /></>;
  if (sum.isError) return <>{filterBar}<ErrorBox error={sum.error} onRetry={sum.refetch} /></>;
  const s = sum.data;
  const a = s.total;
  const b = s.prevTotal;
  if (!a.n) return <>{filterBar}<div className="card">Нет позиций под выбранные фильтры.</div></>;

  const periodIdx = s.series.findIndex((x) => x.start === s.period.start);
  const labels = s.series.map((x) => fdm(x.start));
  const share = (v) => pct100(a.contract ? (v / a.contract) * 100 : 0);
  const maxSection = Math.max(1, ...s.sections.map((r) => r.contract));
  const statusN = Object.fromEntries(s.statuses.map((x) => [x.code, x.n]));
  const inWorkN = (statusN.work || 0) + (statusN.stop || 0) + (statusN.plan || 0);

  return (
    <>
      {filterBar}

      <section className="mkd-hero" aria-label="Итоги">
        <div className="card hero">
          <div className="l">Физическая готовность (взвешено по стоимости)</div>
          <div className="big">{pct100(a.pct, 1)}</div>
          <div className="hint">план на дату {pct100(a.plan, 1)} · <RiskPill risk={a.risk} lag={a.lag} /></div>
          <DynamicsChart points={s.series.map((x) => ({ label: fdm(x.start), fact: x.pct / 100, plan: x.planPct == null ? null : x.planPct / 100 }))} title="Готовность по периодам" maxLabels={5} />
          <ProgressBar pct={a.pct} plan={a.plan} />
          <div className="hint">за период <Delta v={b ? a.pct - b.pct : null} unit="pp" /> · срез {periodLabel(s.period)}</div>
        </div>
        <div className="kpi-grid">
          <div className="tile"><span className="l">Стоимость по договору</span><span className="v">{mlnN(a.contract)} <small>млн ₽</small></span><span className="s">{a.n} позиций · {s.objects} {plural(s.objects, 'адрес', 'адреса', 'адресов')}</span>{s.docContract != null && <span className="s">итог в таблице — {mlnN(s.docContract)} млн (до исключений)</span>}</div>
          <div className="tile"><span className="l">Закрыто КС-2</span><span className="v">{mlnN(a.ks)} <small>млн ₽</small></span><span className="s">{share(a.ks)} договора · за период <Delta v={b ? a.ks - b.ks : null} unit="m" /></span></div>
          <div className="tile"><span className="l">Оплачено</span><span className="v">{mlnN(a.paid)} <small>млн ₽</small></span><span className="s">{share(a.paid)} договора · за период <Delta v={b ? a.paid - b.paid : null} unit="m" /></span></div>
          <div className="tile"><span className="l">К оплате (КС-2 подписаны)</span><span className="v">{mlnN(a.topay)} <small>млн ₽</small></span><span className="s">{statusN.ks || 0} {plural(statusN.ks || 0, 'позиция ждёт', 'позиции ждут', 'позиций ждут')} оплаты</span></div>
          <div className="tile"><span className="l">В работе</span><span className="v">{mlnN(a.inwork)} <small>млн ₽</small></span><span className="s">прогноз закрытия ≈ {mlnN(a.openForecast)} млн · {inWorkN} позиций</span></div>
          <div className="tile"><span className="l">Риски</span><span className="v crit">{s.objRisk.crit} <small>критично</small> {s.objRisk.warn} <small>отстают</small></span><span className="s">адресов из {s.objects} · просрочено позиций: <b>{a.overdue}</b></span></div>
        </div>
      </section>

      <section className="card" aria-labelledby="moneyH">
        <div className="sec-h"><h2 id="moneyH">Куда ушли деньги договора</h2><span className="hint">вся стоимость {mlnN(a.contract)} млн ₽ по стадиям; экономия — договор минус факт и прогноз КС-2</span></div>
        <MoneyBar a={a} big />
        <div className="legend-row" style={{ marginTop: 10 }}>
          {MONEY_SEGS.map((m) => {
            const v = m.k === 'econ' ? Math.max(0, a.econ) : a[m.k];
            return <span key={m.k}><i className="sw" style={{ background: m.color }} />{m.name}: <b>{mlnN(v)}</b> млн ({share(v)})</span>;
          })}
        </div>
      </section>

      <div className="split">
        <section className="card" aria-labelledby="flowH">
          <div className="sec-h"><h2 id="flowH">Освоение нарастающим итогом, млн ₽</h2></div>
          <p className="hint" style={{ marginTop: -6 }}>Пунктир — план по графику работ (прогнозная стоимость × плановая готовность на дату)</p>
          <LineChart
            labels={labels} marker={periodIdx} title="Освоение нарастающим итогом"
            format={(v) => nf(v / 1e6, 0)}
            series={[
              { name: 'План по графику', color: 'var(--plan)', values: s.series.map((x) => x.plan), dash: true },
              { name: 'Выполнено физически', color: 'var(--d-mkd)', values: s.series.map((x) => x.fact) },
              { name: 'Закрыто КС-2', color: 'var(--accent)', values: s.series.map((x) => x.ks) },
              { name: 'Оплачено', color: 'var(--good)', values: s.series.map((x) => x.paid) },
            ]}
          />
        </section>
        <section className="card" aria-labelledby="stH">
          <div className="sec-h"><h2 id="stH">Позиции по статусу</h2><span className="hint">{a.n} позиций (вид работ × адрес)</span></div>
          <div className="money-bar big" style={{ margin: '4px 0 10px' }}>
            {s.statuses.map((x) => <i key={x.code} style={{ flex: `${x.n} 1 0`, background: STATUS[x.code].color }} title={`${STATUS_FULL[x.code]}: ${x.n}`} />)}
          </div>
          <table className="data compact">
            <tbody>
              {s.statuses.map((x) => (
                <tr key={x.code}>
                  <td><i className="sw" style={{ background: STATUS[x.code].color }} />{STATUS_FULL[x.code]}</td>
                  <td className="num">{x.n}</td><td className="num sub">{pct100((x.n / a.n) * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sec-h" style={{ marginTop: 16 }}><h2>Светофор объектов</h2></div>
          <p className="hint" style={{ marginTop: -6 }}>По отклонению факта от плана на дату; пороги {meta.thresholds.warn} / {meta.thresholds.crit} п.п.</p>
          <div className="chips">
            {['crit', 'warn', 'ok', 'na'].filter((r) => s.objRisk[r]).map((r) => (
              <span key={r} className={`pill ${RISK[r].tone}`}>{RISK[r].name} · {s.objRisk[r]}</span>
            ))}
          </div>
        </section>
      </div>

      <div className="split">
        <section className="card" aria-labelledby="secH">
          <div className="sec-h"><h2 id="secH">Разделы</h2><span className="hint">стоимость и стадии денег; готовность — факт / план</span></div>
          <div className="tbl-wrap flat">
            <table className="data">
              <thead><tr><th>Раздел</th><th className="num">Адресов</th><th className="num">Договор, млн</th><th style={{ minWidth: 100 }}>Деньги</th><th>Готовность</th><th>Статус</th></tr></thead>
              <tbody>
                {s.sections.map((r) => (
                  <tr key={r.id ?? 'none'}>
                    <td>{r.name}</td>
                    <td className="num">{r.objects}</td>
                    <td className="num">{mlnN(r.contract)}</td>
                    <td><MoneyBar a={r} scale={maxSection} /></td>
                    <td><div className="prog"><ProgressBar pct={r.pct} plan={r.plan} /><span>{pct100(r.pct)} / {pct100(r.plan)}</span></div></td>
                    <td><RiskPill risk={r.risk} lag={r.lag} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="worstH">
          <div className="sec-h"><h2 id="worstH">Наибольшее отставание от графика</h2><span className="hint">риска на полосе — план</span></div>
          <div className="rank">
            {s.worst.map((o) => (
              <Link key={o.id} to={`/mkd/${o.id}${params.get('period') ? `?period=${params.get('period')}` : ''}`} title={o.address}>
                <span className="nm">{o.address}</span>
                <ProgressBar pct={o.pct} plan={o.plan} />
                <span className={'num' + (o.risk === 'crit' ? ' bad' : '')}>{ppText(o.lag)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="chH">
        <div className="sec-h">
          <h2 id="chH">Что изменилось за период</h2>
          <span className="hint">{s.prevPeriod ? `${periodLabel(s.prevPeriod)} → ${periodLabel(s.period)}` : 'нет предыдущего периода для сравнения'}</span>
        </div>
        <div className="sum-line">
          <span>Оплачено: <b>+{mlnN(s.changes.dPaid)} млн</b> ({s.changes.nPaid} поз.)</span>
          <span>Подписано КС-2: <b>+{mlnN(s.changes.dKs)} млн</b> ({s.changes.nKs} поз.)</span>
          <span>Готовность: <b>{ppText(s.changes.dPct)}</b></span>
          <span>Событий: <b>{s.changes.events.length}</b></span>
        </div>
        <ul className="events">
          {s.changes.events.length === 0 && <li className="hint">Изменений нет</li>}
          {s.changes.events.slice(0, 80).map((e, i) => (
            <li key={i}>
              <span className="w">{e.workType}</span>
              <span>
                <Link to={`/mkd/${e.objectId}`}>{e.address}</Link> — {' '}
                {e.kind === 'status' && <>{STATUS[e.from]?.short ?? STATUS[e.from]?.name} → <b>{STATUS[e.to]?.short ?? STATUS[e.to]?.name}</b>{e.paid ? ` · оплачено ${mlnN(e.paid)} млн` : e.ks ? ` · КС-2 ${mlnN(e.ks)} млн` : ''}</>}
                {e.kind === 'pct' && <>готовность {pct100(e.from)} → <b>{pct100(e.to)}</b></>}
                {e.kind === 'note' && <>комментарий: «{e.note}»</>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
