// MediaPipe Pose Landmarker (Tasks Vision, VIDEO 모드) 브라우저 래퍼
import { JOINTS, Landmarks } from "./keypoints.js";
import { seekTo, analysisSize, underwaterEnhance, toGray } from "./video.js";
import { CameraMotionDetector } from "./camera.js";

let visionMod = null;
const VENDOR = new URL("../vendor/", import.meta.url).href;      // 페이지 위치와 무관하게 vendor 폴더 절대 경로
export async function loadVision() {
  if (!visionMod) visionMod = await import(VENDOR + "mediapipe/vision_bundle.mjs");
  return visionMod;
}
export async function createLandmarker({ variant = "full", delegate = "GPU", base = VENDOR } = {}) {
  const vision = await loadVision();
  const fileset = await vision.FilesetResolver.forVisionTasks(base + "mediapipe/wasm");
  const make = (dl) => vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}models/pose_landmarker_${variant}.task`, delegate: dl }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  try { const lm = await make(delegate); lm._delegate = delegate; return lm; }
  catch (e) { console.warn("GPU delegate 실패 → CPU", e); const lm = await make("CPU"); lm._delegate = "CPU"; return lm; }
}
/**
 * 영상 전체를 프레임 단위로 돌며 랜드마크 추출.
 * opts: {fps, step, maxLong, underwater, cameraCfg, onProgress(i,total,msPerFrame), shouldStop()}
 */
export async function extractLandmarks(video, landmarker, opts) {
  const { fps, step = 1, maxLong = 960, underwater = false, onProgress = () => {}, shouldStop = () => false, cameraCfg = {} } = opts;
  const { width, height } = analysisSize(video, maxLong);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const nFrames = Math.floor(video.duration * fps); const idx = []; for (let f = 0; f < nFrames; f += step) idx.push(f);
  const lm = new Landmarks(idx.length, fps / step, width, height);
  const cam = new CameraMotionDetector(96, 3); const camW = 96, camH = Math.max(8, Math.round(height * 96 / width)); const camCanvas = document.createElement("canvas"); camCanvas.width = camW; camCanvas.height = camH; const camCtx = camCanvas.getContext("2d", { willReadFreq: true });
  const camStep = 3; const t0 = performance.now(); let lastTs = landmarker._lastTs ?? -1; const tsBase = lastTs + 1;
  for (let k = 0; k < idx.length; k++) {
    if (shouldStop()) throw new Error("사용자가 분석을 중단했습니다.");
    const f = idx[k], t = f / fps; await seekTo(video, Math.min(t, Math.max(0, video.duration - 0.001)));
    ctx.drawImage(video, 0, 0, width, height); if (underwater) underwaterEnhance(ctx, width, height);
    let ts = tsBase + Math.round(t * 1000); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts; landmarker._lastTs = ts;
    const res = landmarker.detectForVideo(canvas, ts);
    lm.frame[k] = f; lm.t_ms[k] = t * 1000;
    let bbox = null;
    if (res.landmarks && res.landmarks[0]) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      res.landmarks[0].slice(0, JOINTS.length).forEach((p, i) => { const vis = Math.min(p.visibility ?? 1, p.presence ?? 1); const x = p.x * width, y = p.y * height; lm.set(k, JOINTS[i], x, y, vis); if (vis > 0.3) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
      if (x0 < Infinity) { const s = camW / width, mx = (x1 - x0) * 0.25 + 20, my = (y1 - y0) * 0.25 + 20; bbox = [(x0 - mx) * s, (y0 - my) * s, (x1 + mx) * s, (y1 + my) * s]; }
    }
    if (k % camStep === 0) { camCtx.drawImage(canvas, 0, 0, camW, camH); cam.push(toGray(camCtx, camW, camH), camH, bbox); }
    if (k % 5 === 0 || k === idx.length - 1) onProgress(k + 1, idx.length, (performance.now() - t0) / (k + 1));
    if (k % 20 === 0) await new Promise(r => setTimeout(r, 0));   // UI 숨 쉴 틈
  }
  const camera = cam.result(cameraCfg, camStep * step, width / camW);
  return { lm, camera, width, height, msPerFrame: (performance.now() - t0) / Math.max(1, idx.length) };
}
/** 앞 N초를 돌려 검출률·신뢰도·속도 측정 (모델 추천용) */
export async function trial(video, landmarker, { fps, seconds = 3, step = 2, maxLong = 960, underwater = false }) {
  const { width, height } = analysisSize(video, maxLong); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const n = Math.min(Math.floor(seconds * fps), Math.floor(video.duration * fps)); let det = 0, vis = 0, cnt = 0; const t0 = performance.now(); let lastTs = landmarker._lastTs ?? -1; const tsBase = lastTs + 1;
  for (let f = 0; f < n; f += step) { await seekTo(video, f / fps); ctx.drawImage(video, 0, 0, width, height); if (underwater) underwaterEnhance(ctx, width, height); let ts = tsBase + Math.round(f / fps * 1000); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts; landmarker._lastTs = ts; const res = landmarker.detectForVideo(canvas, ts); cnt++; if (res.landmarks && res.landmarks[0]) { det++; const core = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]; vis += core.reduce((s, i) => s + Math.min(res.landmarks[0][i].visibility ?? 1, res.landmarks[0][i].presence ?? 1), 0) / core.length; } }
  return { detect_rate: cnt ? det / cnt : 0, mean_visibility: det ? vis / det : 0, ms_per_frame: (performance.now() - t0) / Math.max(1, cnt), frames: cnt };
}
