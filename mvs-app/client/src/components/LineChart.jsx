// =====================================================================
//  LineChart — несколько линий по периодам (SVG, без библиотек). Для сумм и любых чисел,
//  в отличие от DynamicsChart (доли 0..1, «факт против плана»).
//
//  labels:  ['26.10', …]                         — подписи точек по оси X (по порядку)
//  series:  [{ name, color, values: [число|null], dash? }]
//  format:  v => '1 234'                          — подписи оси Y и всплывающих подсказок
//  marker:  индекс точки, отмеченной вертикальной линией («срез»)
//  max:     верх шкалы (например, 100 для процентов); без него — «круглое» число над максимумом
//  Пустое значение (null) линия пропускает.
// =====================================================================

const W = 640;
const PAD = { l: 52, r: 12, t: 12, b: 28 };

/** «Красивые» деления оси: 0, 500, 1000… */
function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const k = max / p;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * p;
}

export default function LineChart({ labels, series, format = (v) => String(v), marker, max, height = 260, title = 'График', maxLabels = 8 }) {
  if (!labels.length) return null;
  const H = height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const top = max ?? niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v != null))));
  const x = (i) => PAD.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v) => PAD.t + ih - (Math.max(0, v) / top) * ih;
  const path = (values) => values.map((v, i) => [v, i]).filter(([v]) => v != null)
    .map(([v, i], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  // Подписи по оси X — не чаще, чем через minGap точек экрана; последняя — всегда
  const minGap = iw / maxLabels;
  const shown = [];
  labels.forEach((_, i) => { if (!shown.length || x(i) - x(shown.at(-1)) >= minGap) shown.push(i); });
  if (shown.at(-1) !== labels.length - 1) { if (shown.length > 1 && x(labels.length - 1) - x(shown.at(-1)) < minGap) shown.pop(); shown.push(labels.length - 1); }

  return (
    <figure className="chart">
      {/* В подписи — последнее заполненное значение каждой линии (у будущих точек значений нет) */}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${series.map((s) => `${s.name} — ${format(s.values.filter((v) => v != null).at(-1) ?? 0)}`).join(', ')}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <g key={k}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(top * k)} y2={y(top * k)} className="grid" />
            <text x={PAD.l - 6} y={y(top * k) + 4} textAnchor="end" className="ax">{format(top * k)}</text>
          </g>
        ))}
        {shown.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={x(i) > W - PAD.r - 20 ? 'end' : 'middle'} className="ax">{labels[i]}</text>
        ))}
        {marker != null && marker >= 0 && (
          <g>
            <line x1={x(marker)} x2={x(marker)} y1={PAD.t} y2={PAD.t + ih} className="marker" />
            <text x={x(marker) + 4} y={PAD.t + 10} className="ax">срез</text>
          </g>
        )}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.dash ? 1.5 : 2.2} strokeDasharray={s.dash ? '5 4' : undefined} opacity={s.dash ? 0.8 : 1} />
        ))}
        {/* Невидимые полосы по точкам — подсказка со всеми значениями при наведении */}
        {labels.map((l, i) => (
          <rect key={i} x={x(i) - iw / labels.length / 2} y={PAD.t} width={iw / labels.length} height={ih} fill="transparent">
            <title>{`${l}\n${series.map((s) => `${s.name}: ${s.values[i] == null ? '—' : format(s.values[i])}`).join('\n')}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => (
          <span key={s.name}><i style={s.dash ? { borderTop: `1.5px dashed ${s.color}` } : { borderTopColor: s.color }} />{s.name}</span>
        ))}
      </figcaption>
    </figure>
  );
}
