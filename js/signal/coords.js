// 수면선 좌표계 (fwd = 진행 방향 +, depth = 수면 아래 +)
export class Frame2D {
  constructor(origin, angleRad, flipX = false, mPerPx = null) { this.origin = origin; this.angle = angleRad; this.flipX = flipX; this.m_per_px = mPerPx; }
  static fromSettings(width, height, waterline, direction, scalePoints, scaleMeters) {
    let origin = [0, 0.3 * height], ang = 0;
    if (waterline && waterline.length === 2) {
      let [p1, p2] = waterline; if (p1[0] > p2[0]) [p1, p2] = [p2, p1];
      ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]); origin = [p1[0], p1[1]];
    }
    let mpp = null;
    if (scalePoints && scaleMeters > 0 && scalePoints.length === 2) { const d = Math.hypot(scalePoints[0][0] - scalePoints[1][0], scalePoints[0][1] - scalePoints[1][1]); if (d > 1) mpp = scaleMeters / d; }
    return new Frame2D(origin, ang, direction === "rtl", mpp);
  }
  toWater(x, y) {
    const px = x - this.origin[0], py = y - this.origin[1], c = Math.cos(-this.angle), s = Math.sin(-this.angle);
    let fx = px * c - py * s; const d = px * s + py * c; if (this.flipX) fx = -fx; return [fx, d];
  }
  toPixel(f, d) {
    if (this.flipX) f = -f; const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [f * c - d * s + this.origin[0], f * s + d * c + this.origin[1]];
  }
}
/** 관절별 (fwd, depth) 시계열을 캐시하는 뷰 */
export class WaterLandmarks {
  constructor(lm, frame) { this.lm = lm; this.frame = frame; this.fps = lm.fps; this.n = lm.n; this._c = {}; }
  _get(j) {
    if (!this._c[j]) { const d = this.lm.data[j], f = new Float64Array(this.n), dp = new Float64Array(this.n); for (let i = 0; i < this.n; i++) { const [a, b] = this.frame.toWater(d.x[i], d.y[i]); f[i] = a; dp[i] = b; } this._c[j] = { fwd: f, depth: dp }; }
    return this._c[j];
  }
  fwd(j) { return this._get(j).fwd; } depth(j) { return this._get(j).depth; } v(j) { return this.lm.v(j); }
  midFwd(j1, j2) { const a = this.fwd(j1), b = this.fwd(j2), o = new Float64Array(this.n); for (let i = 0; i < this.n; i++) o[i] = Number.isNaN(a[i]) ? b[i] : Number.isNaN(b[i]) ? a[i] : (a[i] + b[i]) / 2; return o; }
  midDepth(j1, j2) { const a = this.depth(j1), b = this.depth(j2), o = new Float64Array(this.n); for (let i = 0; i < this.n; i++) o[i] = Number.isNaN(a[i]) ? b[i] : Number.isNaN(b[i]) ? a[i] : (a[i] + b[i]) / 2; return o; }
}
