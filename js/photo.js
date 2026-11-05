// 📷 사진 분석 모드: 코치가 고른 캡처 이미지(최대 12장)로 각도 지표를 계산하고 PDF 를 만든다.
// 시간 정보가 필요한 지표(구간 시간·킥 타이밍·호흡 속도·브레이크아웃)는 사진 모드에서 측정하지 않는다.
import { JOINTS, KO_NAMES, EDITABLE_JOINTS, Landmarks } from "./keypoints.js";
import { createImageLandmarker, detectImage } from "./pose.js";
import { angleAt, meanOf } from "./signal/geometry.js";
import { Frame2D } from "./signal/coords.js";
import { bodyLineAngle } from "./metrics/m8_streamline.js";
import { trafficByRange, trafficByMax, worst, stats, needsReview } from "./metrics/base.js";
import { drawSkeleton, drawAngle, label, personBox } from "./viz/draw.js";
import { draftAll } from "./report/comments.js";
import { buildPdf } from "./report/pdf.js";
import * as db from "./storage.js";
import { loadRefs, saveRef, deleteRef, alignRef, drawRef, refAngle } from "./viz/reference.js";
import { attachPolish, measuresOf } from "./polishui.js";
import { gatherHistory, historyHtml, historyChartSpec } from "./history.js";
let REFS = {};
import { initCandidates, renderCandidates } from "./candidates.js";

export const KINDS = {
  catch: "캐치 끝 (팔꿈치 각도)",
  kick: "킥 직전 (무릎·골반 각도)",
  glide: "글라이드·유선형 (하체 가라앉음)",
  roll: "정면/후면 최대 롤링 (어깨 기울기)",
  other: "기타 (각도만 참고)",
};
const MAX_PHOTOS = 12, MAX_SIDE = 1600, VIEW_W = 900;
const P = { name: "수강생", stroke: "freestyle", photos: [], id: null, created: null, comments: {}, extra: {}, busy: false, showRef: true };
let ctx = null;   // {app, $, esc, toast, configs, download, loadFonts, STROKES, VIEWS, CAMERA_MODES, renderNav}

function lmFrom(arr, w, h) { const lm = new Landmarks(1, 1, w, h); lm.frame[0] = 0; arr.forEach((p, i) => lm.set(0, JOINTS[i], p[0], p[1], p[2])); return lm; }
function pt(lm, j) { return [lm.x(j)[0], lm.y(j)[0]]; }
function ang(lm, a, b, c) { const [ax, ay] = pt(lm, a), [bx, by] = pt(lm, b), [cx, cy] = pt(lm, c); return angleAt(ax, ay, bx, by, cx, cy); }
function nz(v) { return Number.isNaN(v) ? null : v; }

/** 사진 한 장의 측정값 */
export function measure(photo) {
  const lm = photo.lm; if (!lm) return {};
  const s = photo.side; const fr = Frame2D.fromSettings(lm.width, lm.height, photo.waterline?.length === 2 ? photo.waterline : null, "ltr");
  const W = (j) => fr.toWater(...pt(lm, j));
  const m = { elbow: nz(ang(lm, `${s}_shoulder`, `${s}_elbow`, `${s}_wrist`)), knee: nz(ang(lm, `${s}_hip`, `${s}_knee`, `${s}_ankle`)), hip: nz(ang(lm, `${s}_shoulder`, `${s}_hip`, `${s}_knee`)) };
  const ears = meanOf([W("left_ear"), W("right_ear")]); const head = Number.isNaN(ears[0]) ? W("nose") : ears;
  const hp = W(`${s}_hip`), ak = W(`${s}_ankle`);
  m.sink = nz(bodyLineAngle(head, hp, ak)); m.bend = nz(180 - angleAt(head[0], head[1], hp[0], hp[1], ak[0], ak[1]));
  const L = W("left_shoulder"), R = W("right_shoulder"); m.roll = nz(Math.atan2(-(L[1] - R[1]), Math.abs(L[0] - R[0]) + 1e-9) * 180 / Math.PI);
  const HL = W("left_hip"), HR = W("right_hip"); m.hipRoll = nz(Math.atan2(-(HL[1] - HR[1]), Math.abs(HL[0] - HR[0]) + 1e-9) * 180 / Math.PI);
  const core = { catch: [`${s}_shoulder`, `${s}_elbow`, `${s}_wrist`], kick: [`${s}_hip`, `${s}_knee`, `${s}_ankle`], glide: ["nose", `${s}_hip`, `${s}_ankle`], roll: ["left_shoulder", "right_shoulder"], other: [`${s}_elbow`, `${s}_knee`] }[photo.kind];
  m.conf = Math.round(100 * core.reduce((a, j) => a + (photo.edited?.[j] ? 1 : lm.v(j)[0]), 0) / core.length);
  return m;
}
function needJoints(p) { const s = p.side; return { catch: [`${s}_shoulder`, `${s}_elbow`, `${s}_wrist`], kick: [`${s}_hip`, `${s}_knee`, `${s}_ankle`, `${s}_shoulder`], glide: ["nose", `${s}_hip`, `${s}_ankle`], roll: ["left_shoulder", "right_shoulder"], other: [] }[p.kind]; }
function missing(p) { return needJoints(p).filter(j => !p.lm || Number.isNaN(p.lm.x(j)[0])); }
function photoLine(p) {
  const miss = missing(p); if (miss.length) return `👉 사진에서 ${miss.map(j => KO_NAMES[j] || j).join(" → ")} 위치를 차례로 눌러 주세요`;
  const m = p.m || {}; const f = (v, d = 0) => v === null || v === undefined ? "-" : v.toFixed(d) + "°";
  const ref = REFS[p.kind]; const rj = { catch: ["_shoulder", "_elbow", "_wrist"], kick: ["_hip", "_knee", "_ankle"] }[p.kind]; const ra = ref && rj ? refAngle(ref, rj.map(x => p.side + x)) : null;
  const refTxt = ra !== null && ra !== undefined ? ` (모범 ${ra.toFixed(0)}°)` : "";
  return { catch: `팔꿈치 ${f(m.elbow)}${refTxt}`, kick: `무릎 ${f(m.knee)}${refTxt} · 골반 ${f(m.hip)}`, glide: `하체 가라앉음 ${f(m.sink, 1)} · 골반 꺾임 ${f(m.bend, 1)}`, roll: `어깨 ${f(m.roll)} (${(m.roll ?? 0) >= 0 ? "왼쪽" : "오른쪽"} 올라옴) · 골반 ${f(m.hipRoll)}`, other: `팔꿈치 ${f(m.elbow)} · 무릎 ${f(m.knee)}` }[p.kind] + ` · 신뢰도 ${m.conf ?? "-"}`;
}

/** 사진들 → 지표 결과 (영상 모드와 같은 구조라 PDF·코멘트를 그대로 씀) */
export function buildResults(photos, configs) {
  const th = configs.thresholds, mx = configs.matrix.metrics; const R = {};
  const base = (key) => ({ key, name: mx[key]?.name || key, status: "ok", traffic: "na", confidence: 0, summary: {}, per_cycle: [], events: [], charts: [], captures: [], reason: "", notes: ["📷 사진 분석: 코치가 고른 사진 기준"], comment: "", drills: [] });
  const un = (key, reason) => ({ ...base(key), status: "unmeasured", notes: [], reason });
  const of = (k) => photos.filter(p => p.kind === k && p.lm && p.m && !missing(p).length);
  const conf = (ps) => ps.length ? ps.reduce((a, p) => a + (p.m.conf || 0), 0) / ps.length : 0;
  const cap = (p, i, caption, primary) => ({ photoIndex: photos.indexOf(p), caption, primary });
  // 1) 캐치
  let ps = of("catch");
  if (ps.length) { const r = base("catch_angle"), c = th.catch_angle; const st = stats(ps.map(p => p.m.elbow)); r.summary = { mean: st.mean, std: st.std, n: st.n, green_range: c.green }; r.traffic = trafficByRange(st.mean, c.green, c.yellow_margin); r.confidence = conf(ps); r.per_cycle = ps.map((p, i) => ({ cycle: i + 1, angle: p.m.elbow })); r.charts.push({ type: "bar", title: "사진별 팔꿈치 캐치 각도", ylabel: "각도 (°)", values: ps.map(p => p.m.elbow), labels: ps.map((p, i) => `사진${photos.indexOf(p) + 1}`), green: c.green, yellowMargin: c.yellow_margin }); r.captures = ps.map((p, i) => cap(p, i, `사진 ${photos.indexOf(p) + 1} 캐치 각도 ${p.m.elbow?.toFixed(0) ?? "-"}°`, i === 0)); R.catch_angle = r; }
  else R.catch_angle = un("catch_angle", "'캐치 끝' 사진이 없습니다");
  R.split_time = un("split_time", "사진 모드: 구간별 시간은 영상(시간 정보)이 있어야 측정할 수 있습니다");
  // 3) 롤링
  ps = of("roll");
  if (ps.length) { const r = base("rolling"), c = th.rolling; const L = ps.filter(p => (p.m.roll ?? 0) >= 0).map(p => p.m.roll), Rr = ps.filter(p => (p.m.roll ?? 0) < 0).map(p => -p.m.roll); const ls = stats(L), rs = stats(Rr); const asym = ls.mean !== null && rs.mean !== null ? Math.abs(ls.mean - rs.mean) : null;
    r.summary = { left_max_mean: ls.mean, right_max_mean: rs.mean, asymmetry: asym, hip_left_mean: stats(ps.filter(p => (p.m.roll ?? 0) >= 0).map(p => p.m.hipRoll)).mean, hip_right_mean: stats(ps.filter(p => (p.m.roll ?? 0) < 0).map(p => -(p.m.hipRoll ?? NaN))).mean, green_range: c.green, n: ps.length };
    const lights = []; for (const [sd, v] of [["왼쪽", ls.mean], ["오른쪽", rs.mean]]) { if (v === null) continue; const l = trafficByRange(v, c.green, c.yellow_margin); lights.push(l); if (l !== "green" && !r.summary.worse_side) { r.summary.worse_side = sd; r.summary.worse_value = v; } }
    if (asym !== null) lights.push(asym >= c.asymmetry_red_deg ? "red" : asym >= c.asymmetry_yellow_deg ? "yellow" : "green"); else r.notes.push("왼쪽·오른쪽 롤링 사진이 모두 있어야 좌우 비대칭을 볼 수 있습니다.");
    r.traffic = worst(...lights); r.confidence = conf(ps); r.captures = ps.map((p, i) => cap(p, i, `사진 ${photos.indexOf(p) + 1} 어깨 ${p.m.roll?.toFixed(0)}°`, i === 0)); R.rolling = r; }
  else R.rolling = un("rolling", "'최대 롤링' (정면/후면) 사진이 없습니다");
  R.hand_path = un("hand_path", "사진 모드: 손 궤적은 연속된 영상 프레임이 필요합니다");
  // 5) 무릎/골반
  ps = of("kick");
  if (ps.length) { const r = base("knee_hip_kick"), c = th.knee_hip_kick; const st = stats(ps.map(p => p.m.knee)); r.summary = { knee_mean: st.mean, knee_std: st.std, hip_mean: stats(ps.map(p => p.m.hip)).mean, n: st.n, knee_green: c.knee_green, timing_enabled: false }; r.traffic = trafficByRange(st.mean, c.knee_green, c.knee_yellow_margin, c.knee_red_below); r.confidence = conf(ps); r.notes.push("킥 타이밍(ms)은 영상 분석에서만 측정합니다.");
    r.charts.push({ type: "bar", title: "사진별 킥 직전 무릎 각도", ylabel: "각도 (°)", values: ps.map(p => p.m.knee), labels: ps.map(p => `사진${photos.indexOf(p) + 1}`), green: c.knee_green, yellowMargin: c.knee_yellow_margin }); r.captures = ps.map((p, i) => cap(p, i, `사진 ${photos.indexOf(p) + 1} 무릎 ${p.m.knee?.toFixed(0) ?? "-"}°`, i === 0)); R.knee_hip_kick = r; }
  else R.knee_hip_kick = un("knee_hip_kick", "'킥 직전' 사진이 없습니다");
  R.breathing_speed = un("breathing_speed", "사진 모드: 속도 비교는 영상이 필요합니다");
  R.breakout = un("breakout", "사진 모드: 브레이크아웃 타이밍은 영상이 필요합니다");
  // 8) 유선형
  ps = of("glide");
  if (ps.length) { const r = base("streamline"), c = th.streamline; const st = stats(ps.map(p => Math.abs(p.m.sink ?? NaN))), bst = stats(ps.map(p => p.m.bend)); r.summary = { sink_angle_mean: st.mean, sink_angle_max: st.max, hip_bend_mean: bst.mean, n: st.n, green_max: c.sink_angle_green_max, yellow_max: c.sink_angle_yellow_max };
    let l = trafficByMax(st.mean, c.sink_angle_green_max, c.sink_angle_yellow_max); if (bst.mean !== null) { l = worst(l, trafficByMax(Math.abs(bst.mean), c.hip_bend_yellow_deg, c.hip_bend_red_deg)); if (Math.abs(bst.mean) > c.hip_bend_yellow_deg) r.notes.push(`골반이 머리–발목 직선에서 평균 ${Math.abs(bst.mean).toFixed(0)}° 꺾여 있습니다.`); }
    r.traffic = l; r.confidence = conf(ps); r.notes.push(ps.some(p => p.waterline?.length === 2) ? "수면선 기준으로 기울기를 쟀습니다." : "수면선을 지정하지 않아 사진의 가로선을 수면으로 보고 쟀습니다 (사진이 기울면 오차).");
    r.charts.push({ type: "bar", title: "사진별 하체 가라앉음 각도", ylabel: "각도 (°)", values: ps.map(p => p.m.sink), labels: ps.map(p => `사진${photos.indexOf(p) + 1}`), green: [-c.sink_angle_green_max, c.sink_angle_green_max], yellowMargin: c.sink_angle_yellow_max - c.sink_angle_green_max }); r.captures = ps.map((p, i) => cap(p, i, `사진 ${photos.indexOf(p) + 1} 가라앉음 ${p.m.sink?.toFixed(1) ?? "-"}°`, i === 0)); R.streamline = r; }
  else R.streamline = un("streamline", "'글라이드·유선형' 사진이 없습니다");
  for (const r of Object.values(R)) r.needs_review = needsReview(r, th);
  return R;
}

// ------------------------------------------------------------------ 화면
export function initPhoto(c) {
  ctx = c;
  initCandidates({ $: c.$, esc: c.esc, toast: c.toast,
    addSelected: async (cand, canvas) => { await addPhotoFromCanvas(canvas, { kind: cand.kind, name: `영상 ${cand.t.toFixed(2)}초`, side: cand.side || "right" }); },
    onDone: () => { renderPhoto(); setTimeout(() => c.$("#pGrid")?.scrollIntoView({ behavior: "smooth" }), 300); } });
}
export function photoState() { return P; }
async function loadImageFile(file) {
  const bmp = await createImageBitmap(file); const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
  return cv;
}
async function detectPhoto(p) {
  const lmk = await createImageLandmarker("heavy"); const arr = detectImage(lmk, p.canvas);
  p.auto = arr; p.lm = arr ? lmFrom(arr, p.canvas.width, p.canvas.height) : null; p.edited = {};
  if (p.lm && p.kind !== "roll") { const l = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"].reduce((a, j) => a + p.lm.v("left_" + j)[0], 0), r = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"].reduce((a, j) => a + p.lm.v("right_" + j)[0], 0); p.side = l > r ? "left" : "right"; }
  p.m = measure(p);
}
async function addFiles(files) {
  const { toast } = ctx; const list = [...files].filter(f => f.type.startsWith("image/")).slice(0, MAX_PHOTOS - P.photos.length);
  if (!list.length) return toast("이미지 파일(jpg, png)을 골라 주세요");
  if (!P.id) { P.id = "photo_" + db.newId(P.name); P.created = Date.now(); }
  P.busy = true; renderPhoto();
  for (const [n, f] of list.entries()) {
    ctx.$("#photoStatus") && (ctx.$("#photoStatus").textContent = `사진 ${n + 1}/${list.length} 분석 중… (첫 사진은 모델을 받느라 오래 걸립니다)`);
    try { const canvas = await loadImageFile(f); const p = { canvas, blob: f, name: f.name, kind: guessKind(P.photos.length), side: "right", waterline: [], mode: "joint" }; await detectPhoto(p); P.photos.push(p); if (!p.lm) toast(`${f.name}: 사람을 찾지 못했습니다. 관절을 직접 찍어 주세요.`, 4000); }
    catch (e) { console.error(e); toast(`${f.name} 처리 실패: ${e.message}`, 5000); }
  }
  P.busy = false; await savePhoto(); renderPhoto();
}
function guessKind(i) { return ["catch", "catch", "kick", "kick", "glide", "glide", "roll", "roll"][i] || "other"; }
export async function savePhoto() {
  if (!P.id) return;
  try { await db.saveSession({ id: P.id, kind: "photo", name: P.name, created: P.created, settings: { stroke: P.stroke, view: "photo" }, hasMetrics: P.photos.some(p => p.lm), photo: { comments: P.comments, extra: P.extra, items: P.photos.map(p => ({ blob: p.blob, name: p.name, kind: p.kind, side: p.side, waterline: p.waterline, auto: p.auto, edited: p.edited, w: p.canvas.width, h: p.canvas.height, lm: p.lm ? JOINTS.map(j => [p.lm.x(j)[0], p.lm.y(j)[0], p.lm.v(j)[0]]) : null })) } }); }
  catch (e) { console.warn(e); }
}
export async function openPhotoSession(rec) {
  P.id = rec.id; P.name = rec.name; P.created = rec.created; P.stroke = rec.settings?.stroke || "freestyle"; P.comments = rec.photo?.comments || {}; P.extra = rec.photo?.extra || {}; P.photos = [];
  for (const it of rec.photo?.items || []) { const canvas = await loadImageFile(it.blob); const p = { canvas, blob: it.blob, name: it.name, kind: it.kind, side: it.side, waterline: it.waterline || [], auto: it.auto, edited: it.edited || {}, mode: "joint" }; p.lm = it.lm ? lmFrom(it.lm.map(q => [q[0] ?? NaN, q[1] ?? NaN, q[2]]), canvas.width, canvas.height) : null; p.m = measure(p); P.photos.push(p); }
}
/** 검수 화면에서 보낸 프레임을 사진으로 추가. lmArr: (33,[x,y,v]) canvas 좌표 */
export async function addPhotoFromCanvas(canvas, { kind = "other", side = "right", lmArr = null, name = "영상 캡처", student = null, stroke = null }) {
  if (student && !P.photos.length) P.name = student; if (stroke && !P.photos.length) P.stroke = stroke;
  if (!P.id) { P.id = "photo_" + db.newId(P.name); P.created = Date.now(); }
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.92));
  const p = { canvas, blob, name, kind, side, waterline: [], mode: "joint", edited: {} };
  if (lmArr) { p.auto = lmArr; p.lm = lmFrom(lmArr, canvas.width, canvas.height); } else { await detectPhoto(p); }
  p.m = measure(p); P.photos.push(p); await savePhoto(); return P.photos.length;
}
/** 저장된 사진 세션 → 지표 (기록 비교용, 이미지 없이) */
export function photoMetricsOf(rec, configs) {
  const photos = (rec.photo?.items || []).filter(it => it.lm).map(it => { const p = { kind: it.kind, side: it.side, waterline: it.waterline || [], edited: it.edited || {} }; p.lm = lmFrom(it.lm.map(q => [q[0] ?? NaN, q[1] ?? NaN, q[2]]), it.w, it.h); p.m = measure(p); return p; });
  return buildResults(photos, configs);
}
export function newPhotoSession() { P.id = null; P.photos = []; P.comments = {}; P.extra = {}; P.created = null; }

export async function renderPhoto() {
  const { app, $, esc, STROKES, toast } = ctx;
  try { REFS = await loadRefs(); } catch { REFS = {}; }
  const results = buildResults(P.photos, ctx.configs); draftAll(results, ctx.configs.comments, P.comments);
  app.innerHTML = `<div id="candBox"></div><div class="card"><h2>📷 사진 분석</h2>
  <p class="muted">영상 대신 <b>분석하고 싶은 순간의 캡처 사진</b>(최대 ${MAX_PHOTOS}장)을 올리세요. 사진마다 어떤 순간인지 고르면 각도 지표와 PDF 를 만듭니다. 점을 끌어서 관절을 바로 고칠 수 있습니다.</p>
  <div class="grid"><label class="f">수강생 이름<input type="text" id="pName" value="${esc(P.name)}"></label><label class="f">영법<select id="pStroke">${Object.entries(STROKES).map(([k, v]) => `<option value="${k}" ${k === P.stroke ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
  <label class="drop" id="pDrop" style="margin-top:8px"><input type="file" id="pFiles" accept="image/*" multiple><div>🖼 여기를 눌러 사진을 고르거나 끌어다 놓으세요 (${P.photos.length}/${MAX_PHOTOS})</div><div class="muted">권장: 캐치 끝 2~3장, 킥 직전 2장, 글라이드 2장, (정면이면) 좌·우 최대 롤링 각 1장</div></label>
  <p id="photoStatus" class="muted">${P.busy ? "분석 중…" : ""}</p>
  <label class="c"><input type="checkbox" id="pShowRef" ${P.showRef ? "checked" : ""}> ⭐ 모범 자세 겹쳐 보기 <span class="muted">(${Object.keys(REFS).length ? "저장된 모범: " + Object.keys(REFS).map(k => KINDS[k].split(" ")[0]).join(", ") : "아직 없음 — 코치님 사진에서 ⭐ 버튼으로 저장"})</span></label>
  ${P.photos.length ? `<p><button class="btn small sec" id="pNew">새 사진 분석 시작</button></p>` : ""}
  </div>
  <div class="events" id="pGrid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${P.photos.map((p, i) => `<div class="ev" data-i="${i}"><div class="canvas-wrap"><canvas class="pc" data-i="${i}" style="touch-action:none"></canvas></div>
    <div class="cap"><b>사진 ${i + 1}</b> ${esc(p.name)} ${p.lm ? "" : "<span style='color:#d64545'>· 사람 미검출 — 관절을 찍어 주세요</span>"}</div>
    <label class="f">이 사진의 순간<select data-k="kind" data-i="${i}">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === p.kind ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    ${p.kind !== "roll" ? `<label class="f">분석할 쪽 (카메라 쪽 팔·다리)<select data-k="side" data-i="${i}"><option value="right" ${p.side === "right" ? "selected" : ""}>오른쪽</option><option value="left" ${p.side === "left" ? "selected" : ""}>왼쪽</option></select></label>` : ""}
    <div class="btns" style="margin-top:6px"><button data-act="joint" data-i="${i}" class="${p.mode === "joint" ? "active" : ""}">✋ 관절 끌기</button><button data-act="wl" data-i="${i}" class="${p.mode === "wl" ? "active" : ""}">〰 수면선 2점${p.waterline?.length === 2 ? " ✅" : ""}</button><button data-act="reset" data-i="${i}" title="자동 결과로 되돌리기">↺</button><button data-act="ref" data-i="${i}" title="이 사진을 이 순간의 모범 자세로 저장">⭐</button><button data-act="del" data-i="${i}">🗑</button></div>
    <div class="info" style="margin-top:6px" data-line="${i}">${esc(photoLine(p))}</div></div>`).join("")}</div>
  ${P.photos.length ? `<div class="card"><h3>결과 요약</h3><div class="cards">${Object.values(results).map(r => `<div class="tcard t-${r.traffic} ${r.needs_review ? "review" : ""}"><b>${r.name}</b>${{ green: "🟢 좋음", yellow: "🟡 주의", red: "🔴 개선 필요", info: "🔵 참고", na: "⚪ 측정 불가" }[r.traffic]}${r.status !== "unmeasured" ? ` · 신뢰도 ${r.confidence.toFixed(0)}` : ""}</div>`).join("")}</div>
  <h3>코치 코멘트 <span class="muted">(자동 초안 — 고치면 PDF 에 반영)</span></h3>${["catch_angle", "knee_hip_kick", "streamline", "rolling"].filter(k => results[k].status !== "unmeasured").map(k => `<label class="f">${results[k].name}<textarea data-cm="${k}">${esc(P.comments[k] || results[k].comment)}</textarea></label>`).join("")}
  <h3>📈 이전 기록과 비교</h3><div id="pHistory" class="muted">불러오는 중…</div>
  <label class="f">우선 개선 포인트 / 마무리 한마디<textarea id="pClosing" style="min-height:60px">${esc(P.extra.closing || "")}</textarea></label>
  <p><button class="btn" id="pPdf">📄 PDF 리포트 만들기</button> <span id="pPdfStatus" class="muted"></span></p></div>` : ""}`;
  // 이벤트
  renderCandidates($("#candBox"));
  $("#pName").onchange = (e) => { P.name = e.target.value; savePhoto(); }; $("#pStroke").onchange = (e) => { P.stroke = e.target.value; savePhoto(); };
  const drop = $("#pDrop"); drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); }); drop.addEventListener("dragleave", () => drop.classList.remove("over")); drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
  $("#pFiles").onchange = (e) => addFiles(e.target.files);
  $("#pNew")?.addEventListener("click", () => { if (confirm("지금 사진들은 📂 목록에 저장되어 있습니다. 새로 시작할까요?")) { newPhotoSession(); renderPhoto(); } });
  app.querySelectorAll("select[data-k]").forEach(el => el.onchange = () => { const p = P.photos[+el.dataset.i]; p[el.dataset.k] = el.value; p.m = measure(p); savePhoto(); renderPhoto(); });
  app.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { const i = +b.dataset.i, p = P.photos[i], a = b.dataset.act;
    if (a === "del") { if (confirm(`사진 ${i + 1}을 뺄까요?`)) { P.photos.splice(i, 1); savePhoto(); renderPhoto(); } return; }
    if (a === "reset") { p.lm = p.auto ? lmFrom(p.auto, p.canvas.width, p.canvas.height) : null; p.edited = {}; p.waterline = []; p.view = null; p.m = measure(p); savePhoto(); renderPhoto(); return; }
    if (a === "ref") { if (!p.lm) return toast("관절이 있는 사진만 모범으로 저장할 수 있습니다");
      if (!confirm(`사진 ${i + 1}을 '${KINDS[p.kind]}'의 모범 자세로 저장할까요? (기존 모범은 바뀝니다)`)) return;
      const c = document.createElement("canvas"); drawPhoto(c, p, null); saveRef(p.kind, p.lm, 0, p.side, c.toDataURL("image/jpeg", 0.6)).then(() => { toast("⭐ 모범 자세로 저장했습니다"); renderPhoto(); }); return; }
    p.mode = a; if (a === "wl") { p.waterline = []; toast("사진에서 수면선 위의 두 점을 차례로 누르세요"); } renderPhoto(); });
  app.querySelectorAll("textarea[data-cm]").forEach(t => t.onchange = () => { P.comments[t.dataset.cm] = t.value; savePhoto(); });
  $("#pClosing")?.addEventListener("change", (e) => { P.extra.closing = e.target.value; savePhoto(); });
  $("#pPdf")?.addEventListener("click", makePhotoPdf);
  $("#pShowRef").onchange = (e) => { P.showRef = e.target.checked; renderPhoto(); };
  app.querySelectorAll("textarea[data-cm]").forEach(t => { const r = results[t.dataset.cm]; attachPolish(t, { metric: r.name, measures: measuresOf(r), esc, toast, onApply: (v) => { P.comments[t.dataset.cm] = v; savePhoto(); } }); });
  if (P.photos.length) gatherHistory(P.name, { photoMetrics: (rec) => photoMetricsOf(rec, ctx.configs), currentId: P.id, currentMetrics: results, currentCreated: P.created, currentKind: "사진" }).then(h => { const el = $("#pHistory"); if (el) el.innerHTML = historyHtml(h, esc); P._history = h; });
  app.querySelectorAll("canvas.pc").forEach(c => setupPhotoCanvas(c, P.photos[+c.dataset.i], +c.dataset.i));
}
function kindAngle(p) { const s = p.side; return { catch: [`${s}_shoulder`, `${s}_elbow`, `${s}_wrist`], kick: [`${s}_hip`, `${s}_knee`, `${s}_ankle`] }[p.kind] || null; }
/** 화면에 보일 영역: 사람이 작게 찍힌 사진은 사람 주변을 확대 (한 번 정하면 드래그 중에는 고정) */
function viewBox(p) {
  if (p.view) return p.view; const W = p.canvas.width, H = p.canvas.height; let v = { x: 0, y: 0, w: W, h: H };
  if (p.lm) { const b = personBox(p.lm, 0, 0.5, 160); if (b && b.w < W * 0.7) v = b; }
  return (p.view = v);
}
function drawPhoto(c, p, drag, full = false) {
  const v = full ? { x: 0, y: 0, w: p.canvas.width, h: p.canvas.height } : viewBox(p); const k = Math.min(3, VIEW_W / v.w); c.width = Math.round(v.w * k); c.height = Math.round(v.h * k);
  const g = c.getContext("2d"); g.drawImage(p.canvas, v.x, v.y, v.w, v.h, 0, 0, c.width, c.height); g.save(); g.translate(-v.x * k, -v.y * k);
  if (p.lm && P.showRef && REFS[p.kind]) { const pts = {}; for (const j of JOINTS) { const x = p.lm.x(j)[0], y = p.lm.y(j)[0]; if (!Number.isNaN(x)) pts[j] = [x, y]; } drawRef(g, alignRef(REFS[p.kind], pts, p.kind, p.side), k); }
  if (p.lm) { drawSkeleton(g, p.lm, 0, { scale: k, lineWidth: 2.5, minVis: 0, highlight: drag ? [drag.j] : kindAngle(p) ? [kindAngle(p)[1]] : [] }); const a = kindAngle(p); if (a) drawAngle(g, p.lm, 0, a, p.kind === "catch" ? p.m?.elbow : p.m?.knee, k);
    if (p.kind === "glide") { g.strokeStyle = "#ff00ff"; g.lineWidth = 2; const hd = meanOf([pt(p.lm, "left_ear"), pt(p.lm, "right_ear")]), ak = pt(p.lm, `${p.side}_ankle`); const H = Number.isNaN(hd[0]) ? pt(p.lm, "nose") : hd; g.beginPath(); g.moveTo(H[0] * k, H[1] * k); g.lineTo(ak[0] * k, ak[1] * k); g.stroke(); }
    if (p.kind === "roll") { g.strokeStyle = "#ff00ff"; g.lineWidth = 3; const L = pt(p.lm, "left_shoulder"), R = pt(p.lm, "right_shoulder"); g.beginPath(); g.moveTo(L[0] * k, L[1] * k); g.lineTo(R[0] * k, R[1] * k); g.stroke(); } }
  if (p.waterline?.length) { g.fillStyle = g.strokeStyle = "#ffee00"; g.lineWidth = 2; p.waterline.forEach(q => { g.beginPath(); g.arc(q[0] * k, q[1] * k, 6, 0, 7); g.fill(); }); if (p.waterline.length === 2) { g.beginPath(); g.moveTo(p.waterline[0][0] * k, p.waterline[0][1] * k); g.lineTo(p.waterline[1][0] * k, p.waterline[1][1] * k); g.stroke(); } }
  if (drag) { g.fillStyle = "#ff2020"; g.beginPath(); g.arc(drag.x * k, drag.y * k, 9, 0, 7); g.fill(); label(g, KO_NAMES[drag.j] || drag.j, drag.x * k + 12, drag.y * k - 24, 14); }
  g.restore(); return { k, v };
}
function setupPhotoCanvas(c, p, i) {
  let { k, v } = drawPhoto(c, p, null); let drag = null; const { $, esc } = ctx;
  const toImg = (e) => { const r = c.getBoundingClientRect(); return [v.x + (e.clientX - r.left) * c.width / r.width / k, v.y + (e.clientY - r.top) * c.height / r.height / k]; };
  c.onpointerdown = (e) => {
    const [x, y] = toImg(e);
    if (p.mode === "wl") { if (p.waterline.length >= 2) p.waterline = []; p.waterline.push([x, y]); if (p.waterline.length === 2) { p.mode = "joint"; p.m = measure(p); savePhoto(); renderPhoto(); } else drawPhoto(c, p, null); return; }
    if (!p.lm) p.lm = lmFrom(JOINTS.map(() => [NaN, NaN, 0]), p.canvas.width, p.canvas.height);
    let best = null, bd = Infinity; for (const j of EDITABLE_JOINTS) { const jx = p.lm.x(j)[0], jy = p.lm.y(j)[0]; if (Number.isNaN(jx)) continue; const d = Math.hypot(jx - x, jy - y) * k; if (d < bd) { bd = d; best = j; } }
    if (bd > 40) { // 근처에 점이 없으면 아직 없는 핵심 관절을 순서대로 찍게 함
      best = missing(p)[0] || best; if (!best) return; }
    drag = { j: best, x, y }; c.setPointerCapture(e.pointerId); drawPhoto(c, p, drag);
  };
  c.onpointermove = (e) => { if (!drag) return; [drag.x, drag.y] = toImg(e); drawPhoto(c, p, drag); };
  c.onpointerup = () => { if (!drag) return; p.lm.set(0, drag.j, drag.x, drag.y, 1); p.edited[drag.j] = true; drag = null; p.m = measure(p); drawPhoto(c, p, null);
    const line = ctx.app.querySelector(`[data-line="${i}"]`); if (line) line.textContent = photoLine(p); savePhoto(); clearTimeout(setupPhotoCanvas._t); setupPhotoCanvas._t = setTimeout(() => { const y = window.scrollY; renderPhoto(); window.scrollTo(0, y); }, 900); };
}
async function makePhotoPdf() {
  const { $, toast, configs, download, loadFonts, STROKES, VIEWS, CAMERA_MODES } = ctx; const st = $("#pPdfStatus"); st.textContent = "PDF 만드는 중…";
  try {
    const results = buildResults(P.photos, configs); draftAll(results, configs.comments, P.comments);
    const images = { charts: {}, captures: {} }; const { renderChart } = await import("./viz/charts.js");
    for (const [k, r] of Object.entries(results)) { if (r.status === "unmeasured") continue; images.charts[k] = r.charts.map(c => renderChart(c, 640));
      images.captures[k] = r.captures.map(cp => { const p = P.photos[cp.photoIndex]; const c = document.createElement("canvas"); drawPhoto(c, p, null, true); const box = p.lm ? personBox(p.lm, 0, 0.3, 200) : null; let out = c; if (box) { const kk = c.width / p.canvas.width; out = document.createElement("canvas"); out.width = Math.round(box.w * kk); out.height = Math.round(box.h * kk); out.getContext("2d").drawImage(c, box.x * kk, box.y * kk, box.w * kk, box.h * kk, 0, 0, out.width, out.height); } return { ...cp, dataURL: out.toDataURL("image/jpeg", 0.85) }; }); }
    const session = { settings: { student_name: P.name, stroke: P.stroke, view: "photo", camera_mode: "fixed" }, videoInfo: {}, camera: null, poseInfo: { backend: `MediaPipe Pose Heavy (사진 ${P.photos.length}장)` }, review: { extra: { ...P.extra } } };
    let history = P._history || null; if (history && history.rows.length >= 2 && history.used.length) history = { ...history, chartURL: renderChart(historyChartSpec(history), 640) };
    const bytes = await buildPdf({ history, session, results, cycles: { n_cycles: 0 }, images, configs: { ...configs, STROKES, VIEWS: { ...VIEWS, photo: "사진 분석" }, CAMERA_MODES }, fonts: await loadFonts() });
    download(new Blob([bytes], { type: "application/pdf" }), `SwimLens_사진리포트_${P.name}.pdf`); st.textContent = `완료 (${(bytes.length / 1024).toFixed(0)} KB)`;
  } catch (e) { console.error(e); st.textContent = ""; toast("PDF 생성 실패: " + e.message, 6000); }
}
