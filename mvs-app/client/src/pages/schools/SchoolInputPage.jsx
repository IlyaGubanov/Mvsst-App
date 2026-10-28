// =====================================================================
//  Ежедневный ввод по школе — для ответственных по своим школам.
//  Выполнение видов работ (накопительно: процентом или объёмом) и люди/техника за день.
//  Адрес: /schools/input?object=<id>&date=<ГГГГ-ММ-ДД> (дата — не позже сегодня, по умолчанию сегодня).
//  На сервер уходят только изменённые строки; запись за дату заменяет прежнюю за ту же дату.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSaveSchoolDay, useSchool, useSchoolsMeta, useSchoolsOverview } from '../../api/schools.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { ProgressBar } from '../../components/Period.jsx';
import { fdate, numberToInput, pct } from '../../utils/format.js';
import { SchStatus } from './ui.jsx';
import { fromForm, hasErrors, isChanged, previewFact, resToForm, toForm, validate, warnings, workValue } from './schoolForm.js';

const RES_FIELDS = [
  { key: 'people', label: 'Люди на здании, чел.' },
  { key: 'tech', label: 'Техника на здании, ед.' },
  { key: 'peopleLandscape', label: 'Люди на благоустройстве, чел.' },
  { key: 'techLandscape', label: 'Техника на благоустройстве, ед.' },
];

export default function SchoolInputPage() {
  const [params, setParams] = useSearchParams();
  const meta = useSchoolsMeta();
  const ov = useSchoolsOverview();
  const save = useSaveSchoolDay();

  const today = meta.data?.today;
  const date = params.get('date') && today && params.get('date') <= today ? params.get('date') : today;
  const mySchools = useMemo(() => (ov.data?.schools ?? []).filter((s) => s.canEdit), [ov.data]);
  const requested = Number(params.get('object'));
  const objectId = mySchools.some((s) => s.id === requested) ? requested : mySchools[0]?.id;
  const card = useSchool(objectId, date, { enabled: Boolean(objectId && date) });

  const works = card.data?.works;
  const resList = card.data?.resources;
  const dayRes = resList?.find((r) => r.date === date) ?? null;          // ресурсы, внесённые именно за эту дату
  const prevRes = resList?.filter((r) => r.date < date).at(-1) ?? null;  // последние до неё — для подсказки
  const original = useMemo(() => (works ? toForm(works, dayRes) : null), [works, dayRes]);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState(null);
  const form = draft ?? original;
  const errors = form ? validate(form, works) : { works: {}, res: {} };
  const dirty = Boolean(draft && original && isChanged(draft, original, works));
  const blocked = dirty && hasErrors(errors);

  useEffect(() => { setDraft(null); }, [objectId, date]);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (meta.isPending || ov.isPending) return <Loading />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (ov.isError) return <ErrorBox error={ov.error} onRetry={ov.refetch} />;

  const crumbs = (
    <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><Link to="/schools">Капремонт школ</Link><span>/</span><span>Ввод данных</span></nav>
  );
  if (!mySchools.length) {
    return (
      <div className="page sect sch">{crumbs}
        <div className="error-box"><h2>Нет школ для ввода</h2><p>Вы пока не назначены ответственным ни за одну школу. Обратитесь к администратору.</p></div>
      </div>
    );
  }

  const confirmLeave = () => !dirty || window.confirm('Есть несохранённые изменения. Перейти без сохранения?');
  const go = (next) => { if (confirmLeave()) { setParams(next, { replace: true }); setMessage(null); } };
  const chooseObject = (id) => go({ object: String(id), ...(date !== today ? { date } : {}) });
  const chooseDate = (v) => { if (v && v <= today) go({ object: String(objectId), ...(v !== today ? { date: v } : {}) }); };
  const edit = (fn) => { setMessage(null); setDraft((d) => fn(d ?? original)); };
  const setWork = (id, field, value) => edit((f) => ({ ...f, works: { ...f.works, [id]: { ...f.works[id], [field]: value } } }));
  const setRes = (key, value) => edit((f) => ({ ...f, res: { ...f.res, [key]: value } }));

  async function onSave() {
    try {
      const r = await save.mutateAsync({ date, objects: [fromForm(draft, original, works, objectId)] });
      setDraft(null);
      setMessage({ ok: true, text: `${r.message}. Показатели «Сводки» обновлены.` });
    } catch (err) {
      setMessage({ ok: false, text: err.details?.fields?.[0]?.message ?? err.message });
    }
  }

  const school = card.data?.school;
  const warns = dirty && form ? warnings(form, original, works) : [];
  const preview = form && works ? previewFact(form, works) : 0;
  const groups = works ? [...new Set(works.map((w) => w.group))] : [];
  const backdated = meta.data.lastProgressDate && date < meta.data.lastProgressDate;

  return (
    <div className="page sect sch">
      {crumbs}
      <div className="head">
        <div>
          <h1>Ввод данных за день</h1>
          <p className="lead">Выполнение — накопительно, с начала работ: процентом или фактическим объёмом. Люди и техника — на объекте в этот день.</p>
        </div>
        <div className="date-pick">
          <label htmlFor="inDate">Дата</label>
          <input id="inDate" type="date" value={date} max={today} onChange={(e) => chooseDate(e.target.value)} />
          {date !== today && <button type="button" className="btn" onClick={() => chooseDate(today)}>Сегодня</button>}
        </div>
      </div>
      {backdated && (
        <div className="notice warn">
          Вы вносите данные задним числом ({fdate(date)}). Значения ниже — на эту дату. Если по работе есть более поздние записи
          (последний ввод — {fdate(meta.data.lastProgressDate)}), текущее выполнение по ней не изменится — запись добавится в историю.
        </div>
      )}

      <div className="input-layout">
        <nav className="addr-list" aria-label="Мои школы">
          {mySchools.map((s) => (
            <button key={s.id} type="button" aria-current={s.id === objectId} onClick={() => chooseObject(s.id)}>
              <span>{s.short}{s.id === objectId && dirty && <span className="dirty"> •</span>}</span>
              <small>{pct(s.fact)} / план {pct(s.plan)}</small>
            </button>
          ))}
        </nav>
        <div className="addr-picker">
          <label className="f">
            <span>Школа</span>
            <select value={objectId} onChange={(e) => chooseObject(Number(e.target.value))}>
              {mySchools.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
            </select>
          </label>
        </div>

        <section className="items" aria-label="Данные школы">
          {card.isPending && <Loading text="Загружаем школу…" />}
          {card.isError && <ErrorBox error={card.error} onRetry={card.refetch} />}
          {school && form && (
            <>
              <div className="item-h">
                <div>
                  <b>{school.short}</b>
                  <div className="sub">
                    готовность на {fdate(date)}: {dirty ? <>{pct(school.fact, 1)} → <b>{pct(preview, 1)}</b></> : pct(school.fact, 1)} · план {pct(school.plan, 1)} <SchStatus status={school.status} dev={school.dev} />
                  </div>
                </div>
                <Link className="sub" to={`/schools/${objectId}${date !== today ? `?date=${date}` : ''}`}>Открыть карточку школы →</Link>
              </div>

              <article className={'item' + (dirty && JSON.stringify(form.res) !== JSON.stringify(original.res) ? ' changed' : '')}>
                <div className="item-h">
                  <b>Люди и техника за {fdate(date)}</b>
                  <span className="sub">{dayRes ? `внесено (${dayRes.source === 'manual' ? 'вручную' : 'перенос'})` : 'за эту дату ещё не вносились'}</span>
                </div>
                <div className="fields res4">
                  {RES_FIELDS.map((f) => (
                    <div key={f.key} className="f">
                      <label htmlFor={`r-${f.key}`}>{f.label}</label>
                      <input id={`r-${f.key}`} inputMode="numeric" value={form.res[f.key]} onChange={(e) => setRes(f.key, e.target.value)} aria-invalid={errors.res[f.key] ? 'true' : undefined} />
                      {errors.res[f.key] && <span className="err">{errors.res[f.key]}</span>}
                    </div>
                  ))}
                </div>
                {!dayRes && prevRes && (
                  <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => edit((fm) => ({ ...fm, res: resToForm(prevRes) }))}>
                    Те же, что за {fdate(prevRes.date)}: {prevRes.people + prevRes.peopleLandscape} чел. / {prevRes.tech + prevRes.techLandscape} ед.
                  </button>
                )}
              </article>

              {groups.map((g) => (
                <article key={g} className="item">
                  <div className="item-h"><b>{g}</b></div>
                  {works.filter((w) => w.group === g).map((w) => {
                    const f = form.works[w.id];
                    const o = original.works[w.id];
                    const err = errors.works[w.id] ?? {};
                    const v = workValue(w, f);
                    const byVolume = w.planVolume > 0 && String(f.fv).trim() !== '';
                    const changed = dirty && (f.pct !== o.pct || f.fv !== o.fv);
                    return (
                      <div key={w.id} className={'work-row' + (changed ? ' changed' : '')}>
                        <div className="what">
                          <b>{w.name}</b>
                          <span>
                            вес {pct(w.weight, 1)} · план на дату {pct(w.plan)}
                            {w.planVolume > 0 && ` · проект ${numberToInput(w.planVolume)} ${w.unit ?? ''}`}
                            {w.entryDate === date ? ' · за эту дату внесено' : w.entryDate ? ` · последний ввод ${fdate(w.entryDate)}` : ''}
                          </span>
                          <ProgressBar pct={(Number.isNaN(v.pct) ? 0 : v.pct) * 100} plan={w.plan * 100} />
                        </div>
                        <div className="f">
                          <label htmlFor={`p-${w.id}`}>Выполнено, %</label>
                          <input id={`p-${w.id}`} inputMode="decimal" disabled={byVolume}
                            value={byVolume ? (Number.isNaN(v.pct) ? '' : numberToInput(v.pct * 100)) : f.pct}
                            onChange={(e) => setWork(w.id, 'pct', e.target.value)} aria-invalid={err.pct ? 'true' : undefined} />
                          {err.pct ? <span className="err">{err.pct}</span> : changed && !byVolume && <span className="was">было: {o.pct} %</span>}
                        </div>
                        <div className="f">
                          {w.planVolume > 0 ? (
                            <>
                              <label htmlFor={`v-${w.id}`}>Факт, {w.unit ?? 'ед.'}</label>
                              <input id={`v-${w.id}`} inputMode="decimal" value={f.fv} placeholder="или процентом"
                                onChange={(e) => setWork(w.id, 'fv', e.target.value)} aria-invalid={err.fv ? 'true' : undefined} />
                              {err.fv ? <span className="err">{err.fv}</span> : changed && byVolume && <span className="was">было: {o.fv || '—'} {w.unit ?? ''}</span>}
                            </>
                          ) : <span className="sub">объём не задан — вводится процент</span>}
                        </div>
                      </div>
                    );
                  })}
                </article>
              ))}
              {warns.length > 0 && <ul className="warns">{warns.map((x) => <li key={x}>⚠ {x}</li>)}</ul>}
            </>
          )}
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
