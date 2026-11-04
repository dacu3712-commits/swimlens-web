import { newResult, unmeasured, event, trafficByRange, confidenceScore, stats, override, worst } from "./base.js";
import { nanargmax, nanargmin } from "../signal/geometry.js";
export const key = "rolling", name = "몸통 롤링 각도";
function rollAngle(ctx, j) { const L = ctx.lm.data["left_" + j], R = ctx.lm.data["right_" + j], n = ctx.lm.n, out = new Float64Array(n); for (let i = 0; i < n; i++) { const l = ctx.frame2d.toWater(L.x[i], L.y[i]), r = ctx.frame2d.toWater(R.x[i], R.y[i]); out[i] = Math.atan2(-(l[1] - r[1]), Math.abs(l[0] - r[0]) + 1e-9) * 180 / Math.PI; } return out; }
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.rolling;
  const sh = rollAngle(ctx, "shoulder"), hp = rollAngle(ctx, "hip");
  if (sh.filter(Number.isNaN).length / sh.length > 0.8) return unmeasured(key, name, "양쪽 어깨가 함께 보이는 프레임이 거의 없어 롤링을 측정할 수 없습니다.");
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const frames = [];
  for (const c of ctx.cycles.cycles) {
    let [fl, el] = override(ctx, key, `c${c.index}_left_max`, nanargmax(sh, c.start, c.end)); let [fr, er] = override(ctx, key, `c${c.index}_right_max`, nanargmin(sh, c.start, c.end));
    const lv = fl !== null && !Number.isNaN(sh[fl]) ? sh[fl] : null, rv = fr !== null && !Number.isNaN(sh[fr]) ? -sh[fr] : null;
    const hl = fl !== null && !Number.isNaN(hp[fl]) ? hp[fl] : null, hr = fr !== null && !Number.isNaN(hp[fr]) ? -hp[fr] : null;
    r.per_cycle.push({ cycle: c.index + 1, left_max: lv, right_max: rv, left_frame: fl, right_frame: fr, hip_left: hl, hip_right: hr, asymmetry: lv !== null && rv !== null ? Math.abs(lv - rv) : null });
    if (fl !== null) { frames.push(fl); r.events.push(event(`c${c.index}_left_max`, `사이클 ${c.index + 1} 왼쪽 최대 롤링`, fl, c.index, "left_max", ["left_shoulder", "right_shoulder"], el)); }
    if (fr !== null) { frames.push(fr); r.events.push(event(`c${c.index}_right_max`, `사이클 ${c.index + 1} 오른쪽 최대 롤링`, fr, c.index, "right_max", ["left_shoulder", "right_shoulder"], er)); }
  }
  const ls = stats(r.per_cycle.map(p => p.left_max)), rs = stats(r.per_cycle.map(p => p.right_max));
  const asym = ls.mean !== null && rs.mean !== null ? Math.abs(ls.mean - rs.mean) : null;
  const hls = stats(r.per_cycle.map(p => p.hip_left)), hrs = stats(r.per_cycle.map(p => p.hip_right));
  r.summary = { left_max_mean: ls.mean, right_max_mean: rs.mean, asymmetry: asym, hip_left_mean: hls.mean, hip_right_mean: hrs.mean, green_range: th.green, n: r.per_cycle.length };
  const lights = [];
  for (const [sd, v] of [["왼쪽", ls.mean], ["오른쪽", rs.mean]]) { const l = trafficByRange(v, th.green, th.yellow_margin); lights.push(l); if (l !== "green" && v !== null && !r.summary.worse_side) { r.summary.worse_side = sd; r.summary.worse_value = v; } }
  if (asym !== null) lights.push(asym >= th.asymmetry_red_deg ? "red" : asym >= th.asymmetry_yellow_deg ? "yellow" : "green");
  r.traffic = worst(...lights);
  if (hls.mean !== null && ls.mean) { const ratio = (hls.mean + hrs.mean) / Math.max(1e-6, ls.mean + rs.mean); r.summary.hip_shoulder_ratio = ratio; r.notes.push(`어깨-골반 롤링 연동: 골반 롤링이 어깨의 ${(ratio * 100).toFixed(0)}% 수준입니다.`); }
  r.confidence = confidenceScore(ctx, ["left_shoulder", "right_shoulder", "left_hip", "right_hip"], frames);
  const vals = [], labels = [], sides = []; for (const p of r.per_cycle) { vals.push(p.left_max, p.right_max === null ? null : -p.right_max); labels.push(`${p.cycle}L`, `${p.cycle}R`); sides.push("left", "right"); }
  r.charts.push({ type: "bar", title: "사이클별 최대 롤링 (왼쪽 +, 오른쪽 −)", ylabel: "각도 (°)", values: vals, labels, sides });
  r.charts.push({ type: "line", title: "롤링 각도 시간 변화 (왼쪽 올라옴 +)", ylabel: "각도 (°)", t: Array.from(ctx.lm.t), series: [{ name: "어깨 롤링", data: Array.from(sh) }, { name: "골반 롤링", data: Array.from(hp) }], hlines: [{ y: th.green[0], label: "권장 하한" }, { y: -th.green[0], label: "" }] });
  const p0 = r.per_cycle[0];
  for (const [f, lab, v] of [[p0.left_frame, "왼쪽 최대 롤링", p0.left_max], [p0.right_frame, "오른쪽 최대 롤링", p0.right_max]]) if (f !== null) r.captures.push({ frame: f, label: `${lab} — 사이클 1`, caption: v !== null ? `사이클 1 ${lab} ${v.toFixed(0)}°` : lab, lines: [["left_shoulder", "right_shoulder"], ["left_hip", "right_hip"]], extra: v !== null ? [`어깨 ${v.toFixed(0)}°`] : [] });
  return r;
}
