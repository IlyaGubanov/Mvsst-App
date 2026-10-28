// =====================================================================
//  «Капремонт школ» — раздел направления. Вкладки (?tab=):
//    overview     — итоги, карточки школ, группы работ × школы, S-кривая
//    procurement  — закупки: оплата → поставка → монтаж, просрочки
//    systems      — индивидуальные испытания: системы × школы
//    mge          — проектирование и экспертиза (МГЭ)
//  ?date= — срез на дату (по умолчанию сегодня): план считается на эту дату, факт — последние записи не позже неё.
// =====================================================================

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useProcurement, useSchoolsMeta, useSchoolsOverview, useSystems } from '../../api/schools.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import { fdate, moneyShortRu, nf, pct, plural, pp } from '../../utils/format.js';
import { devTone, MgeStatus, SCurve, SchStatus, SysCell, SYS_STATE, Triple } from './ui.jsx';

const TABS = [
  { id: 'overview', name: 'Обзор' },
  { id: 'procurement', name: 'Закупки' },
  { id: 'systems', name: 'Испытания' },
  { id: 'mge', name: 'Проект и МГЭ' },
];

export default function SchoolsPage() {
  const [params, setParams] = useSearchParams();
  const meta = useSchoolsMeta();
  const today = meta.data?.today;
  const date = params.get('date') || undefined;
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const ov = useSchoolsOverview(date);

  // Меняем один параметр адреса, остальные сохраняем (значения по умолчанию из адреса убираем)
  const setParam = (key, value, def) => {
    const next = new URLSearchParams(params);
    if (!value || value === def) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  if (meta.isPending || ov.isPending) return <Loading text="Загружаем школы…" />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (ov.isError) return <ErrorBox error={ov.error} onRetry={ov.refetch} />;

  const m = meta.data;
  const { total, schools } = ov.data;
  const canEnter = m.canEditAll || m.myObjectIds.length > 0;
  const viewDate = ov.data.date;

  return (
    <div className="page sect sch">
      <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><span>Капремонт школ</span></nav>

      <div className="head">
        <div>
          <h1>Капремонт школ</h1>
          <p className="lead">
            {schools.length} {plural(schools.length, 'школа', 'школы', 'школ')} · план на {fdate(viewDate)} · последние данные {fdate(total.asOf)}
          </p>
        </div>
        <div className="toolbar">
          <div className="date-pick">
            <label htmlFor="schDate">Срез на</label>
            <input id="schDate" type="date" value={viewDate} max={today} onChange={(e) => setParam('date', e.target.value, today)} />
            {viewDate !== today && <button type="button" className="btn" onClick={() => setParam('date', null)}>Сегодня</button>}
          </div>
          {canEnter && <Link className="btn primary" to="/schools/input">Внести данные</Link>}
        </div>
      </div>

      <div className="subtabs" role="tablist" aria-label="Разделы">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setParam('tab', t.id, 'overview')}>
            {t.name}
            {t.id === 'procurement' && total.overdueDeliveries > 0 && <span className="cnt" title="Просрочено поставок">{total.overdueDeliveries}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab data={ov.data} meta={m} date={date} />}
      {tab === 'procurement' && <ProcurementTab date={date} schools={schools} />}
      {tab === 'systems' && <SystemsTab />}
      {tab === 'mge' && <MgeTab data={ov.data} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Обзор
// ---------------------------------------------------------------------
function OverviewTab({ data, meta, date }) {
  const { total, schools, curve } = data;
  const href = (s) => `/schools/${s.id}${date ? `?date=${date}` : ''}`;
  const people = (s) => s.resources ? `${s.resources.people + s.resources.peopleLandscape} / ${s.resources.tech + s.resources.techLandscape}` : '—';

  return (
    <>
      <section className="tiles" aria-label="Итоги по направлению">
        <div className="tile"><span className="l">Готовность</span><span className="v">{pct(total.fact, 1)}</span><span className="s">план {pct(total.plan, 1)} · {pp(total.dev)}</span></div>
        <div className="tile"><span className="l">Отставание от графика</span><span className={'v' + (total.lagDays > 14 ? ' crit' : '')}>{nf(total.lagDays)} дн.</span><span className="s">столько дней назад план был равен факту</span></div>
        <div className="tile"><span className="l">Лимит</span><span className="v">{moneyShortRu(total.limit)}</span><span className="s">оплачено {moneyShortRu(total.paid)} · {pct(total.limit ? total.paid / total.limit : 0)}</span></div>
        <div className="tile"><span className="l">Люди / техника</span><span className="v">{nf(total.people)} / {nf(total.tech)}</span><span className="s">с благоустройством, последние данные</span></div>
        <div className="tile"><span className="l">Просрочено поставок</span><span className={'v' + (total.overdueDeliveries ? ' crit' : '')}>{nf(total.overdueDeliveries)}</span><span className="s">срок прошёл, поставка не 100 %</span></div>
        <div className="tile"><span className="l">Заключения МГЭ</span><span className="v">{total.mgePositive} из {schools.length}</span><span className="s">положительные</span></div>
      </section>

      <section className="schools-grid" aria-label="Школы">
        {schools.map((s) => (
          <Link key={s.id} className="school-card" to={href(s)}>
            <div className="top">
              <div>
                <b>{s.short}</b>{s.canEdit && !meta.canEditAll && <span className="mine"> · моя</span>}
                <div className="meta">{s.okrug} · {s.district} · {s.type}</div>
              </div>
              <SchStatus status={s.status} dev={s.dev} />
            </div>
            <div className="big">{pct(s.fact)}<small>план {pct(s.plan)}</small></div>
            <ProgressBar pct={s.fact * 100} plan={s.plan * 100} />
            <div className="nums">
              <span>Люди / техн.<b>{people(s)}</b></span>
              <span>Оплачено<b>{pct(s.limitTotal ? s.paid / s.limitTotal : 0)} лимита</b></span>
              <span>Просрочено поставок<b className={s.overdueDeliveries ? 'bad' : ''}>{s.overdueDeliveries}</b></span>
              <span>Ответственный<b>{s.responsible.join(', ') || '—'}</b></span>
            </div>
          </Link>
        ))}
      </section>

      <section aria-labelledby="grpH">
        <div className="sec-h"><h2 id="grpH">Готовность по группам работ</h2><span className="hint">факт / план на дату; цвет — отставание от плана</span></div>
        <div className="tbl-wrap">
          <table className="data heat">
            <thead>
              <tr>
                <th>Группа работ</th><th className="num">Вес</th>
                {schools.map((s) => <th key={s.id} className="num">{s.short}</th>)}
                <th className="num">Все школы</th>
              </tr>
            </thead>
            <tbody>
              {total.groups.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td className="num sub">{pct(g.weight)}</td>
                  {schools.map((s) => {
                    const c = s.groups[g.name];
                    return <td key={s.id} className={`cell ${devTone(c.fact, c.plan, meta.thresholds)}`}>{pct(c.fact)}<span>план {pct(c.plan)}</span></td>;
                  })}
                  <td className={`cell ${devTone(g.fact, g.plan, meta.thresholds)}`}><b>{pct(g.fact)}</b><span>план {pct(g.plan)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Итого (взвешенно)</td><td className="num sub">{pct(total.groups.reduce((a, g) => a + g.weight, 0))}</td>
                {schools.map((s) => <td key={s.id} className="cell">{pct(s.fact)}</td>)}
                <td className="cell"><b>{pct(total.fact)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="curveH">
        <div className="sec-h"><h2 id="curveH">S-кривая: готовность всех школ</h2><span className="hint">план по графику работ · факт — по дням ввода</span></div>
        <SCurve curve={curve} title="S-кривая по всем школам" />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------
// Закупки
// ---------------------------------------------------------------------
function ProcurementTab({ date, schools }) {
  const proc = useProcurement(date);
  const [school, setSchool] = useState('all');
  const [cat, setCat] = useState('all');
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const items = proc.data?.items;
  const list = useMemo(() => (items ?? [])
    .filter((i) => school === 'all' || String(i.schoolId) === school)
    .filter((i) => cat === 'all' || i.category === cat)
    .filter((i) => !onlyOverdue || i.overdueDelivery || i.overdueDone), [items, school, cat, onlyOverdue]);

  if (proc.isPending) return <Loading text="Загружаем закупки…" />;
  if (proc.isError) return <ErrorBox error={proc.error} onRetry={proc.refetch} />;
  const { categories, overdue } = proc.data;

  return (
    <>
      <section className="tbl-wrap" aria-labelledby="catH">
        <h2 id="catH" className="visually-hidden">По категориям</h2>
        <table className="data">
          <thead><tr><th>Категория</th><th className="num">Позиций</th><th>Оплата · поставка · монтаж (среднее)</th><th className="num">Просрочено поставок</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.category} className="link" onClick={() => setCat(cat === c.category ? 'all' : c.category)} aria-selected={cat === c.category}>
                <td>{c.category}</td><td className="num">{c.n}</td>
                <td><Triple pay={c.pay} delivered={c.delivered} installed={c.installed} /></td>
                <td className={'num' + (c.overdue ? ' bad' : '')}>{c.overdue || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="toolbar" aria-label="Фильтры">
        <select className="tb-select" value={school} onChange={(e) => setSchool(e.target.value)} aria-label="Школа">
          <option value="all">Все школы</option>
          {schools.map((s) => <option key={s.id} value={String(s.id)}>{s.short}</option>)}
        </select>
        <select className="tb-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Категория">
          <option value="all">Все категории</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />Только просроченные ({overdue})</label>
      </section>

      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr><th>Позиция</th><th>Школа</th><th className="num hide-sm">Количество</th><th>Выполнение</th><th>Поставка до</th><th className="hide-sm">Монтаж до</th></tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="empty-row">Под условия фильтра позиций нет</td></tr>}
            {list.map((i) => (
              <tr key={`${i.schoolId}-${i.materialId}`} className={i.overdueDelivery ? 'overdue' : ''}>
                <td><div className="addr">{i.name}</div><div className="sub">{i.category}{i.maker ? ` · ${i.maker}` : ''}</div></td>
                <td className="sub">{i.school}</td>
                <td className="num hide-sm">{i.qty != null ? `${nf(i.qty, Number.isInteger(i.qty) ? 0 : 1)} ${i.unit ?? ''}` : '—'}</td>
                <td><Triple pay={i.pay} delivered={i.delivered} installed={i.installed} /></td>
                <td className={i.overdueDelivery ? 'bad' : 'sub'}>{fdate(i.deliveryDate)}{i.overdueDelivery && ' · просрочено'}</td>
                <td className={'hide-sm ' + (i.overdueDone ? 'bad' : 'sub')}>{fdate(i.doneDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Испытания систем
// ---------------------------------------------------------------------
function SystemsTab() {
  const sys = useSystems();
  if (sys.isPending) return <Loading text="Загружаем испытания…" />;
  if (sys.isError) return <ErrorBox error={sys.error} onRetry={sys.refetch} />;
  const { systems, schools, cells } = sys.data;
  const cell = new Map(cells.map((c) => [`${c.schoolId}|${c.systemId}`, c]));
  const count = (schoolId, state) => cells.filter((c) => c.schoolId === schoolId && c.state === state).length;

  return (
    <>
      <div className="legend-row">
        {Object.values(SYS_STATE).map((s) => <span key={s.name}><span className={s.cls}>{s.icon}</span> {s.name}</span>)}
        <span><b>ИД</b> — есть исполнительная документация</span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr><th>Система</th>{schools.map((s) => <th key={s.id} className="sys-cell">{s.short}</th>)}</tr>
          </thead>
          <tbody>
            {systems.map((y) => (
              <tr key={y.id}>
                <td>{y.name}</td>
                {schools.map((s) => { const c = cell.get(`${s.id}|${y.id}`); return <td key={s.id} className="sys-cell">{c ? <SysCell state={c.state} idDocs={c.idDocs} /> : '—'}</td>; })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Работоспособны / отсутствуют</td>
              {schools.map((s) => <td key={s.id} className="sys-cell">{count(s.id, 'работоспособна')} / <span className="sys-none">{count(s.id, 'отсутствует')}</span></td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Проектирование и МГЭ
// ---------------------------------------------------------------------
function MgeTab({ data }) {
  const byId = new Map(data.schools.map((s) => [s.id, s]));
  return (
    <div className="tbl-wrap">
      <table className="data">
        <thead>
          <tr><th>Школа</th><th>Проектировщик</th><th className="hide-sm">Начало ПИР</th><th className="hide-sm">Проект готов</th><th>Подано в МГЭ</th><th>Заключение</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {data.expertise.length === 0 && <tr><td colSpan={7} className="empty-row">Данных об экспертизе нет</td></tr>}
          {data.expertise.map((e) => (
            <tr key={e.schoolId}>
              <td><div className="addr">{byId.get(e.schoolId)?.short ?? '—'}</div>{e.reviewer && <div className="sub">проверяет {e.reviewer}</div>}</td>
              <td>{e.designer ?? '—'}</td>
              <td className="sub hide-sm">{fdate(e.pirStart)}</td>
              <td className="sub hide-sm">{fdate(e.projectDone)}</td>
              <td className="sub">{fdate(e.expIn)}</td>
              <td className="sub">{fdate(e.expOut)}</td>
              <td><MgeStatus status={e.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
