// =====================================================================
//  DynamicsChart — простой график «факт против плана» по отчётным периодам (SVG, без библиотек).
//  points: [{ label: '26.10', fact: 0.33, plan: 0.37, reported: true }]  (доли 0..1)
//  Сплошная линия — факт (цвет направления), пунктир — план. Пустой кружок — за период данных не вносили.
// =====================================================================

const W = 640;
const H = 220;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

// color — необязательный цвет линии факта. Если не задан, берётся цвет направления (--tc) от родителя.
// Важно не писать style={{ '--tc': 'var(--tc)' }}: переменная, ссылающаяся сама на себя, недействительна.
export default function DynamicsChart({ points, color, title = 'Динамика выполнения' }) {
  if (!points.length) return null;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v) => PAD.t + ih - Math.max(0, Math.min(1, v)) * ih;
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const last = points.at(-1);
  // Подписи по оси X: не больше ~8, чтобы не наезжали друг на друга
  const step = Math.max(1, Math.ceil(points.length / 8));

  return (
    <figure className="chart" style={color ? { '--tc': color } : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: последний период — факт ${Math.round(last.fact * 100)} %, план ${Math.round(last.plan * 100)} %`}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="ax">{v * 100}%</text>
          </g>
        ))}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) && (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" className="ax">{p.label}</text>
        ))}
        <path d={path('plan')} className="plan-line" />
        <path d={path('fact')} className="fact-line" />
        {points.map((p, i) => (
          <circle key={p.label} cx={x(i)} cy={y(p.fact)} r={3.5} className={p.reported === false ? 'pt empty' : 'pt'}>
            <title>{`${p.label}: факт ${Math.round(p.fact * 100)} %, план ${Math.round(p.plan * 100)} %${p.reported === false ? ' (данные не вносились)' : ''}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="chart-legend">
        <span><i className="lf" />факт</span>
        <span><i className="lp" />план</span>
        <span><i className="le" />за период не вносили</span>
      </figcaption>
    </figure>
  );
}
