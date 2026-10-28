// =====================================================================
//  «Благоустройство улиц» — раздел направления.
//  Адрес: /streets?program=kbu|current&report=<id>&compare=<id>&tab=…
//    summary  — итоги отчёта и что изменилось к отчёту сравнения
//    works    — виды работ: проект, факт, остаток
//    objects  — объекты: статус, позиции, замечания (фильтры, поиск)
//    matrix   — матрица «объекты × виды работ»
//    dynamics — динамика по всем отчётам программы: готовность, вид работ, замечания
//  Отчёт по умолчанию — последний в программе; сравнение по умолчанию — с предыдущим.
// =====================================================================

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCreateStreetsReport, useStreetsHistory, useStreetsMeta, useStreetsReport, useToggleStreetsReport } from '../../api/streets.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import DynamicsChart from '../../components/DynamicsChart.jsx';
import StackedBars from '../../components/StackedBars.jsx';
import { fdate, fdm, nf, pct, plural } from '../../utils/format.js';
import { Delta, PosCell, reportLabel, StStatus, vol } from './ui.jsx';

const TABS = [
  { id: 'summary', name: 'Сводка' },
  { id: 'works', name: 'Виды работ' },
  { id: 'objects', name: 'Объекты' },
  { id: 'matrix', name: 'Матрица' },
  { id: 'dynamics', name: 'Динамика' },
];

export default function StreetsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const meta = useStreetsMeta();
  const program = params.get('program') === 'current' ? 'current' : 'kbu';
  const reports = meta.data?.programs.find((p) => p.code === program)?.reports ?? [];
  const reportId = Number(params.get('report')) || reports[0]?.id;
  const compareId = Number(params.get('compare')) || undefined;
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'summary';
  const rep = useStreetsReport(reportId, compareId);
  const toggle = useToggleStreetsReport();

  const setParam = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  if (meta.isPending || (reportId && rep.isPending)) return <Loading text="Загружаем отчёт…" />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (rep.isError) return <ErrorBox error={rep.error} onRetry={rep.refetch} />;

  const m = meta.data;
  const crumbs = <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><span>Благоустройство улиц</span></nav>;
  if (!reportId) return <div className="page sect st">{crumbs}<div className="error-box"><h2>Отчётов пока нет</h2></div></div>;

  const { report, compare, total, objects, works } = rep.data;
  const current = reports.find((r) => r.id === report.id);
  const earlier = reports.filter((r) => r.date < report.date);
  const myInReport = objects.filter((o) => o.canEdit).length;

  return (
    <div className="page sect st">
      {crumbs}
      <div className="head">
        <div>
          <h1>Благоустройство улиц</h1>
          <p className="lead">
            {report.programName} · отчёт {fdate(report.date)}{report.source === 'manual' ? ` (ведётся вручную${report.isClosed ? ', закрыт' : ''})` : ' (из Excel)'}
            {compare ? ` · сравнение с ${fdate(compare.date)}` : ''}
          </p>
        </div>
      </div>

      <section className="report-bar" aria-label="Отчёт">
        <label className="f">
          <span>Программа</span>
          <select value={program} onChange={(e) => setParam({ program: e.target.value === 'kbu' ? null : e.target.value, report: null, compare: null })}>
            {m.programs.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </label>
        <label className="f">
          <span>Отчёт</span>
          <select value={report.id} onChange={(e) => setParam({ report: e.target.value === String(reports[0]?.id) ? null : e.target.value, compare: null })}>
            {reports.map((r) => <option key={r.id} value={r.id}>{reportLabel(r)}</option>)}
          </select>
        </label>
        <label className="f">
          <span>Сравнить с</span>
          {/* Пустое значение — «предыдущий отчёт» (его сервер берёт сам) */}
          <select value={compareId ?? ''} onChange={(e) => setParam({ compare: e.target.value })} disabled={!earlier.length}>
            {!earlier.length && <option value="">— раньше отчётов нет —</option>}
            {earlier.map((r, i) => <option key={r.id} value={i === 0 ? '' : r.id}>{reportLabel(r)}{i === 0 ? ' · предыдущий' : ''}</option>)}
          </select>
        </label>
        <span className="grow" />
        {m.isAdmin && report.source === 'manual' && (
          <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: report.id, close: !report.isClosed })}>
            {report.isClosed ? 'Открыть отчёт' : 'Закрыть отчёт'}
          </button>
        )}
        {rep.data.editable && myInReport > 0 && <Link className="btn primary" to={`/streets/input?report=${report.id}`}>Внести данные</Link>}
      </section>
      {m.canCreate && <NewReport program={program} reports={reports} today={m.today} onCreated={(id) => navigate(`/streets/input?report=${id}`)} />}
      {report.source !== 'manual' && current === reports[0] && m.canCreate && (
        <p className="hint">Отчёты из Excel не правятся. Чтобы внести свежие данные, создайте ручной отчёт на нужную дату — он заполнится значениями последнего отчёта.</p>
      )}

      <div className="subtabs" role="tablist" aria-label="Разделы">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setParam({ tab: t.id === 'summary' ? null : t.id })}>
            {t.name}{t.id === 'objects' && total.issues > 0 && <span className="cnt" title="Снижение факта">{total.issues}</span>}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab data={rep.data} />}
      {tab === 'works' && <WorksTab works={works} compare={compare} />}
      {tab === 'objects' && <ObjectsTab objects={objects} meta={m} />}
      {tab === 'matrix' && <MatrixTab objects={objects} works={works} />}
      {tab === 'dynamics' && <DynamicsTab program={program} works={m.works} reportDate={report.date} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Новый ручной отчёт
// ---------------------------------------------------------------------
function NewReport({ program, reports, today, onCreated }) {
  const create = useCreateStreetsReport();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [error, setError] = useState(null);
  const exists = reports.find((r) => r.date === date);
  const base = reports.find((r) => r.date < date);

  if (!open) return <div><button type="button" className="btn" onClick={() => setOpen(true)}>+ Новый отчёт</button></div>;
  async function onCreate() {
    setError(null);
    try {
      const r = await create.mutateAsync({ program, date });
      onCreated(r.id);
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="new-report">
      <label className="f">
        <span>Дата нового отчёта</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </label>
      <span className="hint">
        {exists ? 'На эту дату отчёт уже есть — выберите его в списке.' : base ? `Объекты, проект и факт будут взяты из отчёта ${fdate(base.date)}.` : 'Нет более раннего отчёта.'}
        {error && <span className="err"> {error}</span>}
      </span>
      <button type="button" className="btn primary" disabled={!date || exists || !base || create.isPending} onClick={onCreate}>{create.isPending ? 'Создаём…' : 'Создать'}</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Отмена</button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Сводка
// ---------------------------------------------------------------------
function SummaryTab({ data }) {
  const { total, objects, works, compare } = data;
  const workName = new Map(works.map((w) => [w.id, w]));
  const changed = objects.filter((o) => o.changed).sort((a, b) => b.issue - a.issue || a.short.localeCompare(b.short, 'ru'));
  const withRemarks = objects.filter((o) => o.remarks > 0).sort((a, b) => b.remarks - a.remarks);
  const maxRemarks = Math.max(1, ...withRemarks.map((o) => o.remarks));
  const changeText = (o) => [
    o.statusChanged && `статус: ${o.prevStatus ?? '—'} → ${o.status ?? '—'}`,
    ...Object.entries(o.values).filter(([, v]) => v.df).map(([wid, v]) => `${workName.get(Number(wid))?.name ?? 'вид работ'} ${v.df > 0 ? '+' : ''}${vol(v.df)}`),
    o.dRemarks && `замечаний ${o.dRemarks > 0 ? '+' : ''}${o.dRemarks}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <section className="tiles" aria-label="Итоги отчёта">
        <div className="tile"><span className="l">Позиций выполнено</span><span className="v">{pct(total.rate)}</span><span className="s">{nf(total.positionsDone)} из {nf(total.positions)} (объект × вид работ)</span></div>
        <div className="tile"><span className="l">Объекты</span><span className="v">{total.objects}</span><span className="s">завершены по статусу — {total.complete}</span></div>
        <div className="tile"><span className="l">С остатком объёмов</span><span className="v">{total.withRemainder}</span><span className="s">не завершены и есть недовыполненные позиции</span></div>
        <div className="tile"><span className="l">Замечания</span><span className={'v' + (total.remarks ? ' crit' : '')}>{total.remarks == null ? '—' : nf(total.remarks)}<Delta v={total.dRemarks} kind="remarks" /></span><span className="s">у {total.withRemarks} {plural(total.withRemarks, 'объекта', 'объектов', 'объектов')}</span></div>
        <div className="tile"><span className="l">Изменились</span><span className="v">{total.changed}</span><span className="s">{compare ? `к ${fdate(compare.date)}` : 'сравнивать не с чем'}{total.issues ? ` · снижение факта — ${total.issues}` : ''}</span></div>
        <div className="tile"><span className="l">Люди / техника</span><span className="v">{total.people == null && total.tech == null ? '—' : `${total.people ?? '—'} / ${total.tech ?? '—'}`}</span><span className="s">{total.people == null ? 'в отчёте не указаны' : 'по объектам, где указаны'}</span></div>
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="chH">
          <div className="sec-h"><h2 id="chH">Что изменилось</h2><span className="hint">{compare ? `к отчёту ${fdate(compare.date)}` : ''}</span></div>
          {changed.length === 0 ? <p className="hint">Изменений нет</p> : (
            <div className="change-list">
              {changed.map((o) => (
                <Link key={o.id} to={`/streets/${o.id}`}>
                  <b>{o.issue && <span className="bad">! </span>}{o.short}</b>
                  <StStatus status={o.status} complete={o.complete} />
                  <span className="sub">{changeText(o) || 'изменился проектный объём'}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="card" aria-labelledby="rmH">
          <div className="sec-h"><h2 id="rmH">Замечания по объектам</h2><span className="hint">{withRemarks.length} с замечаниями</span></div>
          {withRemarks.length === 0 ? <p className="hint">Замечаний нет</p> : (
            <div className="bar-list">
              {withRemarks.map((o) => (
                <Link key={o.id} to={`/streets/${o.id}`} title={o.name}>
                  <span>{o.short}</span>
                  <span className="track"><i style={{ width: `${(o.remarks / maxRemarks) * 100}%` }} /></span>
                  <span>{o.remarks}<Delta v={o.dRemarks} kind="remarks" /></span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Виды работ
// ---------------------------------------------------------------------
function WorksTab({ works, compare }) {
  return (
    <section className="work-grid" aria-label="Виды работ">
      {works.map((w) => (
        <article key={w.id} className={'work-card' + (w.done === w.positions ? ' done' : '')}>
          <div className="top"><b>{w.name}</b><strong>{pct(w.rate)}</strong></div>
          <ProgressBar pct={(w.rate ?? 0) * 100} />
          <div className="vals">
            <span>Проект<b>{vol(w.p)}</b></span>
            <span>Факт<b>{vol(w.f)}</b></span>
            <span>Остаток<b>{vol(w.remaining)}</b></span>
          </div>
          <div className="foot">
            <span>{w.unit || 'ед. не указана'} · выполнено {w.done} из {w.positions}{w.missing ? ` · без факта ${w.missing}` : ''}</span>
            {compare && <Delta v={w.df} />}
          </div>
        </article>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------
// Объекты
// ---------------------------------------------------------------------
const FILTERS = [
  ['all', 'Все', () => true],
  ['active', 'В работе', (o) => !o.complete],
  ['done', 'Завершены', (o) => o.complete],
  ['issues', 'Снижение факта', (o) => o.issue],
  ['changed', 'Изменились', (o) => o.changed],
  ['remarks', 'С замечаниями', (o) => o.remarks > 0],
];

function ObjectsTab({ objects, meta }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fn = FILTERS.find(([k]) => k === filter)[2];
    return objects.filter(fn).filter((o) => !needle || `${o.name} ${o.okrug} ${o.responsible.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => b.issue - a.issue || a.complete - b.complete || (a.rate ?? 1) - (b.rate ?? 1));
  }, [objects, filter, q]);
  const mineMark = (o) => o.canEdit && !meta.canEditAll && <span className="mine">мой</span>;

  // .registry: на телефоне вместо таблицы — карточки (правило из mkd.css)
  return (
    <div className="registry stack">
      <section className="toolbar" aria-label="Фильтры">
        <div className="chips">
          {FILTERS.map(([k, name, fn]) => (
            <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{name} · {objects.filter(fn).length}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Объект, округ, ответственный…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
      </section>

      <div className="tbl-wrap">
        <table className="data">
          <thead><tr><th>Объект</th><th>Статус</th><th>Позиции</th><th className="num">Замечания</th><th className="num hide-sm">Люди / техн.</th><th className="hide-sm">Ответственный</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="empty-row">Под условия фильтра объектов нет</td></tr>}
            {list.map((o) => (
              <tr key={o.id} className="link" onClick={() => navigate(`/streets/${o.id}`)}>
                <td>
                  <Link className="addr" to={`/streets/${o.id}`} onClick={(e) => e.stopPropagation()} title={o.name}>{o.issue && <span className="bad">! </span>}{o.short}</Link>{mineMark(o)}
                  <div className="sub">{o.okrug ?? '—'}{o.changed ? ' · изменился' : ''}</div>
                </td>
                <td><StStatus status={o.status} complete={o.complete} /></td>
                <td><div className="prog"><ProgressBar pct={(o.rate ?? 0) * 100} /><span>{o.done} из {o.positions}{o.missing ? ` · без факта ${o.missing}` : ''}</span></div></td>
                <td className="num">{o.remarks ?? '—'}<Delta v={o.dRemarks} kind="remarks" /></td>
                <td className="num hide-sm">{o.people == null && o.tech == null ? '—' : `${o.people ?? '—'} / ${o.tech ?? '—'}`}</td>
                <td className="hide-sm">{o.responsible.join(', ') || <span className="sub">не назначен</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cards">
        {list.map((o) => (
          <Link key={o.id} className="ocard" to={`/streets/${o.id}`}>
            <div className="top">
              <div><div className="addr">{o.issue && <span className="bad">! </span>}{o.short}</div><div className="meta">{o.okrug}{o.canEdit && !meta.canEditAll ? ' · мой' : ''}</div></div>
              <StStatus status={o.status} complete={o.complete} />
            </div>
            <ProgressBar pct={(o.rate ?? 0) * 100} />
            <div className="nums">
              <span>Позиции<b>{o.done} из {o.positions}</b></span>
              <span>Замечания<b>{o.remarks ?? '—'}</b></span>
              <span>Люди / техн.<b>{o.people ?? '—'} / {o.tech ?? '—'}</b></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Матрица
// ---------------------------------------------------------------------
function MatrixTab({ objects, works }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="legend-row">
        <span><span className="pill good">✓</span> выполнено</span>
        <span><span className="pill warn">60%</span> остаток (факт / проект)</span>
        <span><span className="pill idle">?</span> нет факта</span>
        <span><b className="bad">!</b> факт снизился</span>
        <span><b>жирный</b> — факт вырос</span>
      </div>
      <div className="tbl-wrap">
        <table className="data matrix">
          <thead>
            <tr><th>Объект</th>{works.map((w) => <th key={w.id} className="w" title={w.name}>{w.name}</th>)}</tr>
          </thead>
          <tbody>
            {objects.map((o) => (
              <tr key={o.id} className="link" onClick={() => navigate(`/streets/${o.id}`)}>
                <td className="obj"><span className="addr">{o.short}</span><div className="sub">{o.done} из {o.positions}</div></td>
                {works.map((w) => <PosCell key={w.id} v={o.values[w.id]} work={w} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Динамика по отчётам
// ---------------------------------------------------------------------
const ms = (iso) => Date.parse(`${iso}T00:00:00`);

function DynamicsTab({ program, works, reportDate }) {
  const hist = useStreetsHistory(program);
  const [work, setWork] = useState('');
  if (hist.isPending) return <Loading text="Загружаем динамику…" />;
  if (hist.isError) return <ErrorBox error={hist.error} onRetry={hist.refetch} />;

  const series = hist.data.series.filter((s) => s.date <= reportDate);
  const withWork = works.filter((w) => series.some((s) => s.works[w.id]?.p > 0));
  const w = withWork.find((x) => String(x.id) === work);
  const points = series.map((s) => {
    const v = w ? s.works[w.id] : null;
    const fact = w ? (v?.p > 0 ? Math.min(1, (v.f ?? 0) / v.p) : null) : s.rate;
    return { t: ms(s.date), label: fdm(s.date), fact, plan: null };
  });
  const recent = series.slice(-40);
  const people = recent.some((s) => s.people != null);

  return (
    <>
      <section className="card" aria-labelledby="dyH">
        <div className="sec-h">
          <h2 id="dyH">{w ? `${w.name}: факт / проект` : 'Доля выполненных позиций'}</h2>
          <select className="tb-select" value={work} onChange={(e) => setWork(e.target.value)} aria-label="Показатель">
            <option value="">Все работы (доля позиций)</option>
            {withWork.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <DynamicsChart points={points} title={w ? w.name : 'Доля выполненных позиций'} maxLabels={9} />
        <p className="hint">{series.length} {plural(series.length, 'отчёт', 'отчёта', 'отчётов')} с {fdate(series[0]?.date)} по {fdate(series.at(-1)?.date)}{w ? ` · сейчас ${vol(series.at(-1)?.works[w.id]?.f)} из ${vol(series.at(-1)?.works[w.id]?.p)} ${w.unit ?? ''}` : ''}</p>
      </section>
      <div className="two-col">
        <section className="card" aria-labelledby="dyR">
          <div className="sec-h"><h2 id="dyR">Замечания</h2><span className="hint">последние {recent.length} отчётов</span></div>
          <StackedBars points={recent.map((s) => ({ label: fdm(s.date), a: s.remarks ?? 0, b: 0 }))} names={['замечаний']} unit="шт." title="Замечания по отчётам" />
        </section>
        <section className="card" aria-labelledby="dyC">
          <div className="sec-h"><h2 id="dyC">{people ? 'Люди на объектах' : 'Завершено объектов'}</h2><span className="hint">последние {recent.length} отчётов</span></div>
          {people
            ? <StackedBars points={recent.map((s) => ({ label: fdm(s.date), a: s.people ?? 0, b: 0 }))} names={['людей']} unit="чел." title="Люди по отчётам" />
            : <StackedBars points={recent.map((s) => ({ label: fdm(s.date), a: s.complete, b: 0 }))} names={['завершено по статусу']} unit="объектов" title="Завершено объектов" />}
        </section>
      </div>
    </>
  );
}
