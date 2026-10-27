// =====================================================================
//  «Сети, коллекторы, водные объекты» — реестр объектов на отчётный период.
//  Сверху — итоги и карточки разделов (клик — фильтр), ниже — таблица (на телефоне — карточки).
// =====================================================================

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useNetMeta, useNetObjects, useToggleNetPeriod } from '../../api/networks.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { PeriodSelect, ProgressBar } from '../../components/Period.jsx';
import { fdate, mln, moneyShortRu, nf, pct, periodLabel, plural, pp } from '../../utils/format.js';
import { NetStatus, NET_STATUS, NET_STATUS_ORDER } from './ui.jsx';

const SORTS = {
  dev: { name: 'по отставанию', fn: (a, b) => a.dev - b.dev },
  seq: { name: 'по номеру', fn: (a, b) => (a.seqNo ?? 1e9) - (b.seqNo ?? 1e9) || a.id - b.id },
  name: { name: 'по названию', fn: (a, b) => a.short.localeCompare(b.short, 'ru') },
  cost: { name: 'по стоимости', fn: (a, b) => b.cost - a.cost },
  end: { name: 'по сроку окончания', fn: (a, b) => (a.end ?? '9').localeCompare(b.end ?? '9') },
};

export default function NetRegistryPage() {
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || undefined;
  const navigate = useNavigate();
  const meta = useNetMeta();
  const registry = useNetObjects(period);
  const toggle = useToggleNetPeriod();

  const [section, setSection] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState('dev');

  const objects = registry.data?.objects;
  const list = useMemo(() => {
    if (!objects) return [];
    const needle = q.trim().toLowerCase();
    return objects
      .filter((o) => section === 'all' || String(o.sectionId) === section)
      .filter((o) => status === 'all' || o.status === status)
      .filter((o) => !onlyMine || o.canEdit)
      .filter((o) => !needle || [o.name, o.sub, o.curator, ...o.responsible].some((s) => s?.toLowerCase().includes(needle)))
      .sort(SORTS[sort].fn);
  }, [objects, section, status, q, onlyMine, sort]);

  if (meta.isPending || registry.isPending) return <Loading text="Загружаем реестр объектов…" />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (registry.isError) return <ErrorBox error={registry.error} onRetry={registry.refetch} />;

  const m = meta.data;
  const { total, sections, period: p } = registry.data;
  const canEnter = m.canEditAll || m.myObjectIds.length > 0;
  const setPeriod = (v) => setParams(v === m.periods[0]?.start ? {} : { period: v }, { replace: true });
  const statusCount = (s) => objects.filter((o) => (section === 'all' || String(o.sectionId) === section) && o.status === s).length;
  const href = (o) => `/networks/${o.id}${period ? `?period=${period}` : ''}`;
  const sum = (key) => list.reduce((a, o) => a + (o[key] || 0), 0);

  return (
    <div className="page sect net registry">
      <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><span>Сети и водные объекты</span></nav>

      <div className="head">
        <div>
          <h1>Сети, коллекторы, водные объекты</h1>
          <p className="lead">
            {objects.length} {plural(objects.length, 'объект', 'объекта', 'объектов')} в {sections.length} разделах · период {periodLabel(p)}{p.isClosed ? ' (закрыт)' : ''}
          </p>
        </div>
        <div className="toolbar">
          <PeriodSelect periods={m.periods} value={p.start} onChange={setPeriod} />
          {m.isAdmin && (
            <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate({ period: p.start, close: !p.isClosed })}>
              {p.isClosed ? 'Открыть период' : 'Закрыть период'}
            </button>
          )}
          {canEnter && <Link className="btn primary" to="/networks/input">Внести данные</Link>}
        </div>
      </div>

      <section className="tiles" aria-label="Итоги по направлению">
        <div className="tile"><span className="l">Выполнение</span><span className="v">{pct(total.fact)}</span><span className="s">план {pct(total.plan)} · {pp(total.fact - total.plan)}</span></div>
        <div className="tile"><span className="l">Отстают от графика</span><span className={'v' + (total.critical ? ' crit' : '')}>{nf(total.lagging)}</span><span className="s">критично {nf(total.critical)} · выполнено {nf(total.statuses.done)}</span></div>
        <div className="tile"><span className="l">Договоры</span><span className="v">{moneyShortRu(total.cost)}</span><span className="s">аванс {moneyShortRu(total.adv)}</span></div>
        <div className="tile"><span className="l">Закрыто КС</span><span className="v">{moneyShortRu(total.ks)}</span><span className="s">{pct(total.cost ? total.ks / total.cost : 0)} договоров</span></div>
        <div className="tile"><span className="l">Люди / техника</span><span className="v">{nf(total.workers)} / {nf(total.machines)}</span><span className="s">на объектах за период</span></div>
        <div className="tile"><span className="l">Проложено и отремонтировано</span><span className="v">{nf(total.pmLen)} п.м</span><span className="s">сети и коллекторы</span></div>
      </section>

      <section className="secs" aria-label="Разделы">
        {sections.map((s) => (
          <button key={s.id} type="button" className="sec-card" aria-pressed={section === String(s.id)} onClick={() => setSection(section === String(s.id) ? 'all' : String(s.id))} title={s.title}>
            <b>{s.short}</b>
            <ProgressBar pct={s.fact * 100} plan={s.plan * 100} />
            <span className="nums"><span>{pct(s.fact)} · план {pct(s.plan)}</span><span>{s.n} об.</span></span>
            <span className="nums"><span className={s.lagging ? 'bad' : ''}>отстают {s.lagging}</span><span>{moneyShortRu(s.cost)}</span></span>
          </button>
        ))}
      </section>

      <section className="toolbar" aria-label="Фильтры">
        <div className="chips">
          <button type="button" className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>Любой статус</button>
          {NET_STATUS_ORDER.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{NET_STATUS[s].name} · {statusCount(s)}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Объект, подрядчик, куратор…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        {!m.canEditAll && m.myObjectIds.length > 0 && (
          <label className="check"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />Только мои объекты</label>
        )}
        <span className="grow" />
        <select className="tb-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Сортировка {s.name}</option>)}
        </select>
      </section>

      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>№</th><th>Объект</th><th>Статус</th><th>Выполнение</th>
              <th className="num">Договоры</th><th className="num">Закрыто КС</th><th className="num">Люди / техн.</th>
              <th>Окончание</th><th>Ответственный</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="empty-row">Под условия фильтра объектов нет</td></tr>}
            {list.map((o) => (
              <tr key={o.id} className="link" onClick={() => navigate(href(o))}>
                <td className="sub">{o.seqNo ?? '—'}</td>
                <td>
                  <Link className="addr" to={href(o)} onClick={(e) => e.stopPropagation()}>{o.short}</Link>
                  {o.canEdit && !m.canEditAll && <span className="mine">мой</span>}
                  <div className="sub">{o.section}{o.sub ? ` · ${o.sub}` : ''}</div>
                </td>
                <td><NetStatus status={o.status} dev={o.dev} /></td>
                <td><div className="prog"><ProgressBar pct={o.fact * 100} plan={o.plan * 100} /><span>{pct(o.fact)} · план {pct(o.plan)}</span></div></td>
                <td className="num">{mln(o.cost)}</td>
                <td className="num">{o.ks ? mln(o.ks) : '—'}</td>
                <td className="num">{o.workers || o.machines ? `${o.workers} / ${o.machines}` : '—'}</td>
                <td className="sub">{fdate(o.end)}</td>
                <td>{o.responsible.join(', ') || <span className="sub">не назначен</span>}</td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Итого по выборке: {list.length} {plural(list.length, 'объект', 'объекта', 'объектов')}</td>
                <td className="num">{mln(sum('cost'))}</td><td className="num">{mln(sum('ks'))}</td>
                <td className="num">{sum('workers')} / {sum('machines')}</td><td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="cards">
        {list.length === 0 && <div className="empty-row">Под условия фильтра объектов нет</div>}
        {list.map((o) => (
          <Link key={o.id} className="ocard" to={href(o)}>
            <div className="top">
              <div>
                <div className="addr">{o.short}{o.canEdit && !m.canEditAll && <span className="mine"> · мой</span>}</div>
                <div className="meta">{o.section} · до {fdate(o.end)}</div>
              </div>
              <NetStatus status={o.status} dev={o.dev} />
            </div>
            <ProgressBar pct={o.fact * 100} plan={o.plan * 100} />
            <div className="nums">
              <span>Выполнение<b>{pct(o.fact)} / {pct(o.plan)}</b></span>
              <span>Договоры<b>{mln(o.cost)}</b></span>
              <span>Люди / техн.<b>{o.workers} / {o.machines}</b></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
