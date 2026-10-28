// =====================================================================
//  Карточка школы: сведения, итоги, готовность по группам, виды работ с историей ввода,
//  S-кривая, люди и техника по дням, закупки, испытания систем, экспертиза.
//  ?date= — срез на дату (как в разделе).
// =====================================================================

import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useSchool, useSchoolsMeta } from '../../api/schools.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import StackedBars from '../../components/StackedBars.jsx';
import { fdate, fdm, moneyShortRu, nf, pct, pp } from '../../utils/format.js';
import { MgeStatus, SCurve, SchStatus, SysCell, Triple } from './ui.jsx';

const vol = (v) => (v == null ? '—' : nf(v, Number.isInteger(Number(v)) ? 0 : 1));
const DAYS_IN_CHART = 30; // сколько последних дней показывать на графике ресурсов

export default function SchoolPage() {
  const { objectId } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || undefined;
  const meta = useSchoolsMeta();
  const card = useSchool(objectId, date);
  const [open, setOpen] = useState(new Set()); // какие виды работ раскрыты (история)

  if (meta.isPending || card.isPending) return <Loading text="Загружаем школу…" />;
  if (card.isError) return <ErrorBox error={card.error} onRetry={card.refetch} title={card.error.status === 404 ? 'Школа не найдена' : undefined} />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;

  const today = meta.data.today;
  const { school: s, works, materials, systems, expertise, resources, curve } = card.data;
  const viewDate = card.data.date;
  const back = `/schools${date ? `?date=${date}` : ''}`;
  const setDate = (v) => setParams(!v || v === today ? {} : { date: v }, { replace: true });
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const groups = [...new Set(works.map((w) => w.group))];
  const r = s.resources;
  const lastDays = resources.slice(-DAYS_IN_CHART);
  const overdue = materials.filter((m) => m.overdueDelivery);

  return (
    <div className="page sect sch">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Сводка</Link><span>/</span><Link to={back}>Капремонт школ</Link><span>/</span><span>{s.short}</span>
      </nav>

      <div className="head">
        <div>
          <h1>{s.short}</h1>
          <p className="lead">{s.name} · {s.okrug}, {s.district}</p>
        </div>
        <div className="toolbar">
          <div className="date-pick">
            <label htmlFor="scDate">Срез на</label>
            <input id="scDate" type="date" value={viewDate} max={today} onChange={(e) => setDate(e.target.value)} />
            {viewDate !== today && <button type="button" className="btn" onClick={() => setDate(null)}>Сегодня</button>}
          </div>
          {s.canEdit && <Link className="btn primary" to={`/schools/input?object=${s.id}${date ? `&date=${date}` : ''}`}>Внести данные</Link>}
        </div>
      </div>

      <section className="card info-grid" aria-label="Сведения о школе">
        <div><span>Тип здания</span>{s.type ?? '—'}</div>
        <div><span>Площадь</span>{s.area ? `${nf(s.area, 1)} м²` : '—'}{s.territory ? ` · территория ${nf(s.territory, 2)} га` : ''}</div>
        <div><span>Подрядчик</span>{s.contractor ?? '—'}</div>
        <div><span>Проектировщик</span>{s.designer ?? '—'}</div>
        <div><span>Пищеблок</span>{s.kitchen ?? '—'}</div>
        <div><span>Комплекс ИИ</span>{s.iiComplex ?? '—'}{s.iiSourceDemo ? <div className="sub">демо: {s.iiSourceDemo}</div> : null}</div>
        <div><span>Экспертиза</span>{s.mgeStatus ?? '—'}</div>
        <div><span>Ответственные за ввод</span>{s.responsible.length ? s.responsible.join(', ') : 'не назначены'}</div>
      </section>

      <section className="tiles" aria-label="Итоги по школе">
        <div className="tile"><span className="l">Готовность</span><span className="v">{pct(s.fact, 1)}</span><span className="s">план на {fdate(viewDate)} — {pct(s.plan, 1)}</span></div>
        <div className="tile"><span className="l">Статус</span><span className="v"><SchStatus status={s.status} dev={s.dev} /></span><span className="s">отклонение {pp(s.dev)}</span></div>
        <div className="tile"><span className="l">Лимит</span><span className="v">{moneyShortRu(s.limitTotal)}</span><span className="s">в 2026 г. — {moneyShortRu(s.limit2026)}</span></div>
        <div className="tile"><span className="l">Оплачено</span><span className="v">{moneyShortRu(s.paid)}</span><span className="s">{pct(s.limitTotal ? s.paid / s.limitTotal : 0)} лимита · закупки {pct(s.procPayTotal)}</span></div>
        <div className="tile">
          <span className="l">Люди / техника</span>
          <span className="v">{r ? `${r.people + r.peopleLandscape} / ${r.tech + r.techLandscape}` : '—'}</span>
          <span className="s">{r ? `благоустройство ${r.peopleLandscape} / ${r.techLandscape} · на ${fdate(r.date)}` : 'не вносились'}</span>
        </div>
        <div className="tile"><span className="l">Просрочено поставок</span><span className={'v' + (overdue.length ? ' crit' : '')}>{overdue.length}</span><span className="s">из {materials.length} позиций</span></div>
      </section>

      <section className="secs" aria-label="Группы работ">
        {Object.entries(s.groups).map(([name, g]) => (
          <div key={name} className="sec-card">
            <b>{name}</b>
            <ProgressBar pct={g.fact * 100} plan={g.plan * 100} />
            <span className="nums"><span>{pct(g.fact)} · план {pct(g.plan)}</span><span className={g.fact - g.plan < -0.1 ? 'bad' : ''}>{pp(g.fact - g.plan)}</span></span>
          </div>
        ))}
      </section>

      <section aria-labelledby="worksH">
        <div className="sec-h"><h2 id="worksH">Виды работ</h2><span className="hint">выполнение на {fdate(viewDate)}; план — линейно между началом и окончанием</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr><th>Вид работ</th><th className="num hide-sm">Вес</th><th className="hide-sm">Сроки</th><th className="num">Объём (факт / проект)</th><th>Выполнение</th><th className="hide-sm">Последний ввод</th></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr><td colSpan={6} className="sub"><b>{g}</b></td></tr>
                  {works.filter((w) => w.group === g).map((w) => (
                    <Fragment key={w.id}>
                      <tr>
                        <td>
                          <div className="addr">{w.name}</div>
                          <div className="sub">
                            {w.code}
                            {/* История — здесь, а не в отдельной колонке: на телефоне колонки справа скрываются */}
                            {w.history.length > 0 && (
                              <> · <button type="button" className="hist-btn" aria-expanded={open.has(w.id)} onClick={() => toggle(w.id)}>
                                {open.has(w.id) ? 'скрыть историю' : `история · ${w.history.length}`}
                              </button></>
                            )}
                          </div>
                        </td>
                        <td className="num sub hide-sm">{pct(w.weight, 1)}</td>
                        <td className="sub hide-sm">{fdm(w.start)} – {fdm(w.end)}</td>
                        <td className="num">{w.planVolume ? `${vol(w.factVolume ?? w.fact * w.planVolume)} / ${vol(w.planVolume)} ${w.unit ?? ''}` : '—'}</td>
                        <td>
                          <div className="prog"><ProgressBar pct={w.fact * 100} plan={w.plan * 100} /><span>{pct(w.fact)} · план {pct(w.plan)}</span></div>
                        </td>
                        <td className="hide-sm sub">{w.entryDate ? `${fdate(w.entryDate)}${w.enteredBy ? ` · ${w.enteredBy}` : ''}` : 'нет данных'}</td>
                      </tr>
                      {open.has(w.id) && (
                        <tr className="hist">
                          <td colSpan={6}>
                            <table>
                              <thead><tr><th>Дата</th><th>Выполнение</th><th>Объём</th><th>Кто внёс</th></tr></thead>
                              <tbody>
                                {[...w.history].reverse().map((h) => (
                                  <tr key={h.date}><td>{fdate(h.date)}</td><td>{pct(h.pct, 1)}</td><td>{h.factVolume != null ? `${vol(h.factVolume)} ${w.unit ?? ''}` : '—'}</td><td>{h.by ?? '—'}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="curveH">
          <div className="sec-h"><h2 id="curveH">S-кривая</h2><span className="hint">план и факт готовности</span></div>
          <SCurve curve={curve} title={`S-кривая: ${s.short}`} />
        </section>
        <section className="card" aria-labelledby="resH">
          <div className="sec-h"><h2 id="resH">Люди на объекте</h2><span className="hint">последние {lastDays.length} дн. с данными</span></div>
          <StackedBars points={lastDays.map((x) => ({ label: fdm(x.date), a: x.people, b: x.peopleLandscape }))} title="Люди по дням" />
        </section>
      </div>

      <section aria-labelledby="matH">
        <div className="sec-h"><h2 id="matH">Закупки</h2><span className="hint">оплата → поставка → монтаж</span></div>
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Позиция</th><th className="num hide-sm">Количество</th><th>Выполнение</th><th>Поставка до</th><th className="hide-sm">Монтаж до</th></tr></thead>
            <tbody>
              {materials.length === 0 && <tr><td colSpan={5} className="empty-row">Позиций нет</td></tr>}
              {materials.map((m) => (
                <tr key={m.id} className={m.overdueDelivery ? 'overdue' : ''}>
                  <td><div className="addr">{m.name}</div><div className="sub">{m.category}{m.maker ? ` · ${m.maker}` : ''}</div></td>
                  <td className="num hide-sm">{m.qty != null ? `${vol(m.qty)} ${m.unit ?? ''}` : '—'}</td>
                  <td><Triple pay={m.pay} delivered={m.delivered} installed={m.installed} /></td>
                  <td className={m.overdueDelivery ? 'bad' : 'sub'}>{fdate(m.deliveryDate)}{m.overdueDelivery && ' · просрочено'}</td>
                  <td className={'hide-sm ' + (m.overdueDone ? 'bad' : 'sub')}>{fdate(m.doneDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section aria-labelledby="sysH">
          <div className="sec-h"><h2 id="sysH">Испытания систем</h2></div>
          <div className="tbl-wrap">
            <table className="data">
              <thead><tr><th>Система</th><th>Состояние</th></tr></thead>
              <tbody>
                {systems.map((x) => <tr key={x.id}><td>{x.name}</td><td><SysCell state={x.state} idDocs={x.idDocs} /> <span className="sub">{x.state}</span></td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="mgeH">
          <div className="sec-h"><h2 id="mgeH">Проект и экспертиза</h2></div>
          {expertise ? (
            <div className="info-grid">
              <div><span>Проектировщик</span>{expertise.designer ?? '—'}</div>
              <div><span>Проверяет</span>{expertise.reviewer ?? '—'}</div>
              <div><span>Начало ПИР</span>{fdate(expertise.pirStart)}</div>
              <div><span>Проект готов</span>{fdate(expertise.projectDone)}</div>
              <div><span>Подано в МГЭ</span>{fdate(expertise.expIn)}</div>
              <div><span>Заключение</span>{fdate(expertise.expOut)}</div>
              <div><span>Передача площадки</span>{fdate(expertise.handover)}</div>
              <div><span>Статус</span><MgeStatus status={expertise.status} /></div>
            </div>
          ) : <p className="hint">Данных об экспертизе нет</p>}
        </section>
      </div>
    </div>
  );
}
