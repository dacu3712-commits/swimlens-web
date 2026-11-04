import { newResult, unmeasured, event, trafficByMax, confidenceScore, stats, override, arm, worst } from "./base.js";
import { armEvents } from "./common.js";
import { angleAt, nanargmax, meanOf } from "../signal/geometry.js";
export const key = "streamline", name = "유선형 유지력";
function headCenter(wl, i) { const e = meanOf([[wl.fwd("left_ear")[i], wl.depth("left_ear")[i]], [wl.fwd("right_ear")[i], wl.depth("right_ear")[i]]]); return Number.isNaN(e[0]) ? [wl.fwd("nose")[i], wl.depth("nose")[i]] : e; }
function bodyLineAngle(h, p, a) {   // 세 점의 주축 각도(°), 머리→발 방향으로 깊이가 늘면 +
  if ([h, p, a].some(q => Number.isNaN(q[0]) || Number.isNaN(q[1]))) return NaN;
  const mx = (h[0] + p[0] + a[0]) / 3, my = (h[1] + p[1] + a[1]) / 3; let sxx = 0, sxy = 0, syy = 0;
  for (const q of [h, p, a]) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  let dx, dy; if (Math.abs(sxy) > 1e-12) { dx = l1 - syy; dy = sxy; } else if (sxx >= syy) { dx = 1; dy = 0; } else { dx = 0; dy = 1; }
  const nrm = Math.hypot(dx, dy) || 1; dx /= nrm; dy /= nrm;
  if ((a[0] - h[0]) * dx + (a[1] - h[1]) * dy < 0) { dx = -dx; dy = -dy; }
  return Math.atan2(dy, Math.abs(dx) || 1e-9) * 180 / Math.PI;
}
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.streamline, side = arm(ctx), wl = ctx.wl, fps = ctx.fps, n = wl.n;
  const frontal = ctx.settings.view === "front" || ctx.settings.view === "back";
  let ankleNan = 0; for (const v of wl.depth(side + "_ankle")) if (Number.isNaN(v)) ankleNan++; const useBoth = ankleNan / n > 0.7;
  const bodyLen = new Float64Array(n), sink = new Float64Array(n), bend = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const head = headCenter(wl, i);
    const hip = frontal ? meanOf([[wl.fwd("left_hip")[i], wl.depth("left_hip")[i]], [wl.fwd("right_hip")[i], wl.depth("right_hip")[i]]]) : [wl.fwd(side + "_hip")[i], wl.depth(side + "_hip")[i]];
    const ankle = useBoth ? meanOf([[wl.fwd("left_ankle")[i], wl.depth("left_ankle")[i]], [wl.fwd("right_ankle")[i], wl.depth("right_ankle")[i]]]) : [wl.fwd(side + "_ankle")[i], wl.depth(side + "_ankle")[i]];
    const sh = [wl.fwd(side + "_shoulder")[i], wl.depth(side + "_shoulder")[i]];
    bodyLen[i] = Math.hypot(sh[0] - ankle[0], sh[1] - ankle[1]); sink[i] = bodyLineAngle(head, hip, ankle); bend[i] = 180 - angleAt(head[0], head[1], hip[0], hip[1], ankle[0], ankle[1]);
  }
  const windows = [];
  if (ctx.cycles.cycles.length) {
    const first = ctx.cycles.cycles[0]; if (first.start > Math.floor(0.3 * fps)) windows.push(["시작 글라이드", 0, first.start, null]);
    for (const c of ctx.cycles.cycles) { const ev = armEvents(ctx, c.index, c.start, c.end, side); const end = ev.catch_start !== null && ev.catch_start > c.start + 2 ? ev.catch_start : Math.min(c.end, c.start + Math.floor(0.3 * fps)); windows.push([`사이클 ${c.index + 1} 글라이드`, c.start, end, c.index]); }
  } else windows.push(["전체 구간", 0, n, null]);
  const frames = [], sinkVals = [];
  for (const [label, a, b, cyc] of windows) {
    const evId = `w${cyc === null ? "pre" : cyc}_streamline`; let [f, edited] = override(ctx, key, evId, nanargmax(bodyLen, a, Math.max(b, a + 1)));
    if (f === null || Number.isNaN(sink[f])) continue;
    const sv = sink[f], bv = Number.isNaN(bend[f]) ? null : bend[f];
    r.per_cycle.push({ window: label, cycle: cyc === null ? null : cyc + 1, frame: f, sink_angle: sv, hip_bend: bv, traffic: trafficByMax(Math.abs(sv), th.sink_angle_green_max, th.sink_angle_yellow_max) });
    frames.push(f); sinkVals.push(Math.abs(sv)); r.events.push(event(evId, `${label} 최대 신전`, f, cyc, "streamline", ["nose", side + "_hip", side + "_ankle"], edited));
  }
  if (!r.per_cycle.length) return unmeasured(key, name, "머리·골반·발목이 함께 보이는 글라이딩 프레임을 찾지 못했습니다.");
  const st = stats(sinkVals), bst = stats(r.per_cycle.map(p => p.hip_bend));
  r.summary = { sink_angle_mean: st.mean, sink_angle_max: st.max, hip_bend_mean: bst.mean, n: st.n, green_max: th.sink_angle_green_max, yellow_max: th.sink_angle_yellow_max };
  let light = trafficByMax(st.mean, th.sink_angle_green_max, th.sink_angle_yellow_max);
  if (bst.mean !== null) { light = worst(light, trafficByMax(Math.abs(bst.mean), th.hip_bend_yellow_deg, th.hip_bend_red_deg)); if (Math.abs(bst.mean) > th.hip_bend_yellow_deg) r.notes.push(`골반이 머리–발목 직선에서 평균 ${Math.abs(bst.mean).toFixed(0)}° 꺾여 있습니다.`); }
  r.traffic = light; r.confidence = confidenceScore(ctx, ["nose", side + "_hip", side + "_ankle", side + "_shoulder"], frames);
  r.charts.push({ type: "bar", title: "구간별 하체 가라앉음 각도 (+ = 발이 머리보다 깊음)", ylabel: "각도 (°)", values: r.per_cycle.map(p => p.sink_angle), labels: r.per_cycle.map(p => p.window.replace(" 글라이드", "")), green: [-th.sink_angle_green_max, th.sink_angle_green_max], yellowMargin: th.sink_angle_yellow_max - th.sink_angle_green_max });
  let worstP = r.per_cycle[0]; for (const p of r.per_cycle) if (Math.abs(p.sink_angle) > Math.abs(worstP.sink_angle)) worstP = p;
  for (const p of r.per_cycle.slice(0, 4)) r.captures.push({ frame: p.frame, label: `유선형 — ${p.window}`, caption: `${p.window} ${p.sink_angle.toFixed(1)}°`, lines: [["nose", side + "_ankle"]], highlight: [side + "_hip"], extra: [`하체 가라앉음 ${p.sink_angle.toFixed(1)}°` + (p.hip_bend !== null ? `, 골반 꺾임 ${p.hip_bend.toFixed(1)}°` : "")], primary: p === worstP });
  return r;
}
