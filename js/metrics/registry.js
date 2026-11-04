import * as m1 from "./m1_catch_angle.js"; import * as m2 from "./m2_split_time.js"; import * as m3 from "./m3_rolling.js"; import * as m4 from "./m4_hand_path.js";
import * as m5 from "./m5_knee_hip_kick.js"; import * as m6 from "./m6_breathing_speed.js"; import * as m7 from "./m7_breakout.js"; import * as m8 from "./m8_streamline.js";
import { unmeasured, needsReview } from "./base.js";
export const METRICS = [m1, m2, m3, m4, m5, m6, m7, m8];
export const ORDER = METRICS.map(m => m.key);
export function plan(matrix, view) {
  return ORDER.map(k => { const spec = matrix.metrics[k] || {}; const st = spec[view] || "no"; return st === "ok" ? [k, "ok", ""] : st === "ref" ? [k, "reference", "이 구도에서는 참고용(신뢰도 낮음)으로만 측정합니다"] : [k, "unmeasured", `측정 불가(구도): ${spec.reason_no || "이 구도에서는 측정할 수 없습니다"}`]; });
}
export function runAll(ctx, matrix, log = () => {}) {
  const out = {};
  for (const [k, status, reason] of plan(matrix, ctx.settings.view)) {
    const m = METRICS.find(x => x.key === k); const name = matrix.metrics[k]?.name || m?.name || k;
    if (status === "unmeasured") { out[k] = unmeasured(k, name, reason); continue; }
    ctx.viewStatus = status;
    try { const r = m.compute(ctx); if (status === "reference" && r.status !== "unmeasured") { r.status = "reference"; r.notes.unshift("⚠️ 참고용: 이 촬영 구도에서는 정확도가 낮습니다."); } out[k] = r; }
    catch (e) { log(`[${name}] 계산 오류: ${e.message}`); console.error(e); out[k] = unmeasured(k, name, `계산 중 오류가 발생했습니다: ${e.name}: ${String(e.message).slice(0, 100)}`); }
  }
  for (const r of Object.values(out)) r.needs_review = needsReview(r, ctx.th);
  return out;
}
