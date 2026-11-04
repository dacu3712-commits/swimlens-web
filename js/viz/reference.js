// ⭐ 모범 자세: 코치 본인(또는 엘리트) 사진의 관절을 저장해 두고, 학생 사진·캡처 위에 겹쳐 그린다.
// 정렬: 어깨→골반(롤링은 양 어깨 중점→양 골반 중점) 선분 두 점이 일치하도록 회전·확대·이동. 보는 방향이 반대면 좌우 반전.
import { JOINTS, SKELETON } from "../keypoints.js";
import { angleAt } from "../signal/geometry.js";
import * as db from "../storage.js";

let cache = null;
export async function loadRefs() { if (cache) return cache; const all = await db.listRefs(); cache = {}; for (const r of all) cache[r.refKind] = r; return cache; }
export async function saveRef(refKind, lm, i, side, thumbDataURL) {
  const pts = {}; for (const j of JOINTS) { const x = lm.x(j)[i], y = lm.y(j)[i]; if (!Number.isNaN(x)) pts[j] = [x, y]; }
  const rec = { id: "ref_" + refKind, kind: "ref", refKind, side, pts, facing: facingOf(pts, side), created: Date.now(), thumb: thumbDataURL };
  await db.saveSession(rec); cache = null; return rec;
}
export async function deleteRef(refKind) { await db.deleteSession("ref_" + refKind); cache = null; }
function mid(a, b) { return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a || b; }
function anchors(pts, kind, side) { return kind === "roll" ? [mid(pts.left_shoulder, pts.right_shoulder), mid(pts.left_hip, pts.right_hip)] : [pts[`${side}_shoulder`], pts[`${side}_hip`]]; }
export function facingOf(pts, side) { const n = pts.nose, h = pts[`${side}_hip`] || mid(pts.left_hip, pts.right_hip); return n && h ? Math.sign(n[0] - h[0]) || 1 : 1; }
/** 모범 관절을 학생 좌표로 옮긴 결과 {joint: [x,y]} (정렬 불가면 null) */
export function alignRef(ref, studentPts, kind, side) {
  if (!ref) return null; let rp = ref.pts;
  const [A, B] = anchors(rp, kind, ref.side), [A2, B2] = anchors(studentPts, kind, side);
  if (!A || !B || !A2 || !B2) return null;
  if (kind !== "roll" && facingOf(studentPts, side) !== ref.facing) { const cx = A[0]; rp = Object.fromEntries(Object.entries(rp).map(([j, [x, y]]) => [j, [2 * cx - x, y]])); }
  const [a, b] = anchors(rp, kind, ref.side);
  const vx = b[0] - a[0], vy = b[1] - a[1], ux = B2[0] - A2[0], uy = B2[1] - A2[1];
  const L1 = Math.hypot(vx, vy), L2 = Math.hypot(ux, uy); if (L1 < 1e-6) return null;
  const sc = L2 / L1, rot = Math.atan2(uy, ux) - Math.atan2(vy, vx), c = Math.cos(rot) * sc, s = Math.sin(rot) * sc;
  const out = {}; for (const [j, [x, y]] of Object.entries(rp)) { const dx = x - a[0], dy = y - a[1]; out[j] = [A2[0] + c * dx - s * dy, A2[1] + s * dx + c * dy]; }
  // 학생과 같은 쪽 관절 이름으로 맞추기 (모범이 왼쪽, 학생이 오른쪽이면 이름 교환)
  if (kind !== "roll" && ref.side !== side) { const sw = {}; for (const [j, v] of Object.entries(out)) sw[j.startsWith("left_") ? "right_" + j.slice(5) : j.startsWith("right_") ? "left_" + j.slice(6) : j] = v; return sw; }
  return out;
}
export function drawRef(ctx, pts, scale = 1) {
  if (!pts) return; ctx.save(); ctx.setLineDash([8 * scale, 6 * scale]); ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3 * scale; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 3;
  for (const [a, b] of SKELETON) { const p = pts[a], q = pts[b]; if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p[0] * scale, p[1] * scale); ctx.lineTo(q[0] * scale, q[1] * scale); ctx.stroke(); }
  ctx.setLineDash([]); ctx.fillStyle = "rgba(255,255,255,0.9)"; for (const p of Object.values(pts)) { ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, 3 * scale, 0, 7); ctx.fill(); } ctx.restore();
}
/** 모범 자세의 같은 각도 (예: 팔꿈치) */
export function refAngle(ref, joints3) { if (!ref) return null; const [a, b, c] = joints3.map(j => ref.pts[j.replace(/^(left|right)_/, ref.side + "_")]); if (!a || !b || !c) return null; const v = angleAt(a[0], a[1], b[0], b[1], c[0], c[1]); return Number.isNaN(v) ? null : v; }
export const REF_KIND_OF_EVENT = { catch_end: "catch", knee_min: "kick", entry_kick: "kick", exit_kick: "kick", streamline: "glide", left_max: "roll", right_max: "roll" };
