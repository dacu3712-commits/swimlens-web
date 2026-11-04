// Chart.js 로 지표 그래프를 오프스크린 캔버스에 그려 dataURL 반환 (화면에도 같은 캔버스 사용 가능)
const C = { green: "#2e9e5b", yellow: "#e3b505", red: "#d64545", blue: "#3a6fb0", orange: "#e07b39", gray: "#777", info: "#4a7fc1" };
const PHASE = { "글라이드": "#b8c7dc", "캐치": "#3a6fb0", "풀": "#d64545", "피니시": "#e07b39", "리커버리": "#9ccf8f" };
function canvasFor(w, h) { const c = document.createElement("canvas"); c.width = w * 2; c.height = h * 2; c.style.width = w + "px"; c.style.height = h + "px"; return c; }
const base = (title) => ({ responsive: false, animation: false, devicePixelRatio: 2, plugins: { title: { display: true, text: title, font: { size: 14, family: "Noto Sans KR" } }, legend: { labels: { font: { family: "Noto Sans KR", size: 10 } } } }, font: { family: "Noto Sans KR" } });
const bandPlugin = { id: "band", beforeDraw(chart, _a, o) { if (!o || !o.green) return; const { ctx, chartArea: ca, scales: { y } } = chart; const [lo, hi] = o.green; ctx.save(); ctx.fillStyle = "rgba(46,158,91,0.15)"; ctx.fillRect(ca.left, y.getPixelForValue(hi), ca.width, y.getPixelForValue(lo) - y.getPixelForValue(hi)); if (o.yellowMargin) { ctx.fillStyle = "rgba(227,181,5,0.12)"; ctx.fillRect(ca.left, y.getPixelForValue(hi + o.yellowMargin), ca.width, y.getPixelForValue(hi) - y.getPixelForValue(hi + o.yellowMargin)); ctx.fillRect(ca.left, y.getPixelForValue(lo), ca.width, y.getPixelForValue(lo - o.yellowMargin) - y.getPixelForValue(lo)); } ctx.restore(); } };
const vlinePlugin = { id: "vlines", afterDraw(chart, _a, o) { if (!o || !o.events) return; const { ctx, chartArea: ca, scales: { x } } = chart; ctx.save(); for (const e of o.events) { const px = x.getPixelForValue(e.x); if (px < ca.left || px > ca.right) continue; ctx.strokeStyle = C[e.color] || e.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke(); } ctx.setLineDash([]); for (const [a, b] of o.shade || []) { const p0 = Math.max(ca.left, x.getPixelForValue(a)), p1 = Math.min(ca.right, x.getPixelForValue(b)); ctx.fillStyle = "rgba(74,127,193,0.15)"; ctx.fillRect(p0, ca.top, p1 - p0, ca.height); } ctx.restore(); } };
export function renderChart(spec, width = 640) {
  const Chart = window.Chart; if (!Chart) throw new Error("Chart.js 가 로드되지 않았습니다");
  let chart, canvas;
  if (spec.type === "bar") {
    canvas = canvasFor(width, 300);
    chart = new Chart(canvas, { type: "bar", data: { labels: spec.labels, datasets: [{ data: spec.values.map(v => v === null ? NaN : v), backgroundColor: (spec.sides || []).map(s => s === "left" ? C.orange : C.blue).concat(Array(spec.values.length).fill(C.blue)).slice(0, spec.values.length) }] }, options: { ...base(spec.title), plugins: { ...base(spec.title).plugins, legend: { display: false }, band: { green: spec.green, yellowMargin: spec.yellowMargin } }, scales: { y: { title: { display: true, text: spec.ylabel } }, x: { title: { display: true, text: "사이클" } } } }, plugins: [bandPlugin] });
  } else if (spec.type === "timeline") {
    canvas = canvasFor(width, 70 + 36 * spec.rows.length); const phases = Object.keys(PHASE);
    chart = new Chart(canvas, { type: "bar", data: { labels: spec.rows.map(r => r.label), datasets: phases.map(ph => ({ label: ph, data: spec.rows.map(r => r.phases[ph] ?? 0), backgroundColor: PHASE[ph], borderColor: "#fff", borderWidth: 1 })) }, options: { ...base(spec.title), indexAxis: "y", scales: { x: { stacked: true, title: { display: true, text: "시간 (초)" } }, y: { stacked: true } } } });
  } else if (spec.type === "line") {
    canvas = canvasFor(width, 300); const colors = [C.blue, C.gray, C.green];
    const datasets = spec.series.map((s, i) => ({ label: s.name, data: s.data.map((v, k) => ({ x: spec.t[k], y: Number.isNaN(v) ? null : v })), borderColor: colors[i % colors.length], borderWidth: 1.4, pointRadius: 0, yAxisID: "y", spanGaps: false }));
    (spec.series2 || []).forEach(s => datasets.push({ label: s.name, data: s.data.map((v, k) => ({ x: spec.t[k], y: Number.isNaN(v) ? null : v })), borderColor: C.orange, borderWidth: 1.2, pointRadius: 0, yAxisID: "y2" }));
    (spec.hlines || []).forEach(h => datasets.push({ label: h.label || "", data: [{ x: spec.t[0], y: h.y }, { x: spec.t[spec.t.length - 1], y: h.y }], borderColor: C.gray, borderDash: [2, 2], borderWidth: 0.8, pointRadius: 0, yAxisID: "y" }));
    const scales = { x: { type: "linear", title: { display: true, text: "시간 (초)" } }, y: { title: { display: true, text: spec.ylabel } } }; if (spec.series2) scales.y2 = { position: "right", title: { display: true, text: spec.y2label || "" }, grid: { drawOnChartArea: false } };
    chart = new Chart(canvas, { type: "line", data: { datasets }, options: { ...base(spec.title), plugins: { ...base(spec.title).plugins, vlines: { events: spec.events, shade: spec.shade } }, scales }, plugins: [vlinePlugin] });
  } else if (spec.type === "path") {
    canvas = canvasFor(width, 420); const k = spec.m_per_px || 1; const datasets = [];
    const COLS = { press: C.blue, pull: C.red, other: "#bbbbbb" }, NAMES = { press: "누르기(아래로)", pull: "당기기(뒤로)", other: "기타" }; const seen = new Set();
    spec.paths.forEach((p, pi) => {
      const pts = p.pts.map(q => (Number.isNaN(q[0]) || Number.isNaN(q[1])) ? null : { x: q[0] * k, y: q[1] * k });
      if (p.classes) { // 같은 분류가 이어지는 구간마다 데이터셋 하나
        let i = 0; while (i + 1 < pts.length) { const c = p.classes[i] || "other"; let j = i; const seg = []; while (j + 1 < pts.length && (p.classes[j] || "other") === c && pts[j] && pts[j + 1]) { if (!seg.length) seg.push(pts[j]); seg.push(pts[j + 1]); j++; } if (seg.length >= 2) { datasets.push({ label: seen.has(c) ? "" : NAMES[c], data: seg, borderColor: COLS[c], borderWidth: 1.6, pointRadius: 0, showLine: true }); seen.add(c); } i = Math.max(j, i + 1); }
      } else datasets.push({ label: `사이클 ${pi + 1}`, data: pts.filter(Boolean), borderWidth: 1.2, pointRadius: 0, showLine: true });
    });
    chart = new Chart(canvas, { type: "scatter", data: { datasets }, options: { ...base(spec.title), plugins: { ...base(spec.title).plugins, legend: { labels: { filter: it => it.text, font: { family: "Noto Sans KR", size: 10 } } } }, scales: { x: { title: { display: true, text: spec.xlabel + (spec.m_per_px ? " [m]" : " [px]") } }, y: { reverse: true, title: { display: true, text: spec.ylabel + (spec.m_per_px ? " [m]" : " [px]") } } } } });
  }
  const url = canvas.toDataURL("image/png"); chart.destroy(); return url;
}
