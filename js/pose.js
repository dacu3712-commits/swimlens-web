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
/** 확대 영역(roi, 분석 좌표계 {x,y,w,h})을 잘라 MediaPipe 입력 캔버스를 만든다. 반환: 좌표 변환 함수 */
function makeInput(video, width, height, roi) {
  const canvas = document.createElement("canvas"); let map;
  if (roi && roi.w > 10 && roi.h > 10) {
    const k = Math.min(4, 960 / Math.max(roi.w, roi.h)); canvas.width = Math.max(64, Math.round(roi.w * k)); canvas.height = Math.max(64, Math.round(roi.h * k));
    const sx = video.videoWidth / width, sy = video.videoHeight / height;
    const draw = (ctx) => ctx.drawImage(video, roi.x * sx, roi.y * sy, roi.w * sx, roi.h * sy, 0, 0, canvas.width, canvas.height);
    map = (p) => [roi.x + p.x * roi.w, roi.y + p.y * roi.h]; return { canvas, draw, map };
  }
  canvas.width = width; canvas.height = height;
  return { canvas, draw: (ctx) => ctx.drawImage(video, 0, 0, width, height), map: (p) => [p.x * width, p.y * height] };
}
/** 수영자 자동 추적 확대: 직전 프레임에서 찾은 사람 주변을 정사각형으로 잘라 고정 크기 캔버스에 키워 넣는다 */
function makeTracker(video, width, height, baseRoi, size = 720) {
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const B = baseRoi && baseRoi.w > 10 ? baseRoi : { x: 0, y: 0, w: width, h: height };
  let box = null, lost = 0;                       // {cx, cy, s} 분석 좌표계
  const sx = video.videoWidth / width, sy = video.videoHeight / height;
  let cur = null;
  function crop() {
    if (!box || lost > 2) { const s0 = Math.max(B.w, B.h); cur = { x: B.x + B.w / 2 - s0 / 2, y: B.y + B.h / 2 - s0 / 2, s: s0 }; }
    else cur = { x: box.cx - box.s / 2, y: box.cy - box.s / 2, s: box.s };
    return cur;
  }
  return {
    canvas,
    draw(ctx) { const c = crop(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size); ctx.drawImage(video, c.x * sx, c.y * sy, c.s * sx, c.s * sy, 0, 0, size, size); },
    map(p) { return [cur.x + p.x * cur.s, cur.y + p.y * cur.s]; },
    update(bb) {                                   // bb: [x0,y0,x1,y1] 분석 좌표, 없으면 null
      if (!bb) { lost++; return; } lost = 0;
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2; const s = Math.max(Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 1.6, Math.min(width, height) * 0.25);
      box = box ? { cx: box.cx * 0.4 + cx * 0.6, cy: box.cy * 0.4 + cy * 0.6, s: box.s * 0.5 + s * 0.5 } : { cx, cy, s };
      box.s = Math.min(box.s, Math.max(B.w, B.h) * 1.2);
    },
    get box() { return cur; },
  };
}
export function frameRange(duration, fps, step, start = 0, end = null) {
  const nFrames = Math.floor(duration * fps); const a = Math.max(0, Math.round((start || 0) * fps)); const b = Math.min(nFrames, end ? Math.ceil(end * fps) : nFrames);
  const idx = []; for (let f = a; f < b; f += step) idx.push(f); return idx;
}
/**
 * 영상 전체를 프레임 단위로 돌며 랜드마크 추출.
 * opts: {fps, step, maxLong, underwater, cameraCfg, onProgress(i,total,msPerFrame), shouldStop()}
 */
export async function extractLandmarks(video, landmarker, opts) {
  const { fps, step = 1, maxLong = 960, underwater = false, onProgress = () => {}, shouldStop = () => false, cameraCfg = {}, resume = null, onCheckpoint = null, checkpointEvery = 30, onPause = () => {}, start = 0, end = null, roi = null, track = false } = opts;
  const { width, height } = analysisSize(video, maxLong);
  const inp = track ? makeTracker(video, width, height, roi) : makeInput(video, width, height, roi); const canvas = inp.canvas; const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const idx = frameRange(video.duration, fps, step, start, end);
  const lm = new Landmarks(idx.length, fps / step, width, height);
  for (let k = 0; k < idx.length; k++) { lm.frame[k] = idx[k]; lm.t_ms[k] = idx[k] / fps * 1000; }
  let startK = 0;
  if (resume && resume.lm && resume.lm.n === idx.length) {      // 중단된 지점부터 이어서
    for (const j of JOINTS) { lm.data[j].x.set(resume.lm.data[j].x); lm.data[j].y.set(resume.lm.data[j].y); lm.data[j].v.set(resume.lm.data[j].v); }
    startK = Math.max(0, Math.min(idx.length, resume.k || 0));
  }
  const cam = new CameraMotionDetector(96, 3); if (resume?.camMags) cam.mags = [...resume.camMags]; const camW = 96, camH = Math.max(8, Math.round(height * 96 / width)); const camCanvas = document.createElement("canvas"); camCanvas.width = camW; camCanvas.height = camH; const camCtx = camCanvas.getContext("2d", { willReadFreq: true });
  const camStep = 3; const t0 = performance.now(); let lastTs = landmarker._lastTs ?? -1; const tsBase = lastTs + 1;
  let done = 0;
  for (let k = startK; k < idx.length; k++) {
    if (shouldStop()) throw new Error("사용자가 분석을 중단했습니다.");
    if (document.hidden) {                 // 다른 앱으로 가거나 화면이 꺼지면 브라우저가 영상을 멈추므로 기다렸다가 이어감
      onPause(true); await new Promise(r => { const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); r(); } }; document.addEventListener("visibilitychange", on); });
      onPause(false); cam.prev = null;
    }
    const f = idx[k], t = f / fps; await seekTo(video, Math.min(t, Math.max(0, video.duration - 0.001)));
    inp.draw(ctx); if (underwater) underwaterEnhance(ctx, canvas.width, canvas.height);
    let ts = tsBase + Math.round(t * 1000); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts; landmarker._lastTs = ts;
    const res = landmarker.detectForVideo(canvas, ts);
    lm.frame[k] = f; lm.t_ms[k] = t * 1000;
    let bbox = null;
    if (res.landmarks && res.landmarks[0]) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      res.landmarks[0].slice(0, JOINTS.length).forEach((p, i) => { const vis = Math.min(p.visibility ?? 1, p.presence ?? 1); const [x, y] = inp.map(p); lm.set(k, JOINTS[i], x, y, vis); if (vis > 0.3) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
      if (x0 < Infinity) { const s = camW / width, mx = (x1 - x0) * 0.25 + 20, my = (y1 - y0) * 0.25 + 20; bbox = [(x0 - mx) * s, (y0 - my) * s, (x1 + mx) * s, (y1 + my) * s]; if (inp.update) inp.update([x0, y0, x1, y1]); }
      else if (inp.update) inp.update(null);
    } else if (inp.update) inp.update(null);
    if (k % camStep === 0) { camCtx.drawImage(video, 0, 0, camW, camH); cam.push(toGray(camCtx, camW, camH), camH, bbox); }
    done++;
    if (k % 5 === 0 || k === idx.length - 1) onProgress(k + 1, idx.length, (performance.now() - t0) / done);
    if (onCheckpoint && (k + 1) % checkpointEvery === 0) await onCheckpoint(lm, k + 1, cam.mags);
    if (k % 20 === 0) await new Promise(r => setTimeout(r, 0));   // UI 숨 쉴 틈
  }
  const camera = cam.result(cameraCfg, camStep * step, width / camW);
  return { lm, camera, width, height, msPerFrame: (performance.now() - t0) / Math.max(1, done), resumedFrom: startK };
}
/** 앞 N초를 돌려 검출률·신뢰도·속도 측정 (모델 추천용) */
export async function trial(video, landmarker, { fps, seconds = 3, step = 2, maxLong = 960, underwater = false, start = 0, end = null, roi = null }) {
  const { width, height } = analysisSize(video, maxLong); const inp = makeInput(video, width, height, roi); const canvas = inp.canvas; const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const frames = frameRange(video.duration, fps, step, start, Math.min(end ?? Infinity, (start || 0) + seconds)); let det = 0, vis = 0, cnt = 0; const t0 = performance.now(); let lastTs = landmarker._lastTs ?? -1; const tsBase = lastTs + 1;
  for (const f of frames) { await seekTo(video, f / fps); inp.draw(ctx); if (underwater) underwaterEnhance(ctx, canvas.width, canvas.height); let ts = tsBase + Math.round(f / fps * 1000); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts; landmarker._lastTs = ts; const res = landmarker.detectForVideo(canvas, ts); cnt++; if (res.landmarks && res.landmarks[0]) { det++; const core = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]; vis += core.reduce((s, i) => s + Math.min(res.landmarks[0][i].visibility ?? 1, res.landmarks[0][i].presence ?? 1), 0) / core.length; } }
  return { detect_rate: cnt ? det / cnt : 0, mean_visibility: det ? vis / det : 0, ms_per_frame: (performance.now() - t0) / Math.max(1, cnt), frames: cnt };
}

/** 사진용 (IMAGE 모드) 랜드마커 */
let imgLmk = null, imgVariant = null;
export async function createImageLandmarker(variant = "heavy") {
  if (imgLmk && imgVariant === variant) return imgLmk;
  const vision = await loadVision(); const fileset = await vision.FilesetResolver.forVisionTasks(VENDOR + "mediapipe/wasm");
  const make = (dl) => vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${VENDOR}models/pose_landmarker_${variant}.task`, delegate: dl }, runningMode: "IMAGE", numPoses: 1, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 });
  try { imgLmk = await make("GPU"); } catch { imgLmk = await make("CPU"); }
  imgVariant = variant; return imgLmk;
}
/** canvas 한 장 → (33,3) 배열 [x, y, vis] (canvas 픽셀 좌표). 검출 실패 시 null */
export function detectImage(lmk, canvas) {
  const res = lmk.detect(canvas); if (!res.landmarks || !res.landmarks[0]) return null;
  return res.landmarks[0].slice(0, JOINTS.length).map(p => [p.x * canvas.width, p.y * canvas.height, Math.min(p.visibility ?? 1, p.presence ?? 1)]);
}
