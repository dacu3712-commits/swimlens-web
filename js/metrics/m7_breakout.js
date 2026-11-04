import { newResult, unmeasured, event, confidenceScore, override, arm } from "./base.js";
import { armEvents } from "./common.js";
import { ankleDepthSignal } from "./m5_knee_hip_kick.js";
import { velocity, rollingMean, rollingStd, nanmedian, nanmax, nanmin } from "../signal/geometry.js";
import { peaks } from "../signal/events.js";
export const key = "breakout", name = "브레이크아웃";
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.breakout, wl = ctx.wl, lm = ctx.lm, fps = ctx.fps, n = lm.n, a = arm(ctx);
  const hip = wl.midFwd("left_hip", "right_hip"); if (hip.filter(Number.isNaN).length / n > 0.6) return unmeasured(key, name, "골반이 충분히 인식되지 않아 브레이크아웃을 분석할 수 없습니다.");
  const speed = rollingMean(velocity(hip, fps), Math.max(1, Math.floor(0.2 * fps) | 1));
  const baseW = Math.floor(0.5 * fps); let push = null;
  for (let i = baseW; i < n; i++) { let s = 0, k = 0; for (let j = i - baseW; j < i; j++) if (!Number.isNaN(speed[j])) { s += Math.abs(speed[j]); k++; } const base = k ? s / k : NaN; if (!Number.isNaN(speed[i]) && !Number.isNaN(base) && speed[i] > (th.pushoff_speed_jump_ratio ?? 2) * Math.max(base, 1e-6) && speed[i] > 0.05 * lm.width) { push = i; break; } }
  let edPush; [push, edPush] = override(ctx, key, "pushoff", push);
  if (push === null) { push = 0; r.notes.push("벽 차기 순간을 찾지 못해 영상 시작을 기준으로 계산했습니다 (영상이 벽 차기 전부터 시작되었는지 확인하세요)."); }
  const ankle = ankleDepthSignal(ctx, a), amp = rollingStd(ankle, Math.max(1, Math.floor(0.3 * fps) | 1)), ampThr = (th.kick_amplitude_min_ratio ?? 0.02) * lm.height;
  let kickStart = null; for (let i = push; i < n; i++) if (!Number.isNaN(amp[i]) && amp[i] > ampThr) { kickStart = i; break; }
  let edKs; [kickStart, edKs] = override(ctx, key, "kick_start", kickStart);
  // 첫 캐치: 손목 하강 시작
  const wristD = wl.depth(a + "_wrist"), vd = rollingMean(velocity(wristD, fps), 3), thrV = 0.08 * lm.height; let firstCatch = null;
  for (let i = (kickStart ?? push) + Math.floor(0.3 * fps); i < n - 3; i++) if (vd[i] > thrV && vd[i + 1] > thrV && vd[i + 2] > thrV) { firstCatch = i; break; }
  if (firstCatch === null && ctx.cycles.cycles.length) { const c0 = ctx.cycles.cycles[0]; const ev = armEvents(ctx, c0.index, c0.start, c0.end, a); firstCatch = ev.catch_start ?? c0.start; }
  let edFc; [firstCatch, edFc] = override(ctx, key, "first_catch", firstCatch);
  // 머리 출수
  const pts = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].map(j => wl.depth(j)); const headRaw = new Float64Array(n); for (let i = 0; i < n; i++) headRaw[i] = nanmin(pts.map(p => p[i]));
  const headD = rollingMean(headRaw, Math.max(1, Math.floor(0.2 * fps) | 1)); let headOut = null;
  const seg = Array.from(headD.slice(push)); const valid = seg.filter(v => !Number.isNaN(v)).length;
  if (valid > Math.floor(fps)) {
    const tail = seg.slice(Math.floor(seg.length * 0.4)), steady = nanmedian(tail), deep = nanmax(seg.slice(0, Math.max(Math.floor(seg.length * 0.6), 1)));
    if (deep - steady > 0.02 * lm.height) { const level = steady + 0.2 * (deep - steady); for (let i = push; i < n; i++) if (!Number.isNaN(headD[i]) && headD[i] < level) { headOut = i; break; } }
    else r.notes.push("영상 시작부터 머리가 수면 근처에 있어 수중 구간(브레이크아웃)이 없는 것으로 보입니다.");
  }
  if (ctx.settings.waterline) for (let i = push; i < n; i++) if (!Number.isNaN(headD[i]) && headD[i] < 0) { headOut = headOut === null ? i : Math.min(headOut, i); break; }
  let edHo; [headOut, edHo] = override(ctx, key, "head_out", headOut);
  const endK = Math.min(...[firstCatch, headOut, n - 1].filter(x => x !== null)); let kicks = [];
  if (kickStart !== null && endK > kickStart) kicks = peaks(ankle, fps, 0.15, 0.15, true).filter(k => k >= kickStart && k <= endK);
  const lastKick = kicks.length ? kicks[kicks.length - 1] : null;
  const s = { pushoff_frame: push, kick_start_frame: kickStart, first_catch_frame: firstCatch, head_out_frame: headOut, kick_count: kicks.length, kick_frames: kicks };
  const mpp = ctx.frame2d.m_per_px;
  if (headOut !== null) { s.underwater_sec = (headOut - push) / fps; if (!ctx.cameraMoving && !Number.isNaN(hip[headOut]) && !Number.isNaN(hip[push])) { const d = hip[headOut] - hip[push]; s.underwater_distance_m = mpp ? d * mpp : null; s.underwater_distance_px = d; } else { s.underwater_distance_m = null; if (ctx.cameraMoving) r.notes.push("카메라 이동 영상이라 수중 거리는 측정하지 않았습니다."); } }
  if (firstCatch !== null && headOut !== null) {
    const diff = (firstCatch - headOut) / fps * 1000, match = th.timing_match_ms ?? 100; s.diff_ms = diff;
    s.judgement = Math.abs(diff) <= match ? "일치" : diff > match ? "머리가 먼저 나옴" : "손이 먼저 캐치";
    if (lastKick !== null && (firstCatch - lastKick) / fps * 1000 > 300) { if (s.judgement !== "일치") s.judgement = "손이 늦음"; s.gap_after_last_kick_ms = (firstCatch - lastKick) / fps * 1000; r.notes.push(`마지막 돌핀킥 후 첫 캐치까지 ${s.gap_after_last_kick_ms.toFixed(0)}ms 공백이 있습니다.`); }
    r.traffic = { "일치": "green", "손이 먼저 캐치": "green", "머리가 먼저 나옴": diff <= 2 * match ? "yellow" : "red", "손이 늦음": "yellow" }[s.judgement];
  } else { r.traffic = "info"; r.notes.push("첫 캐치 또는 머리 출수 시점을 찾지 못해 타이밍 판정을 생략했습니다."); }
  r.summary = s; const frames = [push, kickStart, firstCatch, headOut].filter(f => f !== null);
  for (const [f, lab, ed, tag, joints] of [[push, "벽 차기", edPush, "pushoff", ["left_hip", "right_hip"]], [kickStart, "돌핀킥 시작", edKs, "kick_start", [a + "_ankle"]], [firstCatch, "첫 캐치 시작", edFc, "first_catch", [a + "_wrist"]], [headOut, "머리 출수", edHo, "head_out", ["nose"]]]) if (f !== null) r.events.push(event(tag, lab, f, null, tag, joints, ed));
  r.confidence = confidenceScore(ctx, ["left_hip", "right_hip", a + "_ankle", "nose", a + "_wrist"], frames); if (push === 0) r.confidence *= 0.7;
  const t = lm.t; const evs = [[push, "벽 차기", "gray"], [kickStart, "돌핀킥 시작", "orange"], [firstCatch, "첫 캐치", "blue"], [headOut, "머리 출수", "red"]].filter(e => e[0] !== null).map(e => ({ x: t[e[0]], label: e[1], color: e[2] })).concat(kicks.map(k => ({ x: t[k], label: "킥", color: "yellow" })));
  r.charts.push({ type: "line", title: "브레이크아웃 타임라인", ylabel: "발목 깊이 (px)", y2label: "속도 (px/s)", t: Array.from(t), series: [{ name: "발목 깊이(px)", data: Array.from(ankle) }], series2: [{ name: "골반 속도(px/s)", data: Array.from(speed) }], events: evs });
  for (const [f, lab] of [[headOut, "머리 출수"], [firstCatch, "첫 캐치 시작"]]) if (f !== null) r.captures.push({ frame: f, label: lab, caption: lab, highlight: ["nose", a + "_wrist"] });
  return r;
}
