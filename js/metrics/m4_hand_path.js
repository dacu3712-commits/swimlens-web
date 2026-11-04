import { newResult, unmeasured, event, confidenceScore, stats, override, arm } from "./base.js";
import { armEvents } from "./common.js";
import { nanmedian } from "../signal/geometry.js";
export const key = "hand_path", name = "손 물속 궤적";
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.hand_path, view = ctx.settings.view;
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const sideView = view === "side_under" || view === "side_above";
  const sides = (["butterfly", "breaststroke"].includes(ctx.settings.stroke) || !sideView) ? ["left", "right"] : [arm(ctx)];
  const wl = ctx.wl, mpp = ctx.frame2d.m_per_px; const paths = [], frames = [];
  let shoulderW = null; if (!sideView) { const a = wl.fwd("left_shoulder"), b = wl.fwd("right_shoulder"), d = new Float64Array(wl.n); for (let i = 0; i < wl.n; i++) d[i] = Math.abs(a[i] - b[i]); shoulderW = nanmedian(d); }
  for (const c of ctx.cycles.cycles) for (const side of sides) {
    const wf = wl.fwd(side + "_wrist"), wd = wl.depth(side + "_wrist"), sf = wl.fwd(side + "_shoulder"), sd = wl.depth(side + "_shoulder");
    let a = c.start, b = c.end; if (sideView) { const ev = armEvents(ctx, c.index, c.start, c.end, side); b = ev.exit ?? c.end; }
    const rel = []; let okCount = 0; for (let i = a; i < b; i++) { const x = wf[i] - sf[i], y = wd[i] - sd[i]; const ok = !Number.isNaN(x) && !Number.isNaN(y); if (ok) okCount++; rel.push([x, y, ok]); }
    if (okCount < 5) continue;
    const row = { cycle: c.index + 1, side, start: a, end: b };
    if (sideView) {
      let fdeep = null, md = -Infinity; rel.forEach((p, k) => { if (p[2] && p[1] > md) { md = p[1]; fdeep = a + k; } });
      const [fd2, ed] = override(ctx, key, `c${c.index}_${side}_deepest`, fdeep); fdeep = fd2;
      row.deepest_frame = fdeep; row.max_depth_px = fdeep !== null && fdeep - a >= 0 && fdeep - a < rel.length ? rel[fdeep - a][1] : null; row.max_depth_m = mpp && row.max_depth_px ? row.max_depth_px * mpp : null;
      const cls = []; let press = 0, pull = 0; for (let k = 0; k + 1 < rel.length; k++) { const dx = rel[k + 1][0] - rel[k][0], dy = rel[k + 1][1] - rel[k][1]; let c2 = null; if (!Number.isNaN(dx) && !Number.isNaN(dy)) { if (dy > Math.abs(dx)) c2 = "press"; else if (dx < 0 && Math.abs(dx) >= Math.abs(dy)) c2 = "pull"; } cls.push(c2); if (c2 === "press") press++; if (c2 === "pull") pull++; }
      row.press_ratio = cls.length ? press / cls.length : 0; row.pull_ratio = cls.length ? pull / cls.length : 0;
      paths.push({ pts: rel.map(p => [p[0], p[1]]), classes: cls }); frames.push(fdeep);
      r.events.push(event(`c${c.index}_${side}_deepest`, `사이클 ${c.index + 1} 손 최저점`, fdeep, c.index, "deepest", [side + "_wrist"], ed));
    } else {
      const cl = wl.fwd("left_shoulder"), cr = wl.fwd("right_shoulder"); const lat = []; for (let i = a; i < b; i++) { const cx = (cl[i] + cr[i]) / 2; lat.push(wf[i] - cx); }
      const sign = nanmedian(lat) >= 0 ? 1 : -1; const inward = lat.map((v, k) => rel[k][2] ? sign * v : NaN);
      let fin = null, mn = Infinity; inward.forEach((v, k) => { if (!Number.isNaN(v) && v < mn) { mn = v; fin = a + k; } });
      const [fin2, ed] = override(ctx, key, `c${c.index}_${side}_inmost`, fin); fin = fin2;
      row.inmost_frame = fin; row.inward_min_px = fin !== null && fin - a >= 0 && fin - a < inward.length ? inward[fin - a] : null;
      row.crossover = !!(row.inward_min_px !== null && shoulderW && row.inward_min_px < -(th.crossover_margin_ratio ?? 0.05) * shoulderW);
      paths.push({ pts: rel.map((p, k) => [inward[k], p[1]]).filter(p => !Number.isNaN(p[0]) && !Number.isNaN(p[1])), classes: null }); frames.push(fin);
      r.events.push(event(`c${c.index}_${side}_inmost`, `사이클 ${c.index + 1} 최대 안쪽 진입`, fin, c.index, "inmost", [side + "_wrist"], ed));
    }
    r.per_cycle.push(row);
  }
  if (!r.per_cycle.length) return unmeasured(key, name, "손목 궤적을 충분히 인식하지 못했습니다.");
  const s = { n: r.per_cycle.length };
  if (sideView) {
    const d = stats(r.per_cycle.map(p => p.max_depth_px)); s.max_depth_px_mean = d.mean; s.max_depth_m_mean = mpp && d.mean ? d.mean * mpp : null;
    s.depth_str = s.max_depth_m_mean ? `${(s.max_depth_m_mean * 100).toFixed(0)}cm` : d.mean ? `${d.mean.toFixed(0)}px(거리 보정 없음)` : "-"; s.inward_str = "측면 구도에서는 측정 불가";
    s.press_ratio_mean = r.per_cycle.reduce((a, p) => a + p.press_ratio, 0) / r.per_cycle.length; s.pull_ratio_mean = r.per_cycle.reduce((a, p) => a + p.pull_ratio, 0) / r.per_cycle.length; r.traffic = "info";
  } else {
    const iw = stats(r.per_cycle.map(p => p.inward_min_px)); s.inward_min_px_mean = iw.mean;
    s.inward_str = (mpp && iw.mean !== null ? `${(iw.mean * mpp * 100).toFixed(0)}cm` : iw.mean !== null ? `${iw.mean.toFixed(0)}px` : "-") + " (중심선 기준, 음수면 넘어감)"; s.depth_str = "정면/바닥 구도에서는 측정 불가";
    s.crossover = r.per_cycle.some(p => p.crossover); r.traffic = s.crossover && (th.crossover_yellow ?? true) ? "yellow" : "info";
    if (s.crossover) r.notes.push("손이 몸 중심선을 넘어 들어오는 사이클이 있습니다(크로스오버).");
  }
  r.summary = s; r.confidence = confidenceScore(ctx, sides.flatMap(sd => [sd + "_wrist", sd + "_shoulder"]), frames.filter(f => f !== null));
  r.charts.push({ type: "path", title: sideView ? "손 궤적 (사이클 겹침, 어깨 기준)" : "손 궤적 (정면, 중심선 기준)", xlabel: sideView ? "앞(+) ← 뒤(−)" : "바깥(+) ← 안쪽/중심선(0)", ylabel: "깊이", paths, m_per_px: mpp });
  const p0 = r.per_cycle[0], f = p0.deepest_frame ?? p0.inmost_frame;
  if (f !== null && f !== undefined) r.captures.push({ frame: f, label: sideView ? "손 최저점 — 사이클 1" : "최대 안쪽 진입 — 사이클 1", caption: "사이클 1 " + (sideView ? "손 최저점" : "최대 안쪽 진입"), highlight: [p0.side + "_wrist"] });
  return r;
}
