// 각도·벡터 유틸 (NaN 안전)
export function angleAt(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by, v2x = cx - bx, v2y = cy - by;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (!(n1 * n2 > 0)) return NaN;
  const c = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(c) * 180 / Math.PI;
}
/** 관절 3개의 각도 시계열 */
export function angleSeries(lm, a, b, c) {
  const n = lm.n, out = new Float64Array(n);
  const A = lm.data[a], B = lm.data[b], C = lm.data[c];
  for (let i = 0; i < n; i++) out[i] = angleAt(A.x[i], A.y[i], B.x[i], B.y[i], C.x[i], C.y[i]);
  return out;
}
export function velocity(x, fps) {           // numpy.gradient 와 동일 (중앙차분, 끝은 전/후진)
  const n = x.length, out = new Float64Array(n);
  if (n === 1) { out[0] = 0; return out; }
  out[0] = (x[1] - x[0]) * fps; out[n - 1] = (x[n - 1] - x[n - 2]) * fps;
  for (let i = 1; i < n - 1; i++) out[i] = (x[i + 1] - x[i - 1]) / 2 * fps;
  return out;
}
export const nanmean = (arr) => { let s = 0, k = 0; for (const v of arr) if (!Number.isNaN(v) && v !== null && v !== undefined) { s += v; k++; } return k ? s / k : NaN; };
export const nanstd = (arr) => { const m = nanmean(arr); let s = 0, k = 0; for (const v of arr) if (!Number.isNaN(v)) { s += (v - m) ** 2; k++; } return k ? Math.sqrt(s / k) : NaN; };
export const nanmax = (arr) => { let m = -Infinity; for (const v of arr) if (!Number.isNaN(v) && v > m) m = v; return m === -Infinity ? NaN : m; };
export const nanmin = (arr) => { let m = Infinity; for (const v of arr) if (!Number.isNaN(v) && v < m) m = v; return m === Infinity ? NaN : m; };
export const nanmedian = (arr) => { const a = Array.from(arr).filter(v => !Number.isNaN(v)).sort((p, q) => p - q); if (!a.length) return NaN; const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
export function nanargmin(arr, start = 0, stop = arr.length) { let b = -1, bv = Infinity; for (let i = start; i < stop; i++) { const v = arr[i]; if (!Number.isNaN(v) && v < bv) { bv = v; b = i; } } return b < 0 ? null : b; }
export function nanargmax(arr, start = 0, stop = arr.length) { let b = -1, bv = -Infinity; for (let i = start; i < stop; i++) { const v = arr[i]; if (!Number.isNaN(v) && v > bv) { bv = v; b = i; } } return b < 0 ? null : b; }
export function rollingMean(x, win) {        // pandas rolling(center=True, min_periods=1).mean() 과 동일
  const n = x.length, out = new Float64Array(n), h = Math.floor(win / 2);
  for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i - h + win - 1); j++) { const v = x[j]; if (!Number.isNaN(v)) { s += v; k++; } } out[i] = k ? s / k : NaN; }
  return out;
}
export function rollingStd(x, win, minPeriods) {
  const n = x.length, out = new Float64Array(n), h = Math.floor(win / 2); minPeriods = minPeriods ?? Math.max(2, Math.floor(win / 2));
  for (let i = 0; i < n; i++) { let s = 0, s2 = 0, k = 0; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i - h + win - 1); j++) { const v = x[j]; if (!Number.isNaN(v)) { s += v; s2 += v * v; k++; } } out[i] = k >= minPeriods && k > 1 ? Math.sqrt(Math.max(0, (s2 - s * s / k) / (k - 1))) : NaN; }
  return out;
}
export function meanOf(pts) { // [[x,y],...] 중 NaN 아닌 것 평균
  let sx = 0, sy = 0, k = 0; for (const [x, y] of pts) if (!Number.isNaN(x) && !Number.isNaN(y)) { sx += x; sy += y; k++; }
  return k ? [sx / k, sy / k] : [NaN, NaN];
}
