// 지표 공통 (파이썬 metrics/base.py)
import { qualityOf } from "../signal/clean.js";
export const TRAFFIC_KO = { green: "좋음", yellow: "주의", red: "개선 필요", na: "측정 불가", info: "참고" };

export function newResult(key, name) {
  return { key, name, status: "ok", traffic: "na", confidence: 0, summary: {}, per_cycle: [], events: [], charts: [], captures: [], reason: "", notes: [], comment: "", drills: [] };
}
export function unmeasured(key, name, reason) { const r = newResult(key, name); r.status = "unmeasured"; r.traffic = "na"; r.reason = reason; return r; }
export function event(id, label, frame, cycle, kind, joints, edited = false) { return { id, label, frame, cycle, kind, joints, edited }; }
export function trafficByRange(v, green, margin, redBelow = null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "na";
  const [lo, hi] = green; if (redBelow !== null && redBelow !== undefined && v < redBelow) return "red";
  if (v >= lo && v <= hi) return "green"; if (v >= lo - margin && v <= hi + margin) return "yellow"; return "red";
}
export function trafficByMax(v, greenMax, yellowMax) { if (v === null || v === undefined || Number.isNaN(v)) return "na"; if (v <= greenMax) return "green"; if (v <= yellowMax) return "yellow"; return "red"; }
const ORDER = { red: 3, yellow: 2, green: 1, info: 0, na: -1 };
export function worst(...lights) { const v = lights.filter(l => l in ORDER); return v.length ? v.reduce((a, b) => ORDER[b] > ORDER[a] ? b : a) : "na"; }
export function stats(values) {
  const v = values.filter(x => x !== null && x !== undefined && !Number.isNaN(x));
  if (!v.length) return { mean: null, std: null, min: null, max: null, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length; const std = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) : 0;
  return { mean, std, min: Math.min(...v), max: Math.max(...v), n: v.length };
}
export function confidenceScore(ctx, joints, frames) {
  const common = ctx.th.common; let vis;
  if (frames && frames.length) { const vals = []; for (const j of joints) { let s = 0, k = 0; for (const f of frames) { const i = Math.max(0, Math.min(ctx.lm.n - 1, f)); const v = ctx.lm.v(j)[i]; if (!Number.isNaN(v)) { s += v; k++; } } if (k) vals.push(s / k); } vis = vals.length ? vals.reduce((a, b) => a + b) / vals.length : 0; }
  else vis = qualityOf(ctx.clean, joints).mean_visibility;
  const q = qualityOf(ctx.clean, joints);
  const penalty = Math.max(0, 1 - q.interpolated_ratio * (common.interp_penalty_weight ?? 1));
  const factor = ctx.viewStatus === "reference" ? (common.reference_view_factor ?? 0.6) : 1;
  return Math.max(0, Math.min(100, vis * penalty * factor * 100));
}
export function needsReview(r, th) { return r.status !== "unmeasured" && r.confidence < (th.common.confidence_review_threshold ?? 60); }
/** 검수 수정값: ctx.overrides = {metricKey: {eventId: frame}} */
export function override(ctx, metricKey, eventId, def) { const v = ctx.overrides?.[metricKey]?.[eventId]; return v === undefined || v === null ? [def, false] : [Math.round(v), true]; }
export const arm = (ctx) => (ctx.cycles.side === "left" || ctx.cycles.side === "right") ? ctx.cycles.side : ctx.settings.camera_side_arm;
