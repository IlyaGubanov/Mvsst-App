// =====================================================================
//  «Сводка» — главная страница: все направления, доступные пользователю, на выбранную дату.
//  Дата хранится в адресе (/?date=2026-10-27) — такой ссылкой можно поделиться.
// =====================================================================

import { useSearchParams } from 'react-router';
import { useOverview } from '../../api/overview.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { fdate, fdm, nf, plural, pp, todayIso } from '../../utils/format.js';
import { directionUi } from '../../directions.js';
import { totals, worstDirection } from './model.js';
import Totals from './Totals.jsx';
import DirectionCard from './DirectionCard.jsx';
import AttentionCard from './AttentionCard.jsx';
import MoneyCard from './MoneyCard.jsx';
import RemarksCard from './RemarksCard.jsx';

export default function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const date = params.get('date') || today;
  const overview = useOverview(date);

  const setDate = (value) => {
    if (!value || value === today) setParams({}, { replace: true });
    else setParams({ date: value }, { replace: true });
  };

  if (overview.isPending) return <Loading text="Собираем сводку…" />;
  if (overview.isError) return <ErrorBox error={overview.error} onRetry={overview.refetch} />;

  const dirs = overview.data.directions;
  if (!dirs.length) {
    return (
      <div className="page">
        <div className="error-box"><h2>Направления не открыты</h2><p>Вам пока не открыто ни одно направление. Обратитесь к администратору.</p></div>
      </div>
    );
  }

  const T = totals(dirs);
  const worst = worstDirection(dirs);
  const worstGap = worst ? worst.kpi.fact - worst.kpi.plan : 0;
  const lead = T.schedObjects
    ? `Отстают от графика ${nf(T.lag)} ${plural(T.lag, 'объект', 'объекта', 'объектов')} из ${nf(T.schedObjects)}, критично — ${nf(T.crit)}.`
      + (worst && worstGap < -0.02 ? ` Наибольшее отставание по направлению «${directionUi(worst.code).name}»: ${pp(worstGap)} к плану.` : '')
    : 'По открытым вам направлениям графика нет.';

  const dates = dirs.map((d) => d.kpi?.asOf).filter(Boolean).sort();
  const span = dates.length ? (dates[0] === dates.at(-1) ? fdate(dates[0]) : `${fdm(dates[0])}–${fdate(dates.at(-1))}`) : '—';

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Производственная сводка</h1>
          <p className="lead">{lead}</p>
        </div>
        <div className="stamp">
          <div className="date-pick">
            <label htmlFor="ovDate">Срез на</label>
            <input id="ovDate" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            {date !== today && <button type="button" className="btn" onClick={() => setDate(today)}>Сегодня</button>}
          </div>
          <span>Данные направлений: {span}{overview.isFetching ? ' · обновляется…' : ''}</span>
        </div>
      </div>

      <Totals T={T} directionsCount={dirs.length} />

      <section aria-labelledby="dirsH">
        <div className="sec-h">
          <h2 id="dirsH">Направления</h2>
          <span className="hint">Факт против плана на дату · чёрная отметка — план</span>
        </div>
        <div className="dirs">
          {dirs.map((d) => <DirectionCard key={d.code} dir={d} />)}
        </div>
      </section>

      <div className="split">
        <AttentionCard dirs={dirs} />
        <div className="stack">
          <MoneyCard dirs={dirs} />
          <RemarksCard dirs={dirs} />
        </div>
      </div>

      <section className="notes" aria-label="Как считается сводка">
        <div><b>Откуда цифры.</b><p>Показатели считает сервер по правилам каждого направления — тем же, что в прежних дашбордах. Сводка показывает их итог на выбранную дату.</p></div>
        <div><b>Где хранятся данные.</b><p>В общей базе организации. Изменения, внесённые ответственными, сразу видят все, кому открыто направление.</p></div>
        <div><b>Готовность.</b><p>Школы — веса видов работ «Светофора»; МКД и сети — взвешено по стоимости; благоустройство — доля позиций, где факт достиг проекта (графика в отчёте нет).</p></div>
      </section>
    </div>
  );
}
