import { newResult, unmeasured, event, confidenceScore, override, arm, worst } from "./base.js";
import { armEvents } from "./common.js";
export const key = "split_time", name = "구간별 소요 시간";
export const PHASES = ["글라이드", "캐치", "풀", "피니시", "리커버리"];
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.split_time;
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const sides = ctx.settings.stroke === "butterfly" ? ["left", "right"] : [arm(ctx)]; const fps = ctx.fps; const frames = [];
  for (const c of ctx.cycles.cycles) for (const side of sides) {
    const ev = armEvents(ctx, c.index, c.start, c.end, side, key);
    const pts = [ev.entry, ev.catch_start, ev.catch_end, ev.pull_to_finish, ev.exit, ev.next_entry];
    const fixed = [pts[0]]; for (const p of pts.slice(1)) { const mx = Math.max(...fixed.filter(x => x !== null)); fixed.push(p !== null && p >= mx ? p : null); }
    const durations = {}; PHASES.forEach((ph, i) => { const a = fixed[i], b = fixed[i + 1]; durations[ph] = a !== null && b !== null ? (b - a) / fps : null; });
    const total = (ev.next_entry - ev.entry) / fps; const ratios = {}; for (const ph of PHASES) ratios[ph] = durations[ph] === null ? null : durations[ph] / total * 100;
    r.per_cycle.push({ cycle: c.index + 1, side, cycle_sec: total, durations, ratios, events: { entry: ev.entry, catch_start: ev.catch_start, catch_end: ev.catch_end, pull_to_finish: ev.pull_to_finish, exit: ev.exit, next_entry: ev.next_entry } });
    const tag = sides.length === 1 ? "" : side === "left" ? "왼팔 " : "오른팔 ";
    for (const [nm, lab] of [["catch_start", "캐치 시작"], ["catch_end", "캐치 끝(풀 시작)"], ["pull_to_finish", "풀→피니시 전환"], ["exit", "출수"]]) {
      const f = ev[nm]; if (f !== null) { frames.push(f); const [, ed] = override(ctx, key, `c${c.index}_${nm}`, null); r.events.push(event(`c${c.index}_${nm}`, `사이클 ${c.index + 1} ${tag}${lab}`, f, c.index, nm, [side + "_wrist", side + "_elbow"], ed)); }
    }
  }
  const s = { cycle_sec_mean: r.per_cycle.reduce((a, p) => a + p.cycle_sec, 0) / r.per_cycle.length, ratio_mean: {}, duration_mean: {} };
  for (const ph of PHASES) { const v = r.per_cycle.map(p => p.ratios[ph]).filter(x => x !== null); s.ratio_mean[ph] = v.length ? v.reduce((a, b) => a + b) / v.length : null; const d = r.per_cycle.map(p => p.durations[ph]).filter(x => x !== null); s.duration_mean[ph] = d.length ? d.reduce((a, b) => a + b) / d.length : null; }
  r.traffic = "info";
  if (sides.length === 2) {
    const diffs = {}; for (const ph of PHASES) { const l = r.per_cycle.filter(p => p.side === "left" && p.ratios[ph] !== null).map(p => p.ratios[ph]), rr = r.per_cycle.filter(p => p.side === "right" && p.ratios[ph] !== null).map(p => p.ratios[ph]); if (l.length && rr.length) diffs[ph] = Math.abs(l.reduce((a, b) => a + b) / l.length - rr.reduce((a, b) => a + b) / rr.length); }
    const keys = Object.keys(diffs); if (keys.length) { const wp = keys.reduce((a, b) => diffs[b] > diffs[a] ? b : a); s.left_right_diff_pct = diffs; s.max_diff_phase = wp; if (diffs[wp] >= (th.left_right_diff_yellow_pct ?? 10)) { r.traffic = "yellow"; r.notes.push(`좌우 '${wp}' 구간 비율 차이 ${diffs[wp].toFixed(0)}%p`); } }
  }
  if (th.use_traffic_light && th.reference_ratio) { const lights = []; for (const [k, ph] of [["catch", "캐치"], ["pull", "풀"], ["finish", "피니시"], ["recovery", "리커버리"]]) { const ref = th.reference_ratio[k], v = s.ratio_mean[ph]; if (ref && v !== null) lights.push(ref[0] <= v && v <= ref[1] ? "green" : "yellow"); } if (lights.length) r.traffic = worst(...lights); }
  r.summary = s;
  r.confidence = confidenceScore(ctx, sides.flatMap(sd => [sd + "_wrist", sd + "_shoulder", sd + "_hip"]), frames);
  let missing = 0; for (const p of r.per_cycle) for (const ph of PHASES) if (p.durations[ph] === null) missing++;
  if (missing) { r.notes.push(`기점을 찾지 못한 구간 ${missing}개 — 검수 화면에서 확인해 주세요.`); r.confidence *= Math.max(0.5, 1 - missing / (r.per_cycle.length * PHASES.length)); }
  r.charts.push({ type: "timeline", title: "구간별 소요 시간", rows: r.per_cycle.map(p => ({ label: `사이클 ${p.cycle}` + (sides.length === 2 ? (p.side === "left" ? " L" : " R") : ""), phases: p.durations })) });
  const p0 = r.per_cycle[0];
  for (const [nm, lab] of [["catch_start", "캐치 시작"], ["pull_to_finish", "풀→피니시 전환"], ["exit", "출수"]]) { const f = p0.events[nm]; if (f !== null) r.captures.push({ frame: f, label: `${lab} — 사이클 1`, caption: `사이클 1 ${lab}`, highlight: [p0.side + "_wrist"] }); }
  return r;
}
