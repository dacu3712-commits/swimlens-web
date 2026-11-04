import { newResult, unmeasured, event, trafficByMax, confidenceScore, arm } from "./base.js";
import { velocity, rollingMean } from "../signal/geometry.js";
export const key = "breathing_speed", name = "노브레싱 vs 브레싱 속도";
export function breathFlags(ctx) {
  const th = ctx.th.breathing_speed, wl = ctx.wl, lm = ctx.lm, n = lm.n, a = arm(ctx), far = a === "right" ? "left" : "right";
  const noseV = lm.v("nose"), noseD = wl.depth("nose"), farV = lm.v(far + "_ear"), nearV = lm.v(a + "_ear");
  const raw = new Float64Array(n); for (let i = 0; i < n; i++) { const above = ctx.settings.waterline ? (Number.isNaN(noseD[i]) ? false : noseD[i] < 0) : false; const turned = noseV[i] < (th.nose_visibility_drop ?? 0.3) && farV[i] > nearV[i]; raw[i] = above || turned ? 1 : 0; }
  const sm = rollingMean(raw, Math.max(1, Math.floor(0.15 * ctx.fps))); return Array.from(sm, v => v > 0.5);
}
export function compute(ctx) {
  const r = newResult(key, name), th = ctx.th.breathing_speed;
  if (ctx.cameraMoving) return unmeasured(key, name, "측정 불가(카메라 이동): 따라가며 촬영한 영상에서는 속도를 계산할 수 없습니다. " + (ctx.cameraMotion?.note || ""));
  if (!ctx.cycles.cycles.length) return unmeasured(key, name, "스트로크 사이클을 찾지 못해 측정할 수 없습니다. " + ctx.cycles.note);
  const wl = ctx.wl, fps = ctx.fps, hip = wl.midFwd("left_hip", "right_hip");
  if (hip.filter(Number.isNaN).length / hip.length > 0.6) return unmeasured(key, name, "골반이 충분히 인식되지 않아 속도를 계산할 수 없습니다.");
  const mpp = ctx.frame2d.m_per_px, flags = breathFlags(ctx), speed = velocity(hip, fps), frames = [];
  for (const c of ctx.cycles.cycles) {
    let i0 = -1, i1 = -1; for (let i = c.start; i < c.end; i++) if (!Number.isNaN(hip[i])) { if (i0 < 0) i0 = i; i1 = i; }
    let okc = 0; for (let i = c.start; i < c.end; i++) if (!Number.isNaN(hip[i])) okc++; if (okc < 3) continue;
    const vpx = (hip[i1] - hip[i0]) / Math.max(1, i1 - i0) * fps; let br = 0; for (let i = c.start; i < c.end; i++) if (flags[i]) br++; br /= (c.end - c.start);
    const isB = br >= 0.15; r.per_cycle.push({ cycle: c.index + 1, speed_px_s: vpx, speed_m_s: mpp ? vpx * mpp : null, breathing: isB, breath_ratio: br });
    if (isB) { let f = c.start; for (let i = c.start; i < c.end; i++) if (flags[i]) { f = i; break; } frames.push(f); r.events.push(event(`c${c.index}_breath`, `사이클 ${c.index + 1} 호흡 시작`, f, c.index, "breath", ["nose"])); }
  }
  const b = r.per_cycle.filter(p => p.breathing).map(p => p.speed_px_s), nb = r.per_cycle.filter(p => !p.breathing).map(p => p.speed_px_s);
  const s = { n_breath: b.length, n_nobreath: nb.length, has_scale: !!mpp };
  if (!b.length || !nb.length) { r.summary = s; const why = !b.length ? "호흡 사이클" : "노브레싱 사이클"; return unmeasured(key, name, `비교할 ${why}이 없습니다 (호흡 ${b.length} / 노브레싱 ${nb.length} 사이클). 호흡과 무호흡이 섞인 구간을 촬영해 주세요.`); }
  const vb = b.reduce((x, y) => x + y) / b.length, vnb = nb.reduce((x, y) => x + y) / nb.length, slow = vnb > 0 ? (vnb - vb) / vnb * 100 : null;
  Object.assign(s, { speed_breath_px_s: vb, speed_nobreath_px_s: vnb, slowdown_pct: slow, speed_breath_m_s: mpp ? vb * mpp : null, speed_nobreath_m_s: mpp ? vnb * mpp : null });
  if (nb.length < (th.min_nobreath_strokes ?? 2)) r.notes.push(`노브레싱 사이클이 ${nb.length}개뿐이라 비교 신뢰도가 낮습니다.`);
  if (!mpp) r.notes.push("거리 보정(2점 + 실제 거리)이 없어 m/s 대신 px/s 로 표시합니다. 감속률(%)은 보정 없이도 유효합니다.");
  r.summary = s; r.traffic = slow !== null && slow >= 0 ? trafficByMax(slow, th.slowdown_green_pct, th.slowdown_yellow_pct) : "green";
  r.confidence = confidenceScore(ctx, ["left_hip", "right_hip", "nose"], frames.length ? frames : null); if (nb.length < 2) r.confidence *= 0.8;
  const t = ctx.lm.t, shade = []; let inB = false, a0 = 0; flags.forEach((f, i) => { if (f && !inB) { a0 = t[i]; inB = true; } else if (!f && inB) { shade.push([a0, t[i]]); inB = false; } }); if (inB) shade.push([a0, t[t.length - 1]]);
  const sp = rollingMean(speed.map(v => v * (mpp || 1)), Math.max(1, Math.floor(0.3 * fps) | 1));
  r.charts.push({ type: "line", title: "속도-시간 (호흡 구간 음영)", ylabel: mpp ? "속도 (m/s)" : "속도 (px/s)", t: Array.from(t), series: [{ name: "골반 수평 속도", data: Array.from(sp) }], shade });
  if (frames.length) r.captures.push({ frame: frames[0], label: "호흡 순간", caption: "호흡 순간", highlight: ["nose"] });
  return r;
}
