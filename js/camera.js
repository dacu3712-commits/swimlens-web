// 카메라 이동 감지: 축소한 흑백 프레임을 사람 영역 제외하고 정수 이동량 탐색(블록 매칭)
export class CameraMotionDetector {
  constructor(workWidth = 96, maxShift = 3) { this.w = workWidth; this.maxShift = maxShift; this.prev = null; this.mags = []; this.scale = 1; }
  /** gray: Uint8ClampedArray(w*h), bbox: [x0,y0,x1,y1] 작은 프레임 기준 (없으면 null) */
  push(gray, h, bbox) {
    const w = this.w;
    if (this.prev) {
      let best = Infinity, bdx = 0, bdy = 0;
      for (let dy = -this.maxShift; dy <= this.maxShift; dy++) for (let dx = -this.maxShift; dx <= this.maxShift; dx++) {
        let s = 0, k = 0;
        for (let y = this.maxShift; y < h - this.maxShift; y += 2) for (let x = this.maxShift; x < w - this.maxShift; x += 2) {
          if (bbox && x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]) continue;
          s += Math.abs(gray[y * w + x] - this.prev[(y + dy) * w + (x + dx)]); k++;
        }
        if (k && s / k < best) { best = s / k; bdx = dx; bdy = dy; }
      }
      this.mags.push(Math.hypot(bdx, bdy));
    }
    this.prev = gray;
  }
  result(cfg, sampleStep, scale) {    // scale = 분석 해상도 / 작업 해상도
    const thr = cfg.flow_threshold_px ?? 1.5, ratioThr = cfg.moving_ratio_threshold ?? 0.2;
    if (!this.mags.length) return { moving: false, moving_ratio: 0, median_flow_px: 0, note: "샘플이 부족해 카메라 이동을 판단하지 못했습니다." };
    const px = this.mags.map(m => m * scale / sampleStep);
    const movingRatio = px.filter(v => v > thr).length / px.length;
    const sorted = [...px].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    const moving = movingRatio >= ratioThr;
    return { moving, moving_ratio: +movingRatio.toFixed(3), median_flow_px: +med.toFixed(2), threshold_px: thr, samples: px.length,
      note: moving ? `배경이 움직이는 구간이 ${Math.round(movingRatio * 100)}% 입니다 → 따라가며 촬영한 영상으로 판단해 속도·거리 지표는 측정하지 않습니다.` : `배경 이동 ${Math.round(movingRatio * 100)}% → 고정 카메라로 판단` };
  }
}
