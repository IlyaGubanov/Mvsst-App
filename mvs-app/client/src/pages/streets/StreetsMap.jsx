// =====================================================================
//  Вкладка «Карта» раздела «Благоустройство улиц» (/streets?tab=map).
//  Объекты выбранного отчёта — маркерами на карте OpenStreetMap (библиотека Leaflet):
//    красный «!» — есть замечания или факт снизился к отчёту сравнения;
//    жёлтый      — остались невыполненные объёмы;
//    зелёный     — выполнено.
//  Близкие маркеры объединяются в кружок с числом объектов (кластер): клик по нему
//  приближает карту. Клик по маркеру — подсказка со статусом и ссылкой на карточку объекта.
//  Объекты без координат — в списке «Местоположение уточняется» рядом с картой.
//
//  Файл подгружается только при открытии вкладки (React.lazy в StreetsPage.jsx),
//  поэтому Leaflet не утяжеляет остальные экраны.
//  Картинки подложки идут с tile.openstreetmap.org — этот адрес разрешён в CSP сервера
//  (server/src/app.js, только для картинок). Без интернета будут видны маркеры на сером фоне.
// =====================================================================

import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { plural } from '../../utils/format.js';
import { StStatus } from './ui.jsx';

// Цвет маркера: crit — замечания или снижение факта, warn — остаток объёмов, good — выполнено.
// Правило «остатка» то же, что у плитки «С остатком объёмов» на сводке.
const LEVELS = {
  crit: { name: 'замечания или факт снизился', rank: 3 },
  warn: { name: 'остаток объёмов', rank: 2 },
  good: { name: 'выполнено', rank: 1 },
};
export function markerLevel(o) {
  if (o.issue || o.remarks > 0) return 'crit';
  if (!o.complete && o.partial + o.missing > 0) return 'warn';
  return 'good';
}

const hasCoords = (o) => Number.isFinite(o.lat) && Number.isFinite(o.lon);
const CLUSTER_PX = 44;  // маркеры ближе этого расстояния (в точках экрана) объединяются
const MAX_ZOOM = 18;    // самое крупное приближение подложки OpenStreetMap
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function StreetsMap({ objects }) {
  const navigate = useNavigate();
  const placed = useMemo(() => objects.filter(hasCoords), [objects]);
  const unplaced = useMemo(() => objects.filter((o) => !hasCoords(o)).sort((a, b) => a.short.localeCompare(b.short, 'ru')), [objects]);
  const counts = useMemo(() => {
    const c = { crit: 0, warn: 0, good: 0 };
    objects.forEach((o) => { c[markerLevel(o)]++; });
    return c;
  }, [objects]);

  const boxRef = useRef(null);   // <div>, в который Leaflet рисует карту
  const mapRef = useRef(null);   // сама карта Leaflet
  const layerRef = useRef(null); // слой с маркерами — его перерисовываем при смене отчёта и масштаба
  // navigate меняется от рендера к рендеру; обработчики Leaflet берут свежий через ref
  const navRef = useRef(navigate);
  navRef.current = navigate;

  // 1. Создаём карту один раз при открытии вкладки и убираем при уходе с неё
  useEffect(() => {
    const map = L.map(boxRef.current, { zoomControl: true, maxZoom: MAX_ZOOM }).setView([55.75, 37.62], 10);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>');
    L.tileLayer(TILES, {
      maxZoom: MAX_ZOOM,
      // Правила OpenStreetMap требуют заголовок Referer. Сервер по умолчанию запрещает его
      // (Referrer-Policy: no-referrer), поэтому для картинок подложки отправляем только адрес сайта —
      // без пути и параметров страницы.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  // 2. Раскладываем маркеры: при смене отчёта и после каждого изменения масштаба
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const draw = () => drawMarkers(map, layerRef.current, placed, (to) => navRef.current(to));
    map.on('zoomend', draw);
    draw();
    return () => { map.off('zoomend', draw); };
  }, [placed]);

  // 3. Показываем все объекты целиком — только когда изменился сам набор объектов,
  //    чтобы при переключении на соседний отчёт карта не «прыгала»
  const placeKey = placed.map((o) => o.id).join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placed.length) return;
    map.fitBounds(L.latLngBounds(placed.map((o) => [o.lat, o.lon])), { padding: [36, 36], maxZoom: 15 });
  }, [placeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="st-map-wrap">
      <div className="legend-row" aria-label="Условные обозначения">
        {Object.entries(LEVELS).map(([k, l]) => (
          <span key={k}><i className={`st-dot ${k}`} aria-hidden="true">{k === 'crit' ? '!' : ''}</i> {l.name} · {counts[k]}</span>
        ))}
        <span><i className="st-dot cl" aria-hidden="true">3</i> несколько объектов рядом</span>
      </div>
      <div className="st-map-grid">
        <div ref={boxRef} className="st-map" role="region" aria-label={`Карта: ${placed.length} ${plural(placed.length, 'объект', 'объекта', 'объектов')}`} />
        <aside className="card st-unplaced" aria-labelledby="unH">
          <div className="sec-h"><h2 id="unH">Местоположение уточняется</h2><span className="hint">{unplaced.length}</span></div>
          {unplaced.length === 0 ? <p className="hint">Координаты есть у всех объектов отчёта</p> : (
            <ul>
              {unplaced.map((o) => (
                <li key={o.id}>
                  <i className={`st-dot ${markerLevel(o)}`} aria-hidden="true">{markerLevel(o) === 'crit' ? '!' : ''}</i>
                  <Link to={`/streets/${o.id}`} title={o.name}>{o.short}</Link>
                  <StStatus status={o.status} complete={o.complete} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Маркеры и кластеры
// ---------------------------------------------------------------------

/**
 * Объединяет близкие точки. Каждая точка — сначала отдельная группа; пока центры двух групп
 * ближе CLUSTER_PX на экране (при текущем масштабе), сливаем их в одну. Так кружки кластеров
 * не налезают друг на друга. Для 30–40 объектов это мгновенно (отдельный плагин не нужен).
 */
function cluster(map, list) {
  const zoom = map.getZoom();
  const groups = list.map((o) => {
    const p = map.project([o.lat, o.lon], zoom); // координаты точки на экране, в пикселях
    return { items: [o], x: p.x, y: p.y };
  });
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= CLUSTER_PX) continue;
        // центр новой группы — среднее всех её точек
        const n = a.items.length + b.items.length;
        a.x = (a.x * a.items.length + b.x * b.items.length) / n;
        a.y = (a.y * a.items.length + b.y * b.items.length) / n;
        a.items.push(...b.items);
        groups.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return groups.map((g) => g.items);
}

/** Самый тревожный цвет в группе: если хотя бы у одного объекта замечания — кластер красный. */
const worst = (group) => group.map(markerLevel).sort((a, b) => LEVELS[b].rank - LEVELS[a].rank)[0];

function drawMarkers(map, layer, list, go) {
  layer.clearLayers();
  cluster(map, list).forEach((g) => {
    const lat = g.reduce((s, o) => s + o.lat, 0) / g.length;
    const lon = g.reduce((s, o) => s + o.lon, 0) / g.length;
    if (g.length === 1) {
      const o = g[0];
      const lvl = markerLevel(o);
      L.marker([o.lat, o.lon], {
        icon: L.divIcon({ className: `st-mk ${lvl}`, html: lvl === 'crit' ? '!' : '', iconSize: [24, 24] }),
        title: o.short,
        keyboard: true,
      }).bindPopup(() => objectPopup(o, go), { maxWidth: 280 }).addTo(layer);
      return;
    }
    const m = L.marker([lat, lon], {
      icon: L.divIcon({ className: `st-mk cl ${worst(g)}`, html: String(g.length), iconSize: [34, 34] }),
      title: `${g.length} ${plural(g.length, 'объект', 'объекта', 'объектов')}`,
      keyboard: true,
    }).addTo(layer);
    // Клик по кластеру приближает карту к его объектам. Если они стоят в одной точке
    // (у двух записей один адрес) или приближать уже некуда — показываем список объектов
    // во всплывающей подсказке. Маркеры перерисовываются при каждом изменении масштаба,
    // поэтому решить это можно сразу, при рисовании.
    const bounds = L.latLngBounds(g.map((o) => [o.lat, o.lon]));
    const samePoint = bounds.getNorthEast().equals(bounds.getSouthWest());
    const target = Math.min(map.getBoundsZoom(bounds, false, L.point(40, 40)), MAX_ZOOM);
    if (samePoint || target <= map.getZoom()) m.bindPopup(() => clusterPopup(g, go), { maxWidth: 300 });
    else m.on('click', () => map.fitBounds(bounds, { padding: [40, 40], maxZoom: target }));
  });
}

// ---------------------------------------------------------------------
// Содержимое подсказок. Leaflet показывает обычные HTML-элементы, поэтому собираем их вручную;
// текст ставим через textContent — названия из базы не могут «сломать» разметку.
// ---------------------------------------------------------------------
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/** Ссылка на карточку объекта, открывается внутри приложения без перезагрузки страницы. */
function objectLink(o, go) {
  const a = el('a', 'st-pop-link', o.short);
  a.href = `/streets/${o.id}`;
  a.title = o.name;
  a.addEventListener('click', (e) => { e.preventDefault(); go(`/streets/${o.id}`); });
  return a;
}

function statusPill(o) {
  if (!o.status) return el('span', 'pill idle', 'статус не указан');
  return el('span', `pill ${o.complete ? 'good' : 'warn'}`, `${o.complete ? '✓ ' : ''}${o.status}`);
}

function objectPopup(o, go) {
  const box = el('div', 'st-pop');
  const title = el('div', 'st-pop-title');
  if (o.issue) title.append(el('span', 'bad', '! '));
  title.append(objectLink(o, go));
  box.append(title);
  if (o.okrug) box.append(el('div', 'sub', o.okrug));
  box.append(statusPill(o));
  const facts = [
    `Позиции: выполнено ${o.done} из ${o.positions}`,
    o.partial ? `с остатком — ${o.partial}` : null,
    o.missing ? `без факта — ${o.missing}` : null,
  ].filter(Boolean).join(', ');
  box.append(el('div', null, facts));
  box.append(el('div', o.remarks > 0 ? 'bad' : null, `Замечания: ${o.remarks ?? '—'}`));
  if (o.issue) box.append(el('div', 'bad', 'Факт снизился к отчёту сравнения'));
  const more = el('a', 'st-pop-more', 'Открыть карточку →');
  more.href = `/streets/${o.id}`;
  more.addEventListener('click', (e) => { e.preventDefault(); go(`/streets/${o.id}`); });
  box.append(more);
  return box;
}

function clusterPopup(group, go) {
  const box = el('div', 'st-pop');
  box.append(el('div', 'st-pop-title', `${group.length} ${plural(group.length, 'объект', 'объекта', 'объектов')} в этой точке`));
  const ul = el('ul', 'st-pop-list');
  group.forEach((o) => {
    const li = el('li');
    const lvl = markerLevel(o);
    li.append(el('i', `st-dot ${lvl}`, lvl === 'crit' ? '!' : ''), objectLink(o, go));
    ul.append(li);
  });
  box.append(ul);
  return box;
}
