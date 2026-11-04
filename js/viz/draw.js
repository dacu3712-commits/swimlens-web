// 캔버스에 스켈레톤·각도·라벨 그리기, 사람 주변 크롭 캡처
import { JOINTS, SKELETON } from "../keypoints.js";
const ok = (x, y, v, min) => !Number.isNaN(x) && !Number.isNaN(y) && (v || 0) >= min;
export function drawSkeleton(ctx, lm, i, { minVis = 0.3, highlight = [], lineWidth = 2, scale = 1 } = {}) {
  const d = lm.data;
  for (const [a, b] of SKELETON) { const A = d[a], B = d[b]; if (ok(A.x[i], A.y[i], A.v[i], minVis) && ok(B.x[i], B.y[i], B.v[i], minVis)) { ctx.strokeStyle = (a.startsWith("left") || b.startsWith("left")) ? "#ffff00" : "#00c8ff"; ctx.lineWidth = lineWidth * scale; ctx.beginPath(); ctx.moveTo(A.x[i] * scale, A.y[i] * scale); ctx.lineTo(B.x[i] * scale, B.y[i] * scale); ctx.stroke(); } }
  for (const j of JOINTS) { const J = d[j]; if (!ok(J.x[i], J.y[i], J.v[i], minVis)) continue; const hl = highlight.includes(j); ctx.fillStyle = hl ? "#ff2020" : J.v[i] >= 0.7 ? "#20e040" : "#ffa520"; ctx.beginPath(); ctx.arc(J.x[i] * scale, J.y[i] * scale, (hl ? 6 : 4) * scale, 0, Math.PI * 2); ctx.fill(); }
}
export function drawAngle(ctx, lm, i, [a, b, c], value, scale = 1) {
  const A = lm.data[a], B = lm.data[b], C = lm.data[c]; if ([A, B, C].some(J => Number.isNaN(J.x[i]))) return;
  const bx = B.x[i] * scale, by = B.y[i] * scale; let a1 = Math.atan2(A.y[i] - B.y[i], A.x[i] - B.x[i]), a2 = Math.atan2(C.y[i] - B.y[i], C.x[i] - B.x[i]);
  let dlt = (a2 - a1); while (dlt < 0) dlt += Math.PI * 2; if (dlt > Math.PI) { [a1, a2] = [a2, a1]; dlt = Math.PI * 2 - dlt; }
  ctx.strokeStyle = "#ffff00"; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.arc(bx, by, 28 * scale, a1, a1 + dlt); ctx.stroke();
  if (value !== null && value !== undefined && !Number.isNaN(value)) label(ctx, `${value.toFixed(0)}°`, bx + 14 * scale, by - 30 * scale, 26 * scale, "#ffff00");
}
export function drawLine(ctx, lm, i, [a, b], scale = 1) { const A = lm.data[a], B = lm.data[b]; if (Number.isNaN(A.x[i]) || Number.isNaN(B.x[i])) return; ctx.strokeStyle = "#ff00ff"; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.moveTo(A.x[i] * scale, A.y[i] * scale); ctx.lineTo(B.x[i] * scale, B.y[i] * scale); ctx.stroke(); }
export function label(ctx, text, x, y, size = 18, color = "#fff", bg = "rgba(0,0,0,0.6)") {
  ctx.font = `bold ${size}px "Noto Sans KR", sans-serif`; ctx.textBaseline = "top"; const w = ctx.measureText(text).width;
  ctx.fillStyle = bg; ctx.fillRect(x - 4, y - 2, w + 8, size * 1.3 + 4); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
export function personBox(lm, i, margin = 0.35, minSize = 240) {
  const xs = [], ys = []; for (const j of JOINTS) { const J = lm.data[j]; if (!Number.isNaN(J.x[i]) && !Number.isNaN(J.y[i])) { xs.push(J.x[i]); ys.push(J.y[i]); } }
  if (xs.length < 3) return null; const W = lm.width, H = lm.height;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let w = Math.max(x1 - x0, minSize), h = Math.max(y1 - y0, minSize * 9 / 16); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; w *= 1 + 2 * margin; h *= 1 + 2 * margin;
  if (w / h < 16 / 9) w = h * 16 / 9; else h = w * 9 / 16; w = Math.min(w, W); h = Math.min(h, H);
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}
/**
 * 캡처 이미지 생성 (dataURL). frameCanvas: 해당 프레임이 그려진 분석 해상도 캔버스.
 * spec: {label, angle:{joints,value}, lines, highlight, extra, crop}
 */
export function renderCapture(frameCanvas, lm, i, spec, outWidth = 640) {
  const W = lm.width, H = lm.height; const box = spec.crop === false ? null : personBox(lm, i);
  const src = box || { x: 0, y: 0, w: W, h: H }; const s = outWidth / src.w; const out = document.createElement("canvas"); out.width = Math.round(src.w * s); out.height = Math.round(src.h * s);
  const ctx = out.getContext("2d"); ctx.drawImage(frameCanvas, src.x, src.y, src.w, src.h, 0, 0, out.width, out.height);
  ctx.save(); ctx.translate(-src.x * s, -src.y * s);
  if (spec.overlay) spec.overlay(ctx, s);   // 모범 자세 등 (학생 스켈레톤 아래)
  drawSkeleton(ctx, lm, i, { highlight: spec.highlight || [], scale: s }); for (const ln of spec.lines || []) drawLine(ctx, lm, i, ln, s); if (spec.angle) drawAngle(ctx, lm, i, spec.angle.joints, spec.angle.value, s);
  ctx.restore();
  const fs = Math.max(12, Math.round(out.width / 36)); label(ctx, `${spec.label}  (프레임 ${lm.frame[i]}, ${(lm.t_ms[i] / 1000).toFixed(2)}s)`, 8, 8, fs);
  let y = 8 + fs * 1.5; for (const t of spec.extra || []) { label(ctx, t, 8, y, fs * 0.9); y += fs * 1.4; }
  return out.toDataURL("image/jpeg", 0.85);
}
