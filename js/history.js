// 📈 같은 수강생 기록 비교: 기기에 저장된 영상·사진 분석 중 이름이 같은 것을 날짜순으로 모은다.
import * as db from "./storage.js";
export const TREND = [
  { key: "catch", label: "팔꿈치 캐치 각도(°)", get: m => m.catch_angle?.summary?.mean },
  { key: "knee", label: "킥 직전 무릎(°)", get: m => m.knee_hip_kick?.summary?.knee_mean },
  { key: "sink", label: "하체 가라앉음(°)", get: m => m.streamline?.summary?.sink_angle_mean },
  { key: "rollL", label: "왼쪽 롤링(°)", get: m => m.rolling?.summary?.left_max_mean },
  { key: "rollR", label: "오른쪽 롤링(°)", get: m => m.rolling?.summary?.right_max_mean },
  { key: "cycle", label: "사이클 시간(초)", get: m => m.split_time?.summary?.cycle_sec_mean },
  { key: "slow", label: "호흡 감속률(%)", get: m => m.breathing_speed?.summary?.slowdown_pct },
  { key: "bo", label: "첫 캐치−머리 출수(ms)", get: m => m.breakout?.summary?.diff_ms },
];
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
/** photoMetrics(rec) → 사진 세션의 지표 (photo.js 가 넘겨줌) */
export async function gatherHistory(name, { photoMetrics, currentId, currentMetrics, currentCreated, currentKind } = {}) {
  const list = await db.listSessions(); const rows = [];
  for (const s of list) {
    if (norm(s.name) !== norm(name) || !s.hasMetrics || s.id === currentId) continue;
    const rec = await db.getSession(s.id); let m = null;
    try { m = rec.kind === "photo" ? (photoMetrics ? photoMetrics(rec) : null) : rec.metrics; } catch { m = null; }
    if (m) rows.push({ id: s.id, created: s.created, kind: rec.kind === "photo" ? "사진" : "영상", m });
  }
  if (currentMetrics) rows.push({ id: currentId, created: currentCreated || Date.now(), kind: (currentKind || "영상") + " (이번)", m: currentMetrics, current: true });
  rows.sort((a, b) => a.created - b.created);
  const used = TREND.filter(t => rows.filter(r => num(t.get(r.m)) !== null).length >= 2);
  return { rows: rows.map(r => ({ ...r, date: new Date(r.created).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }), values: Object.fromEntries(TREND.map(t => [t.key, num(t.get(r.m))])) })), used };
}
function num(v) { return v === null || v === undefined || Number.isNaN(v) ? null : v; }
export function historyHtml(h, esc) {
  if (h.rows.length < 2 || !h.used.length) return `<p class="muted">같은 이름으로 저장된 이전 기록이 아직 없습니다. 이름을 똑같이 쓰면 다음부터 변화가 보입니다.</p>`;
  return `<div style="overflow-x:auto"><table class="kv" style="display:table;border-collapse:collapse;width:100%"><tr><th style="text-align:left">날짜</th>${h.used.map(t => `<th style="text-align:right;padding:2px 6px">${esc(t.label)}</th>`).join("")}</tr>${h.rows.map(r => `<tr style="${r.current ? "font-weight:700" : ""}"><td>${r.date} ${esc(r.kind)}</td>${h.used.map(t => `<td style="text-align:right;padding:2px 6px">${r.values[t.key] === null ? "-" : r.values[t.key].toFixed(t.key === "cycle" ? 2 : 0)}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
export function historyChartSpec(h) {
  const series = h.used.filter(t => t.key !== "bo" && t.key !== "slow" && t.key !== "cycle").slice(0, 4).map(t => ({ name: t.label, data: h.rows.map(r => r.values[t.key]) }));
  return { type: "trend", title: "회차별 변화", ylabel: "각도 (°)", labels: h.rows.map(r => r.date + (r.current ? "★" : "")), series };
}
