// =====================================================================
//  DynamicsChart — график «факт против плана» (SVG, без библиотек).
//  points: [{ label: '26.10', fact: 0.33 | null, plan: 0.37, reported?: bool, t?: число }]  (доли 0..1)
//  • t — положение по оси X (например, дата в мс). Если не задано — точки идут равномерно.
//  • fact: null — в этой точке факта нет (линия факта её пропускает): так строится S-кривая,
//    где план есть на каждую неделю, а факт — только в дни ввода.
//  • markerT — вертикальная отметка «сегодня».
//  Сплошная линия — факт (цвет направления, --tc), пунктир — план. Пустой кружок — за период данных не вносили.
// =====================================================================

const W = 640;
const H = 220;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

// color — необязательный цвет линии факта. Если не задан, берётся цвет направления (--tc) от родителя.
// Важно не писать style={{ '--tc': 'var(--tc)' }}: переменная, ссылающаяся сама на себя, недействительна.
export default function DynamicsChart({ points, color, title = 'Динамика выполнения', markerT, markerLabel = 'сегодня', maxLabels = 8 }) {
  if (!points.length) return null;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const ts = points.map((p, i) => p.t ?? i);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const xt = (t) => PAD.l + (t1 === t0 ? iw / 2 : ((t - t0) * iw) / (t1 - t0));
  const x = (i) => xt(ts[i]);
  const y = (v) => PAD.t + ih - Math.max(0, Math.min(1, v)) * ih;
  const path = (key) => points
    .map((p, i) => [p, i]).filter(([p]) => p[key] != null)
    .map(([p, i], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const facts = points.filter((p) => p.fact != null);
  const last = facts.at(-1) ?? points.at(-1);
  // Подписи по оси X: не больше maxLabels, чтобы не наезжали друг на друга
  const step = Math.max(1, Math.ceil(points.length / maxLabels));

  return (
    <figure className="chart" style={color ? { '--tc': color } : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: последняя точка — факт ${Math.round((last.fact ?? 0) * 100)} %, план ${Math.round(last.plan * 100)} %`}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="ax">{v * 100}%</text>
          </g>
        ))}
        {/* Подписи: каждая step-я точка и последняя; соседнюю с последней пропускаем, чтобы не наезжали */}
        {points.map((p, i) => ((i % step === 0 && points.length - 1 - i >= step / 2) || i === points.length - 1) && (
          <text key={`${p.label}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" className="ax">{p.label}</text>
        ))}
        {markerT != null && markerT >= t0 && markerT <= t1 && (
          <g>
            <line x1={xt(markerT)} x2={xt(markerT)} y1={PAD.t} y2={PAD.t + ih} className="marker" />
            <text x={xt(markerT) + 4} y={PAD.t + 10} className="ax">{markerLabel}</text>
          </g>
        )}
        <path d={path('plan')} className="plan-line" />
        <path d={path('fact')} className="fact-line" />
        {points.map((p, i) => p.fact != null && (
          <circle key={`${p.label}-${i}`} cx={x(i)} cy={y(p.fact)} r={3.5} className={p.reported === false ? 'pt empty' : 'pt'}>
            <title>{`${p.label}: факт ${Math.round(p.fact * 100)} %, план ${Math.round(p.plan * 100)} %${p.reported === false ? ' (данные не вносились)' : ''}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="chart-legend">
        <span><i className="lf" />факт</span>
        <span><i className="lp" />план</span>
        {points.some((p) => p.reported === false) && <span><i className="le" />за период не вносили</span>}
      </figcaption>
    </figure>
  );
}
