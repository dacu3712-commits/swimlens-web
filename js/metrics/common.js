// 사이클별 팔 이벤트 (파이썬 metrics/common.py)
import { angleSeries, velocity, nanargmin, nanmax } from "../signal/geometry.js";
import { firstCrossing } from "../signal/events.js";
import { override } from "./base.js";

export function elbowAngle(ctx, side) { const k = "elbow_" + side; if (!ctx.cache[k]) ctx.cache[k] = angleSeries(ctx.lm, side + "_shoulder", side + "_elbow", side + "_wrist"); return ctx.cache[k]; }

export function armEvents(ctx, cycleIdx, start, end, side, metricKey = "split_time") {
  const wl = ctx.wl, fps = ctx.fps, n = wl.n; end = Math.min(end, n - 1);
  const wristD = wl.depth(side + "_wrist"), wristF = wl.fwd(side + "_wrist"), shF = wl.fwd(side + "_shoulder"), shD = wl.depth(side + "_shoulder"), hipF = wl.fwd(side + "_hip");
  const vd = velocity(wristD, fps);
  // 1) 캐치 시작
  let catchStart = null; let mx = 0; for (let i = start; i < end; i++) { const a = Math.abs(vd[i]); if (!Number.isNaN(a) && a > mx) mx = a; }
  const thr = 0.02 * Math.max(1e-6, mx || 1);
  for (let i = start; i < Math.max(start, end - 2); i++) if (vd[i] > thr && vd[i + 1] > thr) { catchStart = i; break; }
  // 2) 풀→피니시 전환
  const rel = new Float64Array(n); for (let i = 0; i < n; i++) rel[i] = wristF[i] - shF[i];
  const pullToFinish = firstCrossing(rel, catchStart ?? start, end, "down");
  // 3) 캐치 끝선
  const ea = elbowAngle(ctx, side); const a0 = catchStart ?? start; const a1 = pullToFinish !== null ? pullToFinish + 3 : start + Math.floor(0.6 * (end - start));
  const under = new Float64Array(n); for (let i = 0; i < n; i++) under[i] = wristD[i] > shD[i] ? ea[i] : NaN;
  let catchEnd = nanargmin(under, a0, Math.min(a1, end)); if (catchEnd === null) catchEnd = nanargmin(ea, a0, Math.min(a1, end));
  // 4) 출수
  let exit = null; const p0 = pullToFinish ?? a1; const hipRel = new Float64Array(n); for (let i = 0; i < n; i++) hipRel[i] = wristF[i] - hipF[i];
  const hipPass = firstCrossing(hipRel, p0, end, "down"); const q0 = hipPass ?? p0;
  for (let i = q0; i < end; i++) if (!Number.isNaN(wristD[i]) && !Number.isNaN(shD[i]) && wristD[i] < shD[i]) { exit = i; break; }
  if (exit === null && end > q0) exit = nanargmin(wristD, q0, end);
  const ev = { cycle: cycleIdx, side, entry: start, catch_start: catchStart, catch_end: catchEnd, pull_to_finish: pullToFinish, exit, next_entry: end, elbow_angle_min: null };
  for (const name of ["catch_start", "catch_end", "pull_to_finish", "exit"]) { const [v, ed] = override(ctx, metricKey, `c${cycleIdx}_${name}`, ev[name]); if (ed) ev[name] = v; }
  if (ev.catch_end !== null && !Number.isNaN(ea[ev.catch_end])) ev.elbow_angle_min = ea[ev.catch_end];
  return ev;
}
