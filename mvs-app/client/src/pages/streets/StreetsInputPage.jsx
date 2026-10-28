// =====================================================================
//  Ввод по объектам благоустройства — в открытый ручной отчёт, ответственными по своим объектам.
//  Адрес: /streets/input?report=<id>&object=<id>.
//  Ручной отчёт создаётся в разделе («+ Новый отчёт») и заполняется значениями прошлого отчёта —
//  здесь их исправляют: факт по видам работ (накопительно), статус, людей, технику, замечания.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSaveStreetRow, useStreetsMeta, useStreetsReport } from '../../api/streets.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import { fdate, parseNumber, pct } from '../../utils/format.js';
import { reportLabel, StStatus, vol } from './ui.jsx';
import { formWorks, fromForm, hasErrors, isChanged, previewRate, toForm, validate, warnings } from './streetForm.js';

const COUNT_FIELDS = [
  { key: 'people', label: 'Людей, чел.' },
  { key: 'tech', label: 'Техники, ед.' },
  { key: 'remarks', label: 'Замечаний, шт.' },
];

export default function StreetsInputPage() {
  const [params, setParams] = useSearchParams();
  const meta = useStreetsMeta();
  const save = useSaveStreetRow();

  // Открытые ручные отчёты обеих программ — в них можно вносить
  const openReports = useMemo(() => (meta.data?.programs ?? []).flatMap((p) => p.reports
    .filter((r) => r.source === 'manual' && !r.isClosed).map((r) => ({ ...r, program: p.code, programName: p.name }))), [meta.data]);
  const requestedReport = Number(params.get('report'));
  const reportId = openReports.some((r) => r.id === requestedReport) ? requestedReport : openReports[0]?.id;
  const rep = useStreetsReport(reportId);

  const myObjects = useMemo(() => (rep.data?.objects ?? []).filter((o) => o.canEdit).sort((a, b) => a.short.localeCompare(b.short, 'ru')), [rep.data]);
  const requested = Number(params.get('object'));
  const object = myObjects.find((o) => o.id === requested) ?? myObjects[0];
  const works = meta.data?.works ?? [];

  const original = useMemo(() => (object ? toForm(object, works) : null), [object, works]);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState(null);
  const form = draft ?? original;
  const errors = form ? validate(form, works, object) : { facts: {} };
  const dirty = Boolean(draft && original && isChanged(draft, original, works, object));
  const blocked = dirty && hasErrors(errors);

  useEffect(() => { setDraft(null); }, [object?.id, reportId]);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (meta.isPending || (reportId && rep.isPending)) return <Loading />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (rep.isError) return <ErrorBox error={rep.error} onRetry={rep.refetch} />;

  const crumbs = (
    <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><Link to="/streets">Благоустройство улиц</Link><span>/</span><span>Ввод данных</span></nav>
  );
  if (!reportId) {
    return (
      <div className="page sect st">{crumbs}
        <div className="error-box"><h2>Нет открытого ручного отчёта</h2><p>Создайте его в разделе кнопкой «+ Новый отчёт» — он заполнится данными последнего отчёта, а здесь вы их исправите.</p><Link className="btn" to="/streets">К разделу</Link></div>
      </div>
    );
  }
  if (!object) {
    return (
      <div className="page sect st">{crumbs}
        <div className="error-box"><h2>Нет объектов для ввода</h2><p>Вы не назначены ответственным ни за один объект этого отчёта. Обратитесь к администратору.</p></div>
      </div>
    );
  }

  const { report, compare } = rep.data;
  const confirmLeave = () => !dirty || window.confirm('Есть несохранённые изменения. Перейти без сохранения?');
  const go = (next) => { if (confirmLeave()) { setParams(next, { replace: true }); setMessage(null); } };
  const edit = (fn) => { setMessage(null); setDraft((d) => fn(d ?? original)); };
  const set = (key, value) => edit((f) => ({ ...f, [key]: value }));
  const setFact = (id, value) => edit((f) => ({ ...f, facts: { ...f.facts, [id]: value } }));

  async function onSave() {
    try {
      const r = await save.mutateAsync({ reportId, objectId: object.id, row: fromForm(draft, original, works, object) });
      setDraft(null);
      setMessage({ ok: true, text: `${r.message}. Показатели «Сводки» обновлены.` });
    } catch (err) {
      setMessage({ ok: false, text: err.details?.fields?.[0]?.message ?? err.message });
    }
  }

  const shownWorks = formWorks(works, object);
  const warns = dirty ? warnings(form, original, works, object, meta.data.doneStatuses) : [];
  const rate = previewRate(form, works, object);
  const statusOptions = [...new Set([...meta.data.statuses, object.status].filter(Boolean))];

  return (
    <div className="page sect st">
      {crumbs}
      <div className="head">
        <div>
          <h1>Ввод данных в отчёт</h1>
          <p className="lead">Факт — накопительно, с начала работ. Пустое поле — «не указано» (это не ноль).</p>
        </div>
        <label className="period-select">
          <span>Отчёт</span>
          <select value={reportId} onChange={(e) => go({ report: e.target.value })}>
            {openReports.map((r) => <option key={r.id} value={r.id}>{r.programName}: {reportLabel(r)}</option>)}
          </select>
        </label>
      </div>
      {compare && <div className="notice">Отчёт на {fdate(report.date)} заполнен значениями отчёта {fdate(compare.date)}. «Было» под полем — значение до ваших правок.</div>}

      <div className="input-layout">
        <nav className="addr-list" aria-label="Мои объекты">
          {myObjects.map((o) => (
            <button key={o.id} type="button" aria-current={o.id === object.id} onClick={() => go({ report: String(reportId), object: String(o.id) })}>
              <span>{o.short}{o.id === object.id && dirty && <span className="dirty"> •</span>}</span>
              <small>{o.status ?? 'статус не указан'} · {o.done} из {o.positions}</small>
            </button>
          ))}
        </nav>
        <div className="addr-picker">
          <label className="f">
            <span>Объект</span>
            <select value={object.id} onChange={(e) => go({ report: String(reportId), object: e.target.value })}>
              {myObjects.map((o) => <option key={o.id} value={o.id}>{o.short}</option>)}
            </select>
          </label>
        </div>

        <section className="items" aria-label="Данные объекта">
          <div className="item-h">
            <div>
              <b>{object.short}</b>
              <div className="sub">{object.okrug} · позиций выполнено: {dirty ? <>{pct(object.rate)} → <b>{pct(rate)}</b></> : pct(object.rate)} <StStatus status={object.status} complete={object.complete} /></div>
            </div>
            <Link className="sub" to={`/streets/${object.id}`}>Открыть карточку объекта →</Link>
          </div>

          <article className="item">
            <div className="item-h"><b>Статус и ресурсы</b><span className="sub">{object.enteredBy ? `последний ввод: ${object.enteredBy}` : 'значения перенесены из прошлого отчёта'}</span></div>
            <div className="fields res4">
              <div className="f">
                <label htmlFor="st-status">Статус</label>
                <select id="st-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="">— не указан —</option>
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {dirty && form.status !== original.status && <span className="was">было: {original.status || '—'}</span>}
              </div>
              {COUNT_FIELDS.map((f) => (
                <div key={f.key} className="f">
                  <label htmlFor={`st-${f.key}`}>{f.label}</label>
                  <input id={`st-${f.key}`} inputMode="numeric" value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} aria-invalid={errors[f.key] ? 'true' : undefined} />
                  {errors[f.key] ? <span className="err">{errors[f.key]}</span> : dirty && form[f.key] !== original[f.key] && <span className="was">было: {original[f.key] || '—'}</span>}
                </div>
              ))}
            </div>
          </article>

          <article className="item">
            <div className="item-h"><b>Объёмы работ</b><span className="sub">факт накопительно</span></div>
            {shownWorks.length === 0 && <p className="hint">У объекта нет проектных объёмов.</p>}
            {shownWorks.map((w) => {
              const v = object.values[w.id];
              const err = errors.facts[w.id];
              const changed = dirty && form.facts[w.id] !== original.facts[w.id];
              const typed = parseNumber(form.facts[w.id]);
              return (
                <div key={w.id} className={'st-row' + (changed ? ' changed' : '')}>
                  <div className="what">
                    <b>{w.name}</b>
                    <span>{w.unit ?? 'ед. не указана'}{v.df ? ` · за период ${v.df > 0 ? '+' : ''}${vol(v.df)}` : ''}</span>
                    {v.p > 0 && <ProgressBar pct={Math.min(100, ((Number.isNaN(typed) ? 0 : typed) / v.p) * 100)} />}
                  </div>
                  <div className="proj"><span className="sub">проект</span><br />{vol(v.p)}</div>
                  <div className="f">
                    <label htmlFor={`fact-${w.id}`}>Факт{w.unit ? `, ${w.unit}` : ''}</label>
                    <input id={`fact-${w.id}`} inputMode="decimal" value={form.facts[w.id]} onChange={(e) => setFact(w.id, e.target.value)} aria-invalid={err ? 'true' : undefined} />
                    {err ? <span className="err">{err}</span> : changed && <span className="was">было: {original.facts[w.id] || '—'}</span>}
                  </div>
                </div>
              );
            })}
          </article>
          {warns.length > 0 && <ul className="warns">{warns.map((x) => <li key={x}>⚠ {x}</li>)}</ul>}
        </section>
      </div>

      <div className="savebar" role="region" aria-label="Сохранение">
        <span className={'msg' + (message ? (message.ok ? ' ok' : ' err') : '')} role="status">
          {message ? message.text : dirty ? `Есть изменения${blocked ? ' · исправьте ошибки' : ''}` : 'Изменений нет'}
        </span>
        <div className="btns">
          <button type="button" className="btn" disabled={!dirty || save.isPending} onClick={() => { setDraft(null); setMessage(null); }}>Отменить</button>
          <button type="button" className="btn primary" disabled={!dirty || blocked || save.isPending} onClick={onSave}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}
