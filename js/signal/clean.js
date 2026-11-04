// 결측 처리·보간·Savitzky-Golay 스무딩 (파이썬 signal/clean.py 와 동일 규칙)
import { JOINTS } from "../keypoints.js";

/** 최대제곱 다항 적합 계수 (가우스 소거) */
function solve(A, b) {
  const n = A.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function polyfit(xs, ys, order) {
  const m = order + 1; const A = Array.from({ length: m }, () => new Array(m).fill(0)); const b = new Array(m).fill(0);
  for (let i = 0; i < xs.length; i++) { const px = []; let p = 1; for (let k = 0; k < m; k++) { px.push(p); p *= xs[i]; } for (let r = 0; r < m; r++) { b[r] += px[r] * ys[i]; for (let c = 0; c < m; c++) A[r][c] += px[r] * px[c]; } }
  return solve(A, b);
}
const polyval = (co, x) => co.reduce((s, c, k) => s + c * Math.pow(x, k), 0);
const _coefCache = {};
function savgolCoeffs(window, order) {
  const key = window + ":" + order; if (_coefCache[key]) return _coefCache[key];
  const h = Math.floor(window / 2); const xs = []; for (let i = -h; i <= h; i++) xs.push(i);
  // 중앙 평가 계수: 단위 벡터 응답
  const co = xs.map((_, j) => { const ys = xs.map((__, k) => k === j ? 1 : 0); return polyval(polyfit(xs, ys, order), 0); });
  return (_coefCache[key] = co);
}
/** scipy.signal.savgol_filter(mode='interp') 와 동일 */
export function savgol(seg, window, order) {
  const n = seg.length, out = new Float64Array(n), h = Math.floor(window / 2);
  const co = savgolCoeffs(window, order);
  for (let i = h; i < n - h; i++) { let s = 0; for (let k = -h; k <= h; k++) s += co[k + h] * seg[i + k]; out[i] = s; }
  const xs = []; for (let i = 0; i < window; i++) xs.push(i);
  const cL = polyfit(xs, Array.from(seg.slice(0, window)), order); for (let i = 0; i < h; i++) out[i] = polyval(cL, i);
  const cR = polyfit(xs, Array.from(seg.slice(n - window)), order); for (let i = n - h; i < n; i++) out[i] = polyval(cR, i - (n - window));
  return out;
}
export function smoothSeries(values, window, order) {
  const n = values.length, out = Float64Array.from(values);
  let i = 0;
  while (i < n) {
    if (!Number.isNaN(out[i])) {
      let j = i; while (j < n && !Number.isNaN(out[j])) j++;
      const len = j - i; let w = Math.min(window, len % 2 === 1 ? len : len - 1);
      if (w > order + 1 && w >= 3) { const sm = savgol(out.slice(i, j), w, order); out.set(sm, i); }
      i = j;
    } else i++;
  }
  return out;
}
/** max_gap 이하의 NaN 구간만 선형 보간. 반환 [결과, 보간 마스크] */
export function interpolateShortGaps(series, maxGap) {
  const n = series.length, out = Float64Array.from(series), filled = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    if (Number.isNaN(out[i])) {
      let j = i; while (j < n && Number.isNaN(out[j])) j++;
      if (j - i <= maxGap && i > 0 && j < n) { const a = out[i - 1], b = out[j]; for (let k = i; k < j; k++) { out[k] = a + (b - a) * (k - i + 1) / (j - i + 1); filled[k] = 1; } }
      i = j;
    } else i++;
  }
  return [out, filled];
}
/** 반환: {lm(정제본), report:{joints:{j:{mean_visibility, interpolated_ratio, missing_ratio}}, detect_rate}} */
export function cleanLandmarks(lm, cfg, smooth = true) {
  const minVis = cfg.min_visibility ?? 0.5, maxGap = cfg.max_interp_gap_frames ?? 5, window = cfg.smoothing_window_frames ?? 9, poly = cfg.smoothing_polyorder ?? 2;
  const out = lm.clone(); const report = { joints: {}, detect_rate: 0 }; const anyDetect = new Uint8Array(lm.n);
  for (const j of JOINTS) {
    const d = out.data[j]; let vs = 0; for (let i = 0; i < lm.n; i++) { vs += d.v[i]; if (d.v[i] > 0) anyDetect[i] = 1; if (d.v[i] < minVis) { d.x[i] = NaN; d.y[i] = NaN; } }
    const [xs, fx] = interpolateShortGaps(d.x, maxGap), [ys, fy] = interpolateShortGaps(d.y, maxGap);
    let filledCount = 0, missing = 0;
    const X = smooth ? smoothSeries(xs, window, poly) : xs, Y = smooth ? smoothSeries(ys, window, poly) : ys;
    for (let i = 0; i < lm.n; i++) { d.x[i] = X[i]; d.y[i] = Y[i]; if (fx[i] || fy[i]) { filledCount++; d.v[i] = Math.max(d.v[i], minVis); } if (Number.isNaN(d.x[i])) missing++; }
    report.joints[j] = { mean_visibility: lm.n ? vs / lm.n : 0, interpolated_ratio: lm.n ? filledCount / lm.n : 0, missing_ratio: lm.n ? missing / lm.n : 1 };
  }
  let det = 0; for (const a of anyDetect) det += a; report.detect_rate = lm.n ? det / lm.n : 0;
  return { lm: out, report };
}
export function qualityOf(report, joints) {
  const qs = joints.filter(j => report.joints[j]).map(j => report.joints[j]);
  if (!qs.length) return { mean_visibility: 0, interpolated_ratio: 0, missing_ratio: 1 };
  const avg = k => qs.reduce((s, q) => s + q[k], 0) / qs.length;
  return { mean_visibility: avg("mean_visibility"), interpolated_ratio: avg("interpolated_ratio"), missing_ratio: avg("missing_ratio") };
}
