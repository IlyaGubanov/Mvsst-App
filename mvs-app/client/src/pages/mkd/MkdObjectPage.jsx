// =====================================================================
//  Карточка адреса МКД: сведения, итоги, позиции (вид работ) и история статусов по периодам.
//  Кнопка «Внести данные» видна только ответственному за адрес и администратору.
// =====================================================================

import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMkdMeta, useMkdObject } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { fdate, fdm, mln, pct100, periodLabel, rub } from '../../utils/format.js';
import { PeriodSelect, ProgressBar, RiskPill, StatusChip, STATUS } from './ui.jsx';

export default function MkdObjectPage() {
  const { objectId } = useParams();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || undefined;
  const meta = useMkdMeta();
  const card = useMkdObject(objectId, period);
  const [open, setOpen] = useState(() => new Set()); // позиции с раскрытой историей

  if (meta.isPending || card.isPending) return <Loading text="Загружаем адрес…" />;
  if (card.isError) return <ErrorBox error={card.error} onRetry={card.refetch} title={card.error.status === 404 ? 'Адрес не найден' : undefined} />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;

  const { object: o, items, period: p } = card.data;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setPeriod = (v) => setParams(v === meta.data.periods[0]?.start ? {} : { period: v }, { replace: true });
  const backLink = `/mkd${period ? `?period=${period}` : ''}`;

  return (
    <div className="page sect mkd">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Сводка</Link><span>/</span><Link to={backLink}>Капремонт МКД</Link><span>/</span><span>{o.address}</span>
      </nav>

      <div className="head">
        <div>
          <h1>{o.address}</h1>
          <p className="lead">{o.section}{o.sectionNote ? ` · ${o.sectionNote}` : ''}</p>
        </div>
        <div className="toolbar">
          <PeriodSelect periods={meta.data.periods} value={p.start} onChange={setPeriod} />
          {o.canEdit && <Link className="btn primary" to={`/mkd/input?object=${o.id}`}>Внести данные</Link>}
        </div>
      </div>

      <section className="card info-grid" aria-label="Сведения об адресе">
        <div><span>Куратор</span>{o.curator ?? '—'}</div>
        <div><span>Ответственные за ввод</span>{o.responsible.length ? o.responsible.join(', ') : 'не назначены — обратитесь к администратору'}</div>
        <div><span>Отчётный период</span>{periodLabel(p)}{p.isClosed ? ' · закрыт' : ''} · план на {fdate(p.planDate)}</div>
        {o.note && <div><span>Примечание</span>{o.note}</div>}
      </section>

      <section className="tiles" aria-label="Итоги по адресу">
        <div className="tile"><span className="l">Готовность</span><span className="v">{pct100(o.pct)}</span><span className="s">план {pct100(o.plan)}</span></div>
        <div className="tile"><span className="l">Отклонение</span><span className="v"><RiskPill risk={o.risk} lag={o.lag} /></span><span className="s">{o.overdue ? `просрочено позиций: ${o.overdue}` : 'просрочек нет'}</span></div>
        <div className="tile"><span className="l">Договор</span><span className="v">{mln(o.contract)}</span><span className="s">{o.n} позиций</span></div>
        <div className="tile"><span className="l">Закрыто КС-2</span><span className="v">{mln(o.ks)}</span><span className="s">{pct100(o.contract ? (o.ks / o.contract) * 100 : 0)} договора</span></div>
        <div className="tile"><span className="l">Оплачено</span><span className="v">{mln(o.paid)}</span><span className="s">&nbsp;</span></div>
        <div className="tile"><span className="l">К оплате</span><span className="v">{mln(o.topay)}</span><span className="s">КС-2 подписаны</span></div>
      </section>

      <section aria-labelledby="itemsH">
        <div className="sec-h"><h2 id="itemsH">Позиции</h2><span className="hint">статус на период · чёрная отметка — план на дату</span></div>
        <div className="tbl-wrap">
          <table className="data items-tbl">
            <thead>
              <tr>
                <th>Вид работ</th><th>Статус</th><th>Готовность</th><th>Отклонение</th><th className="hide-md">Сроки</th>
                <th className="num hide-sm">Договор</th><th className="num hide-sm">КС-2</th><th className="num hide-sm">Оплачено</th><th>История</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Fragment key={it.id}>
                  <tr>
                    <td>
                      <div className="addr">{it.workType}</div>
                      <div className="sub">{[it.org, it.responsible].filter(Boolean).join(' · ') || it.group}</div>
                      {it.statusNote && <div className="note-line">💬 {it.statusNote}</div>}
                    </td>
                    <td><StatusChip status={it.status} /></td>
                    <td><div className="prog"><ProgressBar pct={it.pct} plan={it.plan} /><span>{pct100(it.pct)} · план {pct100(it.plan)}</span></div></td>
                    <td><RiskPill risk={it.risk} lag={it.lag} />{it.overdue && <div className="sub" style={{ color: 'var(--crit-ink)' }}>срок прошёл</div>}</td>
                    <td className="sub hide-md" style={{ whiteSpace: 'nowrap' }}>{fdate(it.start)} – {fdate(it.end)}</td>
                    <td className="num hide-sm">{rub(it.contract)}</td>
                    <td className="num hide-sm">{it.ks ? rub(it.ks) : '—'}</td>
                    <td className="num hide-sm">{it.paid ? rub(it.paid) : '—'}</td>
                    <td>
                      <button type="button" className="hist-btn" aria-expanded={open.has(it.id)} onClick={() => toggle(it.id)}>
                        {open.has(it.id) ? 'Скрыть' : `${it.history.length} записей`}
                      </button>
                    </td>
                  </tr>
                  {open.has(it.id) && (
                    <tr className="hist">
                      <td colSpan={9}>
                        <table>
                          <thead><tr><th>Период</th><th>Статус</th><th>Готовность</th><th>КС-2</th><th>Оплачено</th><th>Кто внёс</th><th>Примечание</th></tr></thead>
                          <tbody>
                            {[...it.history].reverse().map((h) => (
                              <tr key={h.period}>
                                <td>{fdm(h.period)}</td>
                                <td>{STATUS[h.status]?.name ?? h.status}</td>
                                <td>{pct100(h.pct)}</td>
                                <td>{rub(h.ks)}</td>
                                <td>{rub(h.paid)}</td>
                                <td>{h.by ?? '—'}{h.at ? `, ${fdate(h.at)} ${String(h.at).slice(11, 16)}` : ''}</td>
                                <td>{h.note ?? ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
