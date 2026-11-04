// 스트로크 사이클 분할 (파이썬 signal/cycles.py 와 동일)
import { peaks } from "./events.js";
import { nanmean } from "./geometry.js";

export function wristRelativeSignal(wl, side) {
  const n = wl.n, out = new Float64Array(n);
  if (side === "both") { const l = wristRelativeSignal(wl, "left"), r = wristRelativeSignal(wl, "right"); for (let i = 0; i < n; i++) out[i] = nanmean([l[i], r[i]]); return out; }
  const w = wl.fwd(side + "_wrist"), s = wl.fwd(side + "_shoulder"); for (let i = 0; i < n; i++) out[i] = w[i] - s[i]; return out;
}
export function rollSignal(wl) {
  const n = wl.n, out = new Float64Array(n), L = wl.lm.data.left_shoulder, R = wl.lm.data.right_shoulder;
  for (let i = 0; i < n; i++) { const dx = L.x[i] - R.x[i], dy = L.y[i] - R.y[i]; out[i] = Math.atan2(-dy, Math.abs(dx) + 1e-9) * 180 / Math.PI; }
  return out;
}
function build(sig, fps, cfg, side) {
  const res = { cycles: [], signal: sig, side, note: "" };
  if (sig.every(Number.isNaN)) { res.note = "손목·어깨가 거의 인식되지 않아 사이클을 나누지 못했습니다."; return res; }
  const pk = peaks(sig, fps, cfg.min_cycle_sec ?? 0.6, cfg.peak_prominence_ratio ?? 0.3, true);
  const maxLen = Math.floor((cfg.max_cycle_sec ?? 3) * fps), minLen = Math.floor((cfg.min_cycle_sec ?? 0.6) * fps);
  let k = 0; for (let i = 0; i + 1 < pk.length; i++) { const a = pk[i], b = pk[i + 1]; if (b - a >= minLen && b - a <= maxLen) res.cycles.push({ index: k++, start: a, end: b, side }); }
  if (!res.cycles.length) res.note = "주기적인 손 움직임을 찾지 못했습니다(사이클 0개). 영상이 짧거나 손목 인식이 불안정합니다.";
  return res;
}
export function segmentCycles(wl, stroke, cameraSideArm, cfg, view = "side_under") {
  if (view === "front" || view === "back") {
    if (stroke === "butterfly" || stroke === "breaststroke") { const l = wl.depth("left_wrist"), r = wl.depth("right_wrist"), s = new Float64Array(wl.n); for (let i = 0; i < wl.n; i++) s[i] = -nanmean([l[i], r[i]]); return build(s, wl.fps, cfg, "both"); }
    return build(rollSignal(wl), wl.fps, cfg, "left");
  }
  let side = (stroke === "butterfly" || stroke === "breaststroke") ? "both" : cameraSideArm;
  let sig = wristRelativeSignal(wl, side);
  const validRatio = 1 - sig.filter(Number.isNaN).length / sig.length;
  if (validRatio < 0.3 && side !== "both") { const other = side === "left" ? "right" : "left"; const s2 = wristRelativeSignal(wl, other); if (1 - s2.filter(Number.isNaN).length / s2.length > validRatio) { sig = s2; side = other; } }
  return build(sig, wl.fps, cfg, side);
}
