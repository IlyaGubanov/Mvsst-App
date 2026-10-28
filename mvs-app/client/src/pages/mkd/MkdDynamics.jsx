// =====================================================================
//  «Капремонт МКД» → вкладка «Динамика» (vDyn прежнего модуля).
//  S-кривая освоения с планом вперёд до окончания работ · прирост КС-2 и оплаты за период ·
//  физическая готовность (факт и план, с планом вперёд) · готовность по разделам и по группам работ ·
//  таблица по периодам. Фильтры — общие со «Сводкой» и «Матрицей».
// =====================================================================

import { useMkdDynamics } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import LineChart from '../../components/LineChart.jsx';
import ColumnChart from '../../components/ColumnChart.jsx';
import { fdate, fdm, nf, pct100, periodLabel } from '../../utils/format.js';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

// Цвета линий для разделов и групп работ (до 8, как в прежнем модуле)
const PALETTE = ['var(--accent)', 'var(--d-mkd)', 'var(--good)', 'var(--d-streets)', 'var(--warn)', 'var(--crit)', 'var(--d-networks)', 'var(--ink-2)'];
const mln0 = (v) => nf((v || 0) / 1e6, 0);
const mln1 = (v) => nf((v || 0) / 1e6, 1);
const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${mln1(Math.abs(v))}`);

export default function MkdDynamics({ meta, period }) {
  const filterState = useMkdFilters();
  const dyn = useMkdDynamics(period, filterState.filters);
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (dyn.isPending) return <>{filterBar}<Loading text="Считаем динамику…" /></>;
  if (dyn.isError) return <>{filterBar}<ErrorBox error={dyn.error} onRetry={dyn.refetch} /></>;
  const { series: S, future: F, maxEnd, bySection, byGroup } = dyn.data;
  if (!S.length) return <>{filterBar}<div className="card">Отчётных периодов ещё нет.</div></>;

  const marker = S.findIndex((x) => x.start === dyn.data.period.start);
  const labels = S.map((x) => fdm(x.start));
  const labelsAll = labels.concat(F.map((x) => fdm(x.start)));
  const pad = (arr) => arr.concat(F.map(() => null));         // история + пустые точки на будущие недели
  const inc = (arr) => arr.map((v, i) => (i === 0 ? 0 : Math.max(0, v - arr[i - 1]))); // прирост за период
  const pctFormat = (v) => `${Math.round(v)}%`;

  return (
    <>
      {filterBar}

      <section className="card" aria-labelledby="sH">
        <div className="sec-h"><h2 id="sH">S-кривая: план и факт освоения, млн ₽</h2></div>
        <p className="hint" style={{ marginTop: -6 }}>
          История периодов + план по графику до окончания работ ({fdate(maxEnd)}). Разрыв между пунктиром и линиями — отставание в деньгах.
        </p>
        <LineChart
          labels={labelsAll} marker={marker} height={300} title="S-кривая освоения" format={mln0} maxLabels={10}
          series={[
            { name: 'План по графику', color: 'var(--plan)', values: S.map((x) => x.plan).concat(F.map((x) => x.plan)), dash: true },
            { name: 'Выполнено физически', color: 'var(--d-mkd)', values: pad(S.map((x) => x.fact)) },
            { name: 'Закрыто КС-2', color: 'var(--accent)', values: pad(S.map((x) => x.ks)) },
            { name: 'Оплачено', color: 'var(--good)', values: pad(S.map((x) => x.paid)) },
          ]}
        />
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="incH">
          <div className="sec-h"><h2 id="incH">Прирост за период, млн ₽</h2><span className="hint">сколько КС-2 подписано и сколько оплачено</span></div>
          <ColumnChart
            labels={labels} title="Прирост за период" format={mln1}
            series={[
              { name: 'КС-2', color: 'var(--accent)', values: inc(S.map((x) => x.ks)) },
              { name: 'Оплата', color: 'var(--good)', values: inc(S.map((x) => x.paid)) },
            ]}
          />
        </section>
        <section className="card" aria-labelledby="pctH">
          <div className="sec-h"><h2 id="pctH">Физическая готовность, %</h2><span className="hint">взвешено по стоимости; пунктир — план</span></div>
          <LineChart
            labels={labelsAll} marker={marker} max={100} height={240} title="Физическая готовность" format={pctFormat}
            series={[
              { name: 'План', color: 'var(--plan)', values: S.map((x) => x.planPct).concat(F.map((x) => x.planPct)), dash: true },
              { name: 'Факт', color: 'var(--d-mkd)', values: pad(S.map((x) => x.pct)) },
            ]}
          />
        </section>
      </div>

      <div className="two-col">
        <section className="card" aria-labelledby="bsH">
          <div className="sec-h"><h2 id="bsH">Готовность по разделам, %</h2><span className="hint">факт по периодам</span></div>
          {bySection.length === 0 ? <p className="hint">Нет данных под фильтры</p> : (
            <LineChart labels={labels} max={100} height={240} title="Готовность по разделам" format={pctFormat}
              series={bySection.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length], values: s.values }))} />
          )}
        </section>
        <section className="card" aria-labelledby="bgH">
          <div className="sec-h"><h2 id="bgH">Готовность по группам работ, %</h2><span className="hint">факт по периодам</span></div>
          {byGroup.length === 0 ? <p className="hint">Нет данных под фильтры</p> : (
            <LineChart labels={labels} max={100} height={240} title="Готовность по группам работ" format={pctFormat}
              series={byGroup.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length], values: s.values }))} />
          )}
        </section>
      </div>

      <section aria-labelledby="tblH">
        <div className="sec-h"><h2 id="tblH">Таблица по периодам</h2><span className="hint">сначала новые</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Период</th><th className="num">Готовность</th><th className="num">План</th>
                <th className="num">Закрыто КС-2, млн</th><th className="num">Оплачено, млн</th><th className="num hide-sm">К оплате, млн</th>
                <th className="num">Δ КС-2</th><th className="num">Δ оплата</th>
              </tr>
            </thead>
            <tbody>
              {S.map((x, i) => ({ x, i })).reverse().map(({ x, i }) => (
                <tr key={x.start} className={i === marker ? 'cur' : ''}>
                  <td>{periodLabel(x)}{x.isLegacy && <span className="sub"> · неделя</span>}</td>
                  <td className="num">{pct100(x.pct)}</td>
                  <td className="num">{pct100(x.planPct)}</td>
                  <td className="num">{mln1(x.ks)}</td>
                  <td className="num">{mln1(x.paid)}</td>
                  <td className="num hide-sm">{mln1(x.topay)}</td>
                  <td className="num">{i ? signed(x.ks - S[i - 1].ks) : '—'}</td>
                  <td className="num">{i ? signed(x.paid - S[i - 1].paid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
