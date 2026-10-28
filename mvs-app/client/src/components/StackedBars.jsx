// =====================================================================
//  StackedBars — столбики по дням из двух частей (SVG, без библиотек).
//  Например, люди на объекте: снизу — на здании, сверху — на благоустройстве.
//  points: [{ label: '23.10', a: 205, b: 10 }]; names: ['здание', 'благоустройство']
// =====================================================================

const W = 640;
const H = 180;
const PAD = { l: 40, r: 8, t: 10, b: 26 };

export default function StackedBars({ points, names = ['здание', 'благоустройство'], unit = 'чел.', title = 'По дням' }) {
  if (!points.length) return <p className="hint">Данных нет</p>;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = Math.max(1, ...points.map((p) => p.a + p.b));
  const nice = Math.ceil(max / 50) * 50 || 10;
  const bw = iw / points.length;
  const y = (v) => PAD.t + ih - (v / nice) * ih;
  const step = Math.max(1, Math.ceil(points.length / 8));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: последний день — ${points.at(-1).a + points.at(-1).b} ${unit}`}>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(nice * k)} y2={y(nice * k)} className="grid" />
            <text x={PAD.l - 6} y={y(nice * k) + 4} textAnchor="end" className="ax">{Math.round(nice * k)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <rect x={PAD.l + i * bw + bw * 0.15} width={bw * 0.7} y={y(p.a)} height={Math.max(0, y(0) - y(p.a))} className="bar-a">
              <title>{`${p.label}: ${names[0]} ${p.a}${names[1] ? `, ${names[1]} ${p.b}` : ''} ${unit}`}</title>
            </rect>
            {p.b > 0 && <rect x={PAD.l + i * bw + bw * 0.15} width={bw * 0.7} y={y(p.a + p.b)} height={Math.max(0, y(p.a) - y(p.a + p.b))} className="bar-b" />}
            {/* Подпись — каждые step столбиков и у последнего; соседнюю с последней пропускаем, чтобы не наезжали */}
            {((i % step === 0 && points.length - 1 - i >= step / 2) || i === points.length - 1) && <text x={PAD.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="ax">{p.label}</text>}
          </g>
        ))}
      </svg>
      <figcaption className="chart-legend">
        <span><i className="sq a" />{names[0]}</span>
        {/* Вторая часть столбика — только если она где-то есть (у замечаний её нет) */}
        {names[1] && points.some((p) => p.b > 0) && <span><i className="sq b" />{names[1]}</span>}
      </figcaption>
    </figure>
  );
}
