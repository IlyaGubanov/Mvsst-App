// =====================================================================
//  «Капремонт МКД» — реестр адресов на отчётный период.
//  Фильтры: лот, риск, поиск по адресу/ответственному, «только мои». Сортировка — по отставанию и др.
//  Период хранится в адресе (/mkd?period=2026-10-19) — такой ссылкой можно поделиться.
// =====================================================================

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMkdMeta, useMkdObjects, useTogglePeriod } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { mln, nf, pct100, periodLabel, plural } from '../../utils/format.js';
import { PeriodSelect, ProgressBar, RiskPill, RISK } from './ui.jsx';

const SORTS = {
  lag: { name: 'по отставанию', fn: (a, b) => (a.lag ?? 1e9) - (b.lag ?? 1e9) },
  addr: { name: 'по адресу', fn: (a, b) => a.address.localeCompare(b.address, 'ru') },
  contract: { name: 'по стоимости', fn: (a, b) => b.contract - a.contract },
  topay: { name: 'по сумме к оплате', fn: (a, b) => b.topay - a.topay },
};

export default function MkdRegistryPage() {
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || undefined;
  const navigate = useNavigate();
  const meta = useMkdMeta();
  const registry = useMkdObjects(period);
  const toggle = useTogglePeriod();

  const [section, setSection] = useState('all');
  const [risk, setRisk] = useState('all');
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState('lag');

  const objects = registry.data?.objects;
  const list = useMemo(() => {
    if (!objects) return [];
    const needle = q.trim().toLowerCase();
    return objects
      .filter((o) => section === 'all' || String(o.sectionId) === section)
      .filter((o) => risk === 'all' || o.risk === risk)
      .filter((o) => !onlyMine || o.canEdit)
      .filter((o) => !needle || o.address.toLowerCase().includes(needle) || o.responsible.some((r) => r.toLowerCase().includes(needle)))
      .sort(SORTS[sort].fn);
  }, [objects, section, risk, q, onlyMine, sort]);

  if (meta.isPending || registry.isPending) return <Loading text="Загружаем реестр адресов…" />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (registry.isError) return <ErrorBox error={registry.error} onRetry={registry.refetch} />;

  const m = meta.data;
  const { total, period: p } = registry.data;
  const sectionName = Object.fromEntries(m.sections.map((s) => [s.id, s.name]));
  const canEnter = m.canEditAll || m.myObjectIds.length > 0;
  const setPeriod = (v) => setParams(v === m.periods[0]?.start ? {} : { period: v }, { replace: true });
  const sum = (key) => list.reduce((a, o) => a + (o[key] || 0), 0);
  const riskCount = (r) => objects.filter((o) => o.risk === r).length;
  const openObject = (o) => navigate(`/mkd/${o.id}${period ? `?period=${period}` : ''}`);

  return (
    <div className="page sect mkd registry">
      <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><span>Капремонт МКД</span></nav>

      <div className="head">
        <div>
          <h1>Капремонт МКД</h1>
          <p className="lead">
            {objects.length} {plural(objects.length, 'адрес', 'адреса', 'адресов')} · {total.n} {plural(total.n, 'позиция', 'позиции', 'позиций')} ·
            {' '}период {periodLabel(p)}{p.isClosed ? ' (закрыт)' : ''}
          </p>
        </div>
        <div className="toolbar">
          <PeriodSelect periods={m.periods} value={p.start} onChange={setPeriod} />
          {m.isAdmin && (
            <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate({ period: p.start, close: !p.isClosed })}>
              {p.isClosed ? 'Открыть период' : 'Закрыть период'}
            </button>
          )}
          {canEnter && <Link className="btn primary" to="/mkd/input">Внести данные</Link>}
        </div>
      </div>

      <section className="tiles" aria-label="Итоги по направлению">
        <div className="tile"><span className="l">Готовность</span><span className="v">{pct100(total.pct)}</span><span className="s">план {pct100(total.plan)}</span></div>
        <div className="tile"><span className="l">Отклонение</span><span className="v"><RiskPill risk={total.risk} lag={total.lag} /></span><span className="s">порог {m.thresholds.warn} / {m.thresholds.crit} п.п.</span></div>
        <div className="tile"><span className="l">Договор</span><span className="v">{mln(total.contract)}</span><span className="s">{total.n} позиций</span></div>
        <div className="tile"><span className="l">Закрыто КС-2</span><span className="v">{mln(total.ks)}</span><span className="s">{pct100(total.contract ? (total.ks / total.contract) * 100 : 0)} договора</span></div>
        <div className="tile"><span className="l">Оплачено / к оплате</span><span className="v">{mln(total.paid)}</span><span className="s">к оплате {mln(total.topay)}</span></div>
        <div className="tile"><span className="l">Просрочено позиций</span><span className={'v' + (total.overdue ? ' crit' : '')}>{nf(total.overdue)}</span><span className="s">в работе {nf((total.statuses.work || 0) + (total.statuses.stop || 0))}</span></div>
      </section>

      <section className="toolbar" aria-label="Фильтры">
        <div className="chips">
          <button type="button" className="chip" aria-pressed={section === 'all'} onClick={() => setSection('all')}>Все лоты</button>
          {m.sections.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={section === String(s.id)} title={s.note} onClick={() => setSection(String(s.id))}>{s.name}</button>
          ))}
        </div>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={risk === 'all'} onClick={() => setRisk('all')}>Любой статус</button>
          {['crit', 'warn', 'ok'].map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={risk === r} onClick={() => setRisk(r)}>{RISK[r].name} · {riskCount(r)}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Адрес или ответственный…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        {!m.canEditAll && m.myObjectIds.length > 0 && (
          <label className="check"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />Только мои адреса</label>
        )}
        <span className="grow" />
        <select className="tb-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Сортировка {s.name}</option>)}
        </select>
      </section>

      {/* Таблица — на компьютере */}
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Адрес</th><th>Готовность</th><th>Отклонение</th>
              <th className="num">Договор</th><th className="num">КС-2</th><th className="num">Оплачено</th><th className="num">К оплате</th>
              <th className="num">Позиций</th><th>Ответственный</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="empty-row">Под условия фильтра адресов нет</td></tr>}
            {list.map((o) => (
              <tr key={o.id} className="link" onClick={() => openObject(o)}>
                <td>
                  <Link className="addr" to={`/mkd/${o.id}${period ? `?period=${period}` : ''}`} onClick={(e) => e.stopPropagation()}>{o.address}</Link>
                  {o.canEdit && !m.canEditAll && <span className="mine">мой</span>}
                  <div className="sub">{sectionName[o.sectionId] ?? '—'}</div>
                </td>
                <td><div className="prog"><ProgressBar pct={o.pct} plan={o.plan} /><span>{pct100(o.pct)} · план {pct100(o.plan)}</span></div></td>
                <td><RiskPill risk={o.risk} lag={o.lag} /></td>
                <td className="num">{mln(o.contract)}</td>
                <td className="num">{mln(o.ks)}</td>
                <td className="num">{mln(o.paid)}</td>
                <td className="num">{o.topay ? mln(o.topay) : '—'}</td>
                <td className="num">{o.n}{o.overdue ? <div className="sub" style={{ color: 'var(--crit-ink)' }}>просрочено {o.overdue}</div> : null}</td>
                <td>{o.responsible.join(', ') || <span className="sub">не назначен</span>}</td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>Итого по выборке: {list.length} {plural(list.length, 'адрес', 'адреса', 'адресов')}</td>
                <td className="num">{mln(sum('contract'))}</td><td className="num">{mln(sum('ks'))}</td>
                <td className="num">{mln(sum('paid'))}</td><td className="num">{mln(sum('topay'))}</td>
                <td className="num">{sum('n')}</td><td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Карточки — на телефоне */}
      <div className="cards">
        {list.length === 0 && <div className="empty-row">Под условия фильтра адресов нет</div>}
        {list.map((o) => (
          <Link key={o.id} className="ocard" to={`/mkd/${o.id}${period ? `?period=${period}` : ''}`}>
            <div className="top">
              <div>
                <div className="addr">{o.address}{o.canEdit && !m.canEditAll && <span className="mine"> · мой</span>}</div>
                <div className="meta">{sectionName[o.sectionId]} · {o.responsible.join(', ') || 'ответственный не назначен'}</div>
              </div>
              <RiskPill risk={o.risk} lag={o.lag} />
            </div>
            <ProgressBar pct={o.pct} plan={o.plan} />
            <div className="nums">
              <span>Готовность<b>{pct100(o.pct)} / {pct100(o.plan)}</b></span>
              <span>Договор<b>{mln(o.contract)}</b></span>
              <span>К оплате<b>{o.topay ? mln(o.topay) : '—'}</b></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
