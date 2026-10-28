// =====================================================================
//  ColumnChart — столбики нескольких рядов РЯДОМ по периодам (SVG, без библиотек).
//  Например, прирост за неделю: «КС-2» и «Оплата» рядом в каждой неделе.
//
//  labels: ['26.10', …];  series: [{ name, color, values: [число] }];  format: v => '12'
// =====================================================================

const W = 640;
const PAD = { l: 52, r: 12, t: 12, b: 28 };

function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const k = max / p;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * p;
}

export default function ColumnChart({ labels, series, format = (v) => String(v), height = 240, title = 'По периодам', maxLabels = 8 }) {
  if (!labels.length) return null;
  const H = height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const slot = iw / labels.length;                 // ширина места под один период
  const bw = Math.max(2, (slot * 0.75) / series.length); // ширина одного столбика
  const y = (v) => PAD.t + ih - (Math.max(0, v) / top) * ih;
  const step = Math.max(1, Math.ceil(labels.length / maxLabels));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${series.map((s) => `${s.name} — ${format(s.values.at(-1) ?? 0)}`).join(', ')}`}>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(top * k)} y2={y(top * k)} className="grid" />
            <text x={PAD.l - 6} y={y(top * k) + 4} textAnchor="end" className="ax">{format(top * k)}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <g key={i}>
            {series.map((s, k) => (
              <rect key={s.name} x={PAD.l + i * slot + slot * 0.125 + k * bw} width={bw - 1} y={y(s.values[i])} height={Math.max(0, y(0) - y(s.values[i]))} fill={s.color} rx={1.5}>
                <title>{`${l}: ${s.name} — ${format(s.values[i])}`}</title>
              </rect>
            ))}
            {(i % step === 0 || i === labels.length - 1) && (i === labels.length - 1 || labels.length - 1 - i >= step / 2) && (
              <text x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="ax">{l}</text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => <span key={s.name}><i className="sq" style={{ background: s.color }} />{s.name}</span>)}
      </figcaption>
    </figure>
  );
}
