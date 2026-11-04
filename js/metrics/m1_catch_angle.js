import { newResult, unmeasured, event, trafficByRange, confidenceScore, stats, override, arm } from "./base.js";
import { armEvents, elbowAngle } from "./common.js";
export const key = "catch_angle", name = "팔꿈치 캐치 각도";
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.catch_angle;
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const sides = ctx.settings.stroke === "butterfly" ? ["left", "right"] : [arm(ctx)];
  const frames = [];
  for (const c of ctx.cycles.cycles) for (const side of sides) {
    const ev = armEvents(ctx, c.index, c.start, c.end, side, key);
    let [f, edited] = override(ctx, key, `c${c.index}_${side}_catch_end`, ev.catch_end); let ang = null;
    if (f !== null) { const ea = elbowAngle(ctx, side); f = Math.max(0, Math.min(ea.length - 1, f)); ang = Number.isNaN(ea[f]) ? null : ea[f]; }
    r.per_cycle.push({ cycle: c.index + 1, side, frame: f, angle: ang, traffic: trafficByRange(ang, th.green, th.yellow_margin) });
    if (f !== null) { frames.push(f); r.events.push(event(`c${c.index}_${side}_catch_end`, `사이클 ${c.index + 1} 캐치 끝선 (${side === "left" ? "왼" : "오른"}팔)`, f, c.index, "catch_end", [side + "_shoulder", side + "_elbow", side + "_wrist"], edited)); }
  }
  const st = stats(r.per_cycle.map(p => p.angle));
  r.summary = { mean: st.mean, std: st.std, n: st.n, green_range: th.green };
  for (const side of sides) r.summary[side + "_mean"] = stats(r.per_cycle.filter(p => p.side === side).map(p => p.angle)).mean;
  if (!st.n) return unmeasured(key, name, "캐치 구간에서 팔꿈치·손목이 인식되지 않았습니다.");
  r.traffic = trafficByRange(st.mean, th.green, th.yellow_margin);
  const joints = sides.flatMap(s => [s + "_shoulder", s + "_elbow", s + "_wrist"]);
  r.confidence = confidenceScore(ctx, joints, frames);
  if (sides.length === 2 && r.summary.left_mean !== null && r.summary.right_mean !== null) { const d = Math.abs(r.summary.left_mean - r.summary.right_mean); r.summary.asymmetry = d; if (d > 15) r.notes.push(`좌우 캐치 각도 차이가 ${d.toFixed(0)}°로 큽니다.`); }
  r.charts.push({ type: "bar", title: "사이클별 팔꿈치 캐치 각도", ylabel: "각도 (°)", values: r.per_cycle.map(p => p.angle), labels: r.per_cycle.map(p => sides.length === 2 ? `${p.cycle}${p.side === "left" ? "L" : "R"}` : String(p.cycle)), green: th.green, yellowMargin: th.yellow_margin, sides: r.per_cycle.map(p => p.side) });
  const mid = (th.green[0] + th.green[1]) / 2; let best = null; for (const p of r.per_cycle) if (p.angle !== null && (best === null || Math.abs(p.angle - mid) < Math.abs(best.angle - mid))) best = p;
  for (const p of r.per_cycle.slice(0, 6)) if (p.frame !== null) r.captures.push({ frame: p.frame, label: `캐치 끝선 — 사이클 ${p.cycle}`, caption: p.angle !== null ? `사이클 ${p.cycle} 캐치 각도 ${p.angle.toFixed(0)}°` : "", angle: { joints: [p.side + "_shoulder", p.side + "_elbow", p.side + "_wrist"], value: p.angle }, highlight: [p.side + "_elbow"], primary: p === best });
  return r;
}
