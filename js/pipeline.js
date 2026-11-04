// 랜드마크 → 정제 → 좌표계 → 사이클 → 지표 (파이썬 pipeline.build_context / run_metrics)
import { cleanLandmarks } from "./signal/clean.js";
import { Frame2D, WaterLandmarks } from "./signal/coords.js";
import { segmentCycles } from "./signal/cycles.js";
import { runAll } from "./metrics/registry.js";
import { draftAll } from "./report/comments.js";

export function applyJointEdits(lm, edits) {
  if (!edits || !Object.keys(edits).length) return lm;
  const out = lm.clone();
  for (const [frame, joints] of Object.entries(edits)) { const i = out.indexOfFrame(+frame); if (out.frame[i] !== +frame) continue; for (const [j, [x, y]] of Object.entries(joints)) if (out.data[j]) out.set(i, j, x, y, 1); }
  return out;
}
/** 추정 직후 1회: 결측 처리 + 보간 + 스무딩 → 저장용 랜드마크와 품질 리포트 */
export function prepareLandmarks(rawLm, thresholds) { return cleanLandmarks(rawLm, thresholds.common, true); }

/** lm: 저장된(정제된) 랜드마크. report 가 없으면 스무딩 없이 품질만 다시 계산 (파이썬 build_context 와 동일) */
export function analyze({ lm: storedLm, report = null, settings, configs, review = {}, cameraMotion = null, log = () => {} }) {
  const th = configs.thresholds;
  if (!report) report = cleanLandmarks(storedLm, th.common, false).report;
  const lm = applyJointEdits(storedLm, review.joints || {});
  const frame2d = Frame2D.fromSettings(lm.width, lm.height, settings.waterline, settings.direction, settings.scale_points, settings.scale_meters);
  const wl = new WaterLandmarks(lm, frame2d);
  const cycles = segmentCycles(wl, settings.stroke, settings.camera_side_arm, th.cycle, settings.view);
  log(cycles.note ? "사이클: " + cycles.note : `사이클 ${cycles.cycles.length}개 검출 (분석 팔: ${cycles.side})`);
  const cam = Object.assign({}, cameraMotion || {}); const detectedMoving = !!cam.moving;
  if (settings.camera_mode === "moving") cam.note = "사용자가 '따라가며 촬영'으로 지정했습니다. " + (cam.note || "");
  else if (detectedMoving) { cam.note = "⚠️ '고정 삼각대'로 지정했지만 배경 움직임이 감지되었습니다. " + (cam.note || ""); log(cam.note); }
  const ctx = { settings, lm, wl, frame2d, clean: report, cycles, th, fps: lm.fps, cameraMoving: settings.camera_mode === "moving" || detectedMoving, cameraMotion: cam, overrides: review.events || {}, viewStatus: "ok", cache: {} };
  const results = runAll(ctx, configs.matrix, log);
  draftAll(results, configs.comments, review.comments || {});
  return { ctx, results, cycles: { side: cycles.side, n_cycles: cycles.cycles.length, cycles: cycles.cycles }, camera: cam, lm };
}
