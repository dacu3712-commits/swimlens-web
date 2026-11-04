// 피크·전환 검출 (scipy.signal.find_peaks 와 같은 결과를 내도록 구현)
export function nanFill(x) {
  const n = x.length, out = Float64Array.from(x); const idx = []; for (let i = 0; i < n; i++) if (!Number.isNaN(out[i])) idx.push(i);
  if (!idx.length) return out;
  for (let i = 0; i < n; i++) if (Number.isNaN(out[i])) {
    if (i < idx[0]) out[i] = out[idx[0]]; else if (i > idx[idx.length - 1]) out[i] = out[idx[idx.length - 1]];
    else { let k = 0; while (idx[k + 1] < i) k++; const a = idx[k], b = idx[k + 1]; out[i] = out[a] + (out[b] - out[a]) * (i - a) / (b - a); }
  }
  return out;
}
function localMaxima(x) {           // scipy _local_maxima_1d: 평탄 구간은 중앙
  const n = x.length, mids = [], lefts = [], rights = []; let i = 1;
  while (i < n - 1) {
    if (x[i - 1] < x[i]) { let ahead = i + 1; while (ahead < n - 1 && x[ahead] === x[i]) ahead++; if (x[ahead] < x[i]) { lefts.push(i); rights.push(ahead - 1); mids.push(Math.floor((i + ahead - 1) / 2)); i = ahead; } }
    i++;
  }
  return { mids, lefts, rights };
}
function prominences(x, peaks) {
  return peaks.map(p => {
    let i = p, leftMin = x[p]; while (i > 0 && x[i - 1] <= x[p]) { i--; if (x[i] < leftMin) leftMin = x[i]; }
    i = p; let rightMin = x[p]; while (i < x.length - 1 && x[i + 1] <= x[p]) { i++; if (x[i] < rightMin) rightMin = x[i]; }
    return x[p] - Math.max(leftMin, rightMin);
  });
}
function selectByDistance(peaks, priority, distance) {
  const keep = new Uint8Array(peaks.length).fill(1); const order = peaks.map((_, i) => i).sort((a, b) => priority[b] - priority[a]);
  for (const j of order) { if (!keep[j]) continue; let k = j - 1; while (k >= 0 && peaks[j] - peaks[k] < distance) { keep[k] = 0; k--; } k = j + 1; while (k < peaks.length && peaks[k] - peaks[j] < distance) { keep[k] = 0; k++; } }
  return peaks.filter((_, i) => keep[i]);
}
/** 극대(또는 극소) 인덱스. prominence 는 신호 범위 대비 비율 */
export function peaks(x, fps, minDistSec = 0.3, prominenceRatio = 0.2, maxima = true) {
  const xf = nanFill(x); if (xf.every(Number.isNaN)) return [];
  const sig = maxima ? xf : xf.map(v => -v);
  let mx = -Infinity, mn = Infinity; for (const v of sig) { if (v > mx) mx = v; if (v < mn) mn = v; }
  const rng = mx - mn; if (!(rng > 0)) return [];
  let { mids } = localMaxima(sig);
  const prom = prominences(sig, mids); mids = mids.filter((_, i) => prom[i] >= prominenceRatio * rng);
  const pr = prominences(sig, mids);
  const dist = Math.max(1, Math.floor(minDistSec * fps));
  // scipy 는 distance 선택 시 peak height 를 우선순위로 씀
  const picked = selectByDistance(mids, mids.map(i => sig[i]), dist);
  return picked.filter(i => !Number.isNaN(x[i]));
}
export function zeroCrossings(x, direction = "both") {
  const out = []; for (let i = 1; i < x.length; i++) {
    const a = Math.sign(x[i - 1]), b = Math.sign(x[i]); if (Number.isNaN(a) || Number.isNaN(b) || a === b || b === 0) continue;
    if (direction === "both" || (direction === "up" && b > 0) || (direction === "down" && b < 0)) out.push(i);
  }
  return out;
}
export function firstCrossing(x, start, stop, direction = "up") {
  for (let i = Math.max(start + 1, 1); i < stop; i++) {
    const a = Math.sign(x[i - 1]), b = Math.sign(x[i]); if (Number.isNaN(a) || Number.isNaN(b) || a === b || b === 0) continue;
    if (direction === "both" || (direction === "up" && b > 0) || (direction === "down" && b < 0)) return i;
  }
  return null;
}
