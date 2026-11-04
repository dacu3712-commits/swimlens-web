// 영상 파일 → <video>, FPS 추정, 프레임 단위 이동, 캔버스 그리기
export function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const v = document.createElement("video");
    v.preload = "auto"; v.muted = true; v.playsInline = true; v.src = url;
    const fail = () => reject(new Error("이 브라우저가 영상 형식을 재생하지 못합니다 (아이폰 HEVC/H.265 일 가능성). 폰 카메라 설정을 '호환성 우선(H.264)'으로 바꿔 촬영하거나, 영상을 mp4(H.264)로 변환한 뒤 다시 올려 주세요. 아이폰이라면 Safari 에서 열면 재생됩니다."));
    const timer = setTimeout(() => { if (!(v.videoWidth > 0)) fail(); }, 20000);
    v.addEventListener("loadedmetadata", () => { clearTimeout(timer); if (v.videoWidth > 0) resolve(v); else fail(); }, { once: true });
    v.addEventListener("error", () => { clearTimeout(timer); fail(); }, { once: true });
  });
}
/** requestVideoFrameCallback 으로 1.5초 재생해 FPS 추정 (없으면 30) */
export async function estimateFps(v) {
  if (!("requestVideoFrameCallback" in v)) return 30;
  const times = []; v.currentTime = 0; v.muted = true;
  await new Promise(res => { const onF = (now, meta) => { times.push(meta.mediaTime); if (times.length < 40 && meta.mediaTime < Math.min(1.5, v.duration)) v.requestVideoFrameCallback(onF); else res(); }; v.requestVideoFrameCallback(onF); v.play().catch(() => res()); setTimeout(res, 4000); });
  v.pause();
  const d = []; for (let i = 1; i < times.length; i++) { const dt = times[i] - times[i - 1]; if (dt > 1e-4) d.push(dt); }
  if (d.length < 5) return 30;
  d.sort((a, b) => a - b); const med = d[d.length >> 1]; const fps = 1 / med;
  const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]; const near = common.reduce((a, b) => Math.abs(b - fps) < Math.abs(a - fps) ? b : a);
  return Math.abs(near - fps) / fps < 0.03 ? near : Math.round(fps * 100) / 100;
}
export function seekTo(v, t) {
  return new Promise(res => { if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res(); const on = () => { v.removeEventListener("seeked", on); res(); }; v.addEventListener("seeked", on); v.currentTime = t; setTimeout(() => { v.removeEventListener("seeked", on); res(); }, 3000); });
}
/** 분석 해상도 (긴 변 maxLong 이하, 짝수) */
export function analysisSize(v, maxLong = 960) {
  const w = v.videoWidth, h = v.videoHeight, s = Math.min(1, maxLong / Math.max(w, h));
  return { width: Math.floor(w * s / 2) * 2, height: Math.floor(h * s / 2) * 2, scale: s };
}
/** 수중 전처리: 그레이월드 색보정 + 간단한 대비 스트레칭 (CLAHE 근사) */
export function underwaterEnhance(ctx, w, h, strength = 0.8) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data; let r = 0, g = 0, b = 0; const n = w * h;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  r /= n; g /= n; b /= n; const gray = (r + g + b) / 3; const gain = [gray / (r + 1e-6), gray / (g + 1e-6), gray / (b + 1e-6)].map(x => Math.min(2.5, Math.max(0.5, 1 + (x - 1) * strength)));
  const hist = new Uint32Array(256); for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * gain[0]); d[i + 1] = Math.min(255, d[i + 1] * gain[1]); d[i + 2] = Math.min(255, d[i + 2] * gain[2]); hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++; }
  let lo = 0, hi = 255, acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } } acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
  const k = 255 / Math.max(1, hi - lo); for (let i = 0; i < d.length; i += 4) { d[i] = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - lo) * k)); d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - lo) * k)); }
  ctx.putImageData(img, 0, 0);
}
export function toGray(ctx, w, h) { const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8ClampedArray(w * h); for (let i = 0, k = 0; i < d.length; i += 4, k++) g[k] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; return g; }
