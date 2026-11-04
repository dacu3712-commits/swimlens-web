import { newResult, unmeasured, event, trafficByRange, confidenceScore, stats, override, arm, worst } from "./base.js";
import { armEvents } from "./common.js";
import { angleSeries, nanargmin, nanmean } from "../signal/geometry.js";
import { peaks } from "../signal/events.js";
export const key = "knee_hip_kick", name = "무릎/골반 굴곡각 & 킥 타이밍";
export function ankleDepthSignal(ctx, side) {
  let d = ctx.wl.depth(side + "_ankle"); let nan = 0; for (const v of d) if (Number.isNaN(v)) nan++;
  if (nan / d.length > 0.5) { const l = ctx.wl.depth("left_ankle"), rr = ctx.wl.depth("right_ankle"); d = new Float64Array(l.length); for (let i = 0; i < d.length; i++) d[i] = nanmean([l[i], rr[i]]); }
  return d;
}
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.knee_hip_kick;
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const side = arm(ctx), lm = ctx.lm, fps = ctx.fps;
  const knee = angleSeries(lm, side + "_hip", side + "_knee", side + "_ankle"), hip = angleSeries(lm, side + "_shoulder", side + "_hip", side + "_knee");
  if (knee.every(Number.isNaN)) return unmeasured(key, name, "무릎·발목이 인식되지 않아 각도를 계산할 수 없습니다.");
  const ankleD = ankleDepthSignal(ctx, side);
  const beats = peaks(ankleD, fps, th.kick_peak_min_distance_sec ?? 0.15, 0.15, true);
  const isFly = ctx.settings.stroke === "butterfly", timingOn = isFly || !!th.freestyle_timing_enabled, matchMs = th.timing_match_ms ?? 100;
  const frames = [], kneeVals = [];
  for (const c of ctx.cycles.cycles) {
    let [fk, edited] = override(ctx, key, `c${c.index}_knee_min`, nanargmin(knee, c.start, c.end));
    const kv = fk !== null && !Number.isNaN(knee[fk]) ? knee[fk] : null, hv = fk !== null && !Number.isNaN(hip[fk]) ? hip[fk] : null;
    const row = { cycle: c.index + 1, knee_min_frame: fk, knee_angle: kv, hip_angle: hv, traffic: trafficByRange(kv, th.knee_green, th.knee_yellow_margin, th.knee_red_below) };
    const inCycle = beats.filter(b => b >= c.start && b < c.end); row.kicks_in_cycle = inCycle.length; row.kick_frames = inCycle;
    if (fk !== null) { frames.push(fk); kneeVals.push(kv); r.events.push(event(`c${c.index}_knee_min`, `사이클 ${c.index + 1} 무릎 최대 접힘`, fk, c.index, "knee_min", [side + "_hip", side + "_knee", side + "_ankle"], edited)); }
    if (timingOn) {
      const ev = armEvents(ctx, c.index, c.start, c.end, side, "split_time"); const window = Math.floor(0.45 * fps);
      for (const [tag, handF] of [["entry", ev.entry], ["exit", ev.exit]]) {
        if (handF === null) { row[tag + "_kick_diff_ms"] = null; continue; }
        const cands = beats.filter(b => Math.abs(b - handF) <= window); let kf = cands.length ? cands.reduce((a, b) => Math.abs(b - handF) < Math.abs(a - handF) ? b : a) : null;
        const [kf2, ked] = override(ctx, key, `c${c.index}_${tag}_kick`, kf); kf = kf2;
        if (kf !== null) { const diff = (kf - handF) / fps * 1000; row[tag + "_kick_frame"] = kf; row[tag + "_kick_diff_ms"] = diff; row[tag + "_timing"] = Math.abs(diff) <= matchMs ? "일치" : diff > 0 ? "킥이 늦음" : "킥이 빠름"; r.events.push(event(`c${c.index}_${tag}_kick`, `사이클 ${c.index + 1} ${tag === "entry" ? "입수킥" : "출수킥"} 다운비트`, kf, c.index, tag + "_kick", [side + "_ankle"], ked)); }
        else { row[tag + "_kick_diff_ms"] = null; row[tag + "_timing"] = "킥 미검출"; }
      }
    }
    r.per_cycle.push(row);
  }
  const st = stats(kneeVals), hst = stats(r.per_cycle.map(p => p.hip_angle));
  r.summary = { knee_mean: st.mean, knee_std: st.std, hip_mean: hst.mean, n: st.n, knee_green: th.knee_green, kicks_per_cycle_mean: r.per_cycle.reduce((a, p) => a + p.kicks_in_cycle, 0) / r.per_cycle.length, timing_enabled: timingOn };
  let light = trafficByRange(st.mean, th.knee_green, th.knee_yellow_margin, th.knee_red_below);
  if (timingOn) for (const tag of ["entry", "exit"]) { const diffs = r.per_cycle.map(p => p[tag + "_kick_diff_ms"]).filter(v => v !== null && v !== undefined); r.summary[tag + "_kick_diff_ms_mean"] = diffs.length ? diffs.reduce((a, b) => a + b) / diffs.length : null; if (diffs.length) { const m = Math.abs(r.summary[tag + "_kick_diff_ms_mean"]); light = worst(light, m <= matchMs ? "green" : m <= 2 * matchMs ? "yellow" : "red"); } }
  r.traffic = light;
  r.confidence = confidenceScore(ctx, [side + "_hip", side + "_knee", side + "_ankle"], frames);
  if (!isFly) r.notes.push(`자유형: 사이클당 평균 킥 ${r.summary.kicks_per_cycle_mean.toFixed(1)}회 (참고). 킥 타이밍 판정은 접영에서만 수행합니다.`);
  r.charts.push({ type: "bar", title: "사이클별 킥 직전 무릎 각도", ylabel: "각도 (°)", values: kneeVals, labels: r.per_cycle.map(p => String(p.cycle)), green: th.knee_green, yellowMargin: th.knee_yellow_margin });
  const t = lm.t; const evs = beats.map(b => ({ x: t[b], label: "킥 다운비트", color: "orange" }));
  if (timingOn) for (const c of ctx.cycles.cycles) { const ev = armEvents(ctx, c.index, c.start, c.end, side); evs.push({ x: t[ev.entry], label: "손 입수", color: "blue" }); if (ev.exit !== null) evs.push({ x: t[ev.exit], label: "손 출수", color: "red" }); }
  r.charts.push({ type: "line", title: "손·발 이벤트 타임라인", ylabel: "발목 깊이 (px)", y2label: "무릎 각도 (°)", t: Array.from(t), series: [{ name: "발목 깊이(px, 아래 +)", data: Array.from(ankleD) }], series2: [{ name: "무릎 각도(°)", data: Array.from(knee) }], events: evs });
  for (const p of r.per_cycle.slice(0, 4)) if (p.knee_min_frame !== null) r.captures.push({ frame: p.knee_min_frame, label: `무릎 최대 접힘 — 사이클 ${p.cycle}`, caption: p.knee_angle !== null ? `사이클 ${p.cycle} 무릎 ${p.knee_angle.toFixed(0)}°` : "", angle: { joints: [side + "_hip", side + "_knee", side + "_ankle"], value: p.knee_angle }, highlight: [side + "_knee"], extra: p.hip_angle !== null ? [`골반 각도 ${p.hip_angle.toFixed(0)}°`] : [] });
  return r;
}
