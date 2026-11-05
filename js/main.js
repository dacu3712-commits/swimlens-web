// SwimLens 브라우저 앱: ① 설정 → ② 분석 → ③ 검수 → ④ 리포트 (서버 없음, 모든 계산은 이 기기에서)
import { loadConfigs, STROKES, VIEWS, DIRECTIONS, CAMERA_SIDES, CAMERA_MODES } from "./config.js";
import { JOINTS, KO_NAMES, EDITABLE_JOINTS, Landmarks } from "./keypoints.js";
import { loadVideo, estimateFps, seekTo, analysisSize, underwaterEnhance } from "./video.js";
import { createLandmarker, extractLandmarks, trial } from "./pose.js";
import { analyze, prepareLandmarks } from "./pipeline.js";
import { drawSkeleton, renderCapture } from "./viz/draw.js";
import { renderChart } from "./viz/charts.js";
import { buildPdf, keyValues } from "./report/pdf.js";
import { autoTop3 } from "./report/summary.js";
import * as db from "./storage.js";
import * as cloud from "./cloud.js";
import { setCandidateVideo } from "./candidates.js";
import { initPhoto, renderPhoto, openPhotoSession, addPhotoFromCanvas, photoMetricsOf } from "./photo.js";
import { loadRefs, alignRef, drawRef, REF_KIND_OF_EVENT } from "./viz/reference.js";
import { attachPolish, measuresOf } from "./polishui.js";
import { gatherHistory, historyHtml, historyChartSpec } from "./history.js";

const TRAFFIC = { green: ["🟢", "좋음"], yellow: ["🟡", "주의"], red: ["🔴", "개선 필요"], na: ["⚪", "측정 불가"], info: ["🔵", "참고"] };
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const S = { step: 0, configs: null, video: null, file: null, videoInfo: null, clicks: { wl: [], sc: [], roi: [] }, clickMode: "wl", settings: defaultSettings(), session: null, landmarker: null, landmarkerVariant: null, running: false, stop: false, tab: 0, editFrame: null, editJoint: "right_elbow", frameCache: new Map(), fonts: null, showRef: true };
function defaultSettings() { return { student_name: "수강생", stroke: "freestyle", view: "side_under", direction: "ltr", camera_side_arm: "right", camera_mode: "fixed", waterline: null, scale_points: null, scale_meters: null, underwater_preprocess: true, model: "auto", frame_step: isMobile() ? 2 : 1, max_long_side: 960, cloud_video: false, seg_start: 0, seg_end: null, track: true }; }
function isMobile() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); }
function toast(msg, ms = 2500) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms); }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function go(step) { S.step = step; render(); window.scrollTo(0, 0); }
function fmtTraffic(t) { const [e, k] = TRAFFIC[t] || TRAFFIC.na; return `${e} ${k}`; }

// ------------------------------------------------------------ 영상 프레임 접근
function ensureFrameCanvas() { if (!S.frameCanvas) { S.frameCanvas = document.createElement("canvas"); } const { width, height } = S.session?.videoInfo?.analysis || analysisSize(S.video, S.settings.max_long_side); S.frameCanvas.width = width; S.frameCanvas.height = height; return S.frameCanvas; }
async function grabFrame(frameIdx) {
  const key = frameIdx; if (S.frameCache.has(key)) return S.frameCache.get(key);
  const c = ensureFrameCanvas(), ctx = c.getContext("2d", { willReadFrequently: true }); const fps = S.session.videoInfo.fps;
  await seekTo(S.video, Math.min(frameIdx / fps, Math.max(0, S.video.duration - 0.001))); ctx.drawImage(S.video, 0, 0, c.width, c.height);
  if (S.session.settings.underwater_preprocess && ["side_under", "bottom"].includes(S.session.settings.view)) underwaterEnhance(ctx, c.width, c.height);
  const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height; copy.getContext("2d").drawImage(c, 0, 0);
  if (S.frameCache.size > 40) S.frameCache.delete(S.frameCache.keys().next().value); S.frameCache.set(key, copy); return copy;
}
function armSide() { const c = S.session?.cycles?.side; return c === "left" || c === "right" ? c : (S.session?.settings?.camera_side_arm || "right"); }
function viewLm() { const s = S.session; return s.lmView || s.lm; }
let REFS = {}; async function refreshRefs() { try { REFS = await loadRefs(); } catch { REFS = {}; } }
function refOverlay(lm, i, refKind, side) {
  if (!S.showRef || !refKind || !REFS[refKind]) return null; const pts = {}; for (const j of JOINTS) { const x = lm.data[j].x[i], y = lm.data[j].y[i]; if (!Number.isNaN(x)) pts[j] = [x, y]; }
  const al = alignRef(REFS[refKind], pts, refKind, side); return al ? (ctx, sc) => drawRef(ctx, al, sc) : null;
}
async function captureURL(spec, width = 480) { const lm = viewLm(); if (spec.refKind && !spec.overlay) { const i0 = lm.indexOfFrame(spec.frame); spec = { ...spec, overlay: refOverlay(lm, i0, spec.refKind, spec.side || armSide()) }; } const i = lm.indexOfFrame(spec.frame); const fc = await grabFrame(lm.frame[i]); return renderCapture(fc, lm, i, spec, width); }

// ------------------------------------------------------------ 세션 저장/복원
async function persist() {
  const s = S.session; if (!s) return;
  try { await db.saveSession({ id: s.id, name: s.name, created: s.created, settings: s.settings, videoInfo: s.videoInfo, lm: s.lm ? s.lm.toJSON() : null, partial: s.partial || null, report: s.report, camera: s.camera, poseInfo: s.poseInfo, review: s.review, metrics: s.metrics, cycles: s.cycles, hasMetrics: !!s.metrics, videoPath: s.videoPath || null, pdfPath: s.pdfPath || null, videoBlob: S.file || s.videoBlob || null }); }
  catch (e) { console.warn(e); toast("저장 공간 부족: 결과가 기기에 저장되지 않았습니다. PDF·CSV 를 바로 내려받으세요.", 5000); }
  syncCloud();
}
let _syncTimer = null;
function syncCloud() {
  const s = S.session; if (!s || !s.lm || !cloud.user()) return;
  clearTimeout(_syncTimer); _syncTimer = setTimeout(async () => { const r = await cloud.upsertCloud(s, s.lm.toCSV()); if (!r.ok) toast("☁ 서버 저장 실패: " + r.msg, 5000); else { s.cloudSaved = true; setCloudBadge(); } }, 800);
}
function setCloudBadge() { const el = $("#cloudBadge"); if (el) el.textContent = cloud.user() ? (S.session?.cloudSaved ? "☁ 저장됨" : "☁") : ""; }
async function uploadVideoIfWanted() {
  const s = S.session; if (!s || !cloud.user() || !s.settings.cloud_video || !S.file || s.videoPath) return;
  toast("영상을 서버에 올리는 중… (" + (S.file.size / 1e6).toFixed(0) + "MB)", 4000);
  const ext = (S.file.name.split(".").pop() || "mp4").toLowerCase(); const path = cloud.userPath(s.id, "source." + ext);
  const r = await cloud.uploadFile(path, S.file, S.file.type || "video/mp4"); if (r.ok) { s.videoPath = path; await cloud.patchCloud(s.id, { video_path: path }); persist(); toast("영상 서버 보관 완료"); } else toast("영상 업로드 실패 (" + r.status + ")", 5000);
}
async function openSession(id) {
  const rec = await db.getSession(id); if (!rec) return toast("세션을 찾을 수 없습니다");
  if (rec.kind === "photo") { await openPhotoSession(rec); $("#drawer").hidden = true; go(4); return; }
  S.session = { ...rec, lm: rec.lm ? Landmarks.fromJSON(rec.lm) : null }; S.settings = { ...rec.settings }; S.frameCache.clear();
  if (rec.videoBlob) { S.file = rec.videoBlob; S.video = await loadVideo(rec.videoBlob); S.videoInfo = { ...rec.videoInfo }; } else { S.video = null; toast("이 세션에는 영상이 저장되어 있지 않아 캡처 이미지는 표시되지 않습니다.", 4000); }
  $("#drawer").hidden = true;
  if (!rec.hasMetrics && rec.partial && S.video) { S.runPending = true; go(1); return; }   // 중단된 분석 → 이어서
  go(rec.hasMetrics ? 2 : 1);
}
/** 앱을 열 때 중단된 분석이 있으면 이어하기 안내 */
async function checkInterrupted() {
  try {
    const list = await db.listSessions(); const cand = list.find(x => x.kind !== "photo" && !x.hasMetrics && x.hasPartial);
    if (!cand) return; const rec = await db.getSession(cand.id); if (!rec?.partial || !rec.videoBlob) return;
    const pct = Math.round(rec.partial.k / Math.max(1, rec.partial.n) * 100);
    const box = document.createElement("div"); box.className = "card"; box.style.borderColor = "#0f4c81";
    box.innerHTML = `<b>⏸ 중단된 분석이 있습니다</b><p class="muted">${esc(rec.name)} · ${new Date(rec.created).toLocaleString("ko-KR")} · ${pct}% 진행됨</p><p><button class="btn" id="resumeBtn">▶ 이어서 분석하기</button> <button class="btn sec small" id="discardBtn">버리기</button></p>`;
    app.prepend(box);
    $("#resumeBtn").onclick = () => openSession(rec.id);
    $("#discardBtn").onclick = async () => { await db.deleteSession(rec.id); box.remove(); };
  } catch (e) { console.warn(e); }
}
async function renderDrawer() {
  const el = $("#sessionList"); const u = cloud.user();
  const loginHtml = u ? `<div class="info">☁ <b>${esc(u.email)}</b> 로그인됨 — 결과가 서버(Supabase)에도 저장됩니다. <button class="btn small sec" id="logoutBtn">로그아웃</button></div>`
    : `<details class="card" style="padding:8px"><summary>☁ 서버 저장 (수영 게임과 같은 계정으로 로그인)</summary><label class="f">이메일<input type="text" id="loginEmail" value="dacu3712@gmail.com"></label><label class="f">비밀번호<input type="password" id="loginPw"></label><p><button class="btn small" id="loginBtn">로그인</button> <span class="muted" id="loginMsg"></span></p><p class="muted">로그인하지 않아도 이 기기에는 저장됩니다. 서버 저장을 쓰려면 Supabase 에 supabase/schema.sql 을 한 번 실행해 두어야 합니다 (DEPLOY.md).</p></details>`;
  const local = await db.listSessions(); let cloudRows = [];
  if (u) { const r = await cloud.listCloud(); cloudRows = r.rows; if (!r.ok) el.innerHTML = loginHtml + `<div class="warn">서버 목록을 불러오지 못했습니다 (${r.status}). schema.sql 실행 여부를 확인하세요.</div>`; }
  const localIds = new Set(local.map(s => s.id)); const cloudIds = new Set(cloudRows.map(s => s.id));
  const items = [...local.map(s => ({ ...s, where: cloudIds.has(s.id) ? "both" : "local" })), ...cloudRows.filter(c => !localIds.has(c.id)).map(c => ({ id: c.id, name: c.name, created: c.created, settings: c.settings || {}, hasMetrics: c.has_metrics, where: "cloud", pdf_path: c.pdf_path, video_path: c.video_path }))].sort((a, b) => b.created - a.created);
  const rows = items.length ? items.map(s => `<div class="sess"><b>${esc(s.name)} ${s.where === "cloud" ? "☁" : s.where === "both" ? "☁📱" : "📱"}</b><span class="muted">${new Date(s.created).toLocaleString("ko-KR")} · ${STROKES[s.settings.stroke] || ""} · ${s.kind === "photo" ? "📷 사진 분석" : VIEWS[s.settings.view] || ""}${s.hasMetrics ? "" : " · 미완료"}</span><div class="row"><button class="btn small" data-open="${s.id}" data-where="${s.where}">열기</button>${s.pdf_path ? `<button class="btn small sec" data-pdf="${esc(s.pdf_path)}">PDF</button>` : ""}<button class="btn small sec" data-del="${s.id}" data-where="${s.where}">삭제</button></div></div>`).join("") : `<p class="muted">저장된 분석이 없습니다.</p>`;
  el.innerHTML = (el.innerHTML.includes("서버 목록을") ? el.innerHTML : loginHtml) + rows;
  $("#loginBtn")?.addEventListener("click", async () => { const m = $("#loginMsg"); m.textContent = "로그인 중…"; const r = await cloud.login($("#loginEmail").value.trim(), $("#loginPw").value); if (r.ok) { toast("로그인 성공 — 결과가 서버에도 저장됩니다"); renderDrawer(); if (S.session) syncCloud(); render(); } else m.textContent = r.msg; });
  $("#logoutBtn")?.addEventListener("click", () => { cloud.logout(); renderDrawer(); render(); });
  el.querySelectorAll("[data-open]").forEach(b => b.onclick = () => b.dataset.where === "cloud" ? openCloudSession(b.dataset.open) : openSession(b.dataset.open));
  el.querySelectorAll("[data-pdf]").forEach(b => b.onclick = async () => { const url = await cloud.signedUrl(b.dataset.pdf); if (url) window.open(url, "_blank"); else toast("PDF 링크를 만들지 못했습니다"); });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("이 분석을 삭제할까요?" + (b.dataset.where !== "local" ? " (서버에서도 삭제)" : ""))) return; await db.deleteSession(b.dataset.del); if (b.dataset.where !== "local") await cloud.deleteCloud(b.dataset.del); renderDrawer(); });
}
async function openCloudSession(id) {
  toast("서버에서 불러오는 중…"); const row = await cloud.getCloud(id); if (!row) return toast("서버에서 세션을 찾지 못했습니다");
  const vi = row.video_info || {}; const lm = Landmarks.fromCSV(row.landmarks_csv || "", vi.analysis?.width ? vi.fps / (row.settings?.frame_step || 1) : 30, vi.analysis?.width || 960, vi.analysis?.height || 540);
  S.session = { id: row.id, name: row.name, created: row.created, settings: row.settings, videoInfo: vi, lm, report: null, camera: row.camera, poseInfo: row.pose_info, review: row.review || { events: {}, joints: {}, comments: {}, extra: {} }, metrics: row.metrics, cycles: row.cycles, hasMetrics: row.has_metrics, cloudSaved: true, videoPath: row.video_path };
  S.settings = { ...row.settings }; S.frameCache.clear(); S.video = null; S.file = null;
  if (row.video_path) { const url = await cloud.signedUrl(row.video_path, 7200); if (url) { try { const blob = await (await fetch(url)).blob(); S.file = new File([blob], row.video_path.split("/").pop(), { type: blob.type || "video/mp4" }); S.video = await loadVideo(S.file); } catch (e) { toast("영상을 받지 못했습니다: " + e.message, 4000); } } }
  if (!S.video) toast("이 세션은 영상이 서버에 없어 캡처는 표시되지 않습니다 (수치·그래프·PDF 는 가능).", 5000);
  recompute(); await persist(); $("#drawer").hidden = true; go(S.session.metrics ? 2 : 1);
}

// ------------------------------------------------------------ ① 설정
function renderSetup() {
  const st = S.settings; const sel = (name, opts, val) => `<select data-k="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === val ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  const mx = S.configs.matrix.metrics; const matrixRows = Object.values(mx).map(spec => { const s2 = spec[st.view] || "no"; return `<li>${s2 === "ok" ? "✅" : s2 === "ref" ? "△" : "❌"} ${spec.name}${s2 === "no" ? ` <span class="muted">— ${spec.reason_no}</span>` : s2 === "ref" ? " <span class='muted'>(참고용)</span>" : ""}</li>`; }).join("");
  app.innerHTML = `
  <div class="card"><h2>① 분석 설정</h2><p class="muted">영상을 올리고 촬영 조건을 고르세요. 모든 분석은 이 기기 안에서만 이루어지며 영상이 서버로 전송되지 않습니다.</p>
    <p class="muted">🎞 영상 대신 <b>캡처 사진 몇 장</b>으로 분석하려면 위쪽 <b>📷 사진</b> 탭을 쓰세요.</p><label class="drop" id="drop"><input type="file" id="file" accept="video/*,.mp4,.mov,.m4v,.webm"><div>${S.file ? `📼 <b>${esc(S.file.name)}</b> (${(S.file.size / 1e6).toFixed(1)} MB) — 다른 영상을 올리려면 여기를 누르세요` : "📼 여기를 눌러 영상을 고르거나 끌어다 놓으세요 (mp4 / mov)"}</div><div class="muted">권장: 20~40초 클립, 30fps 이상, 고정 카메라</div></label>
    ${S.videoInfo ? `<p class="muted">영상: ${S.videoInfo.width}x${S.videoInfo.height} @ ${S.videoInfo.fps}fps, ${S.videoInfo.duration.toFixed(1)}초 ${S.videoInfo.fps < 30 ? '<span class="warn">FPS 가 30 미만이라 타이밍 정밀도가 낮습니다</span>' : ""}</p>` : ""}
  </div>
  <div class="card"><div class="grid">
    <label class="f">수강생 이름<input type="text" data-k="student_name" value="${esc(st.student_name)}"></label>
    <label class="f">영법${sel("stroke", STROKES, st.stroke)}</label>
    <label class="f">촬영 구도${sel("view", VIEWS, st.view)}</label>
    <label class="f">진행 방향${sel("direction", DIRECTIONS, st.direction)}</label>
    <label class="f">카메라 측 팔 (측면일 때)${sel("camera_side_arm", CAMERA_SIDES, st.camera_side_arm)}</label>
    <label class="f">카메라 고정 여부${sel("camera_mode", CAMERA_MODES, st.camera_mode)}</label>
    <label class="f">자세 추정 모델${sel("model", { auto: "자동 (Full vs Lite 앞 3초 비교)", full: "Full (균형, 권장)", heavy: "Heavy (정확, 느림)", lite: "Lite (빠름)" }, st.model)}</label>
    <label class="f">분석 프레임${sel("frame_step", { 1: "모든 프레임 (정밀)", 2: "2프레임 중 1 (빠름, 폰 권장)", 3: "3프레임 중 1 (매우 빠름)" }, String(st.frame_step))}</label>
    <label class="c"><input type="checkbox" data-k="underwater_preprocess" ${st.underwater_preprocess ? "checked" : ""}> 수중 전처리 (색보정·대비)</label>
    ${cloud.user() ? `<label class="c"><input type="checkbox" data-k="cloud_video" ${st.cloud_video ? "checked" : ""}> 영상도 서버에 보관 (다른 기기에서 캡처·수정 가능, 용량 큼)</label>` : ""}
  </div>
  <details><summary class="muted">이 구도에서 측정되는 지표</summary><ul class="muted">${matrixRows}</ul></details>
  <details><summary class="muted">고급: 파이썬 버전에서 만든 landmarks.csv 가져오기 (자세 추정 건너뜀)</summary><input type="file" id="csvFile" accept=".csv"> <span class="muted">영상도 함께 올려야 캡처가 표시됩니다 (fps·해상도는 CSV 기준으로 맞춥니다).</span></details>
  </div>
  ${S.video ? `<div class="card"><h3>수면선 · 거리 기준 지정 (첫 프레임 클릭)</h3>
    <div class="tabs"><button data-mode="wl" class="${S.clickMode === "wl" ? "active" : ""}">수면선 (2점)</button><button data-mode="sc" class="${S.clickMode === "sc" ? "active" : ""}">거리 기준 (2점)</button><button data-mode="roi" class="${S.clickMode === "roi" ? "active" : ""}">🔍 확대 영역 (2점)</button><button data-mode="none" class="${S.clickMode === "none" ? "active" : ""}">클릭 안 함</button></div>
    <div class="info" style="margin:8px 0"><b>🎯 정밀 분석 팁</b> — 멀리서 다가왔다 멀어지는 영상은 <b>가까운 구간만</b> 고르고, 그 구간에서 수영자가 지나가는 자리를 <b>🔍 확대 영역</b>으로 지정하세요. 고른 구간은 <b>모든 프레임</b>을 높은 해상도로 분석합니다.</div>
    <div class="card" style="padding:10px;margin:0 0 8px">
      <b>⏱ 분석 구간</b> <span class="muted">${fmtSec(segStart())} ~ ${fmtSec(segEnd())} (${(segEnd() - segStart()).toFixed(1)}초)</span>
      <input type="range" id="segScrub" min="0" max="${S.videoInfo.duration}" step="${(1 / S.videoInfo.fps).toFixed(4)}" value="${S.scrubT ?? segStart()}" style="width:100%">
      <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="muted" id="scrubT">${fmtSec(S.scrubT ?? segStart())}</span>
      <button class="btn small sec" id="stepBack">◀ 1프레임</button><button class="btn small sec" id="stepFwd">1프레임 ▶</button>
      <button class="btn small" id="setStart">여기를 시작으로</button><button class="btn small" id="setEnd">여기를 끝으로</button><button class="btn small sec" id="segAll">전체 구간</button></div>
      <label class="c" style="margin-top:6px"><input type="checkbox" id="trackChk" ${S.settings.track ? "checked" : ""}> 🎯 수영자 자동 추적 확대 (다가왔다 멀어지는 영상에 추천 — 사람을 따라가며 크게 잘라서 분석)</label>
      <label class="f" style="margin-top:6px">분석 해상도<select id="precision"><option value="960" ${S.settings.max_long_side <= 960 ? "selected" : ""}>보통 (960px, 빠름)</option><option value="1440" ${S.settings.max_long_side === 1440 ? "selected" : ""}>높음 (1440px)</option><option value="1920" ${S.settings.max_long_side >= 1920 ? "selected" : ""}>최고 (원본, 최대 1920px — 느림)</option></select></label>
    </div>
    <div class="canvas-wrap"><canvas id="setupCanvas"></canvas></div>
    <div class="muted">확대 영역: <b>${S.clicks.roi?.length === 2 ? "지정됨 ✅" : "없음 (화면 전체)"}</b> ${S.clicks.roi?.length ? '<button class="btn small sec" id="clearRoi">지우기</button>' : ""} — 수영자가 지나가는 자리를 왼쪽 위·오른쪽 아래 두 번 눌러 상자로 지정</div>
    <div class="grid" style="margin-top:8px"><div>수면선: <b>${S.clicks.wl.length === 2 ? "지정됨 ✅" : `${S.clicks.wl.length}/2 점 (미지정 시 화면 수평·위에서 30%)`}</b> <button class="btn small sec" id="clearWl">지우기</button></div>
    <div>거리 기준: <b>${S.clicks.sc.length === 2 ? "지정됨 ✅" : `${S.clicks.sc.length}/2 점`}</b> <label class="f" style="display:inline-flex">두 점 사이 실제 거리(m) <input type="number" step="0.5" min="0" data-k="scale_meters" value="${st.scale_meters ?? ""}" style="width:90px"></label> <button class="btn small sec" id="clearSc">지우기</button></div></div>
    <p style="margin-top:12px"><button class="btn" id="startBtn">🚀 분석 시작</button> <button class="btn sec" id="toCand">📷 이 영상에서 사진 후보 뽑기</button> <span class="muted">예상 시간: 영상 ${S.videoInfo.duration.toFixed(0)}초 × 프레임당 0.05~0.2초</span></p></div>` : ""}`;
  // 이벤트
  const drop = $("#drop"); drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); }); drop.addEventListener("dragleave", () => drop.classList.remove("over")); drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  app.querySelectorAll("[data-k]").forEach(el => el.addEventListener("change", () => { const k = el.dataset.k; let v = el.type === "checkbox" ? el.checked : el.value; if (k === "frame_step") v = +v; if (k === "scale_meters") v = v === "" ? null : +v; S.settings[k] = v; if (k === "view") { S.settings.underwater_preprocess = ["side_under", "bottom"].includes(v); render(); } }));
  app.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { S.clickMode = b.dataset.mode; render(); });
  $("#clearWl")?.addEventListener("click", () => { S.clicks.wl = []; render(); }); $("#clearSc")?.addEventListener("click", () => { S.clicks.sc = []; render(); });
  $("#startBtn")?.addEventListener("click", startAnalysis);
  $("#toCand")?.addEventListener("click", async () => { await setCandidateVideo(S.file); go(4); });
  if (S.video) {
    const sc = $("#segScrub"); sc.oninput = () => { S.scrubT = +sc.value; $("#scrubT").textContent = fmtSec(S.scrubT); drawSetupCanvas(); };
    const stepBy = (d) => { S.scrubT = Math.max(0, Math.min(S.videoInfo.duration, (S.scrubT ?? segStart()) + d / S.videoInfo.fps)); render(); };
    $("#stepBack").onclick = () => stepBy(-1); $("#stepFwd").onclick = () => stepBy(1);
    $("#setStart").onclick = () => { S.settings.seg_start = S.scrubT ?? 0; if (S.settings.seg_end != null && S.settings.seg_end <= S.settings.seg_start) S.settings.seg_end = null; render(); };
    $("#setEnd").onclick = () => { const t = S.scrubT ?? S.videoInfo.duration; if (t > segStart()) S.settings.seg_end = t; render(); };
    $("#segAll").onclick = () => { S.settings.seg_start = 0; S.settings.seg_end = null; render(); };
    $("#precision").onchange = (e) => { S.settings.max_long_side = +e.target.value; render(); };
    $("#trackChk").onchange = (e) => { S.settings.track = e.target.checked; };
    $("#clearRoi")?.addEventListener("click", () => { S.clicks.roi = []; render(); });
    drawSetupCanvas();
  }
}
async function onFile(file) {
  try { S.file = file; S.video = await loadVideo(file); const fps = await estimateFps(S.video); S.videoInfo = { width: S.video.videoWidth, height: S.video.videoHeight, fps, duration: S.video.duration }; S.clicks = { wl: [], sc: [], roi: [] }; S.scrubT = 0; S.settings.seg_start = 0; S.settings.seg_end = null; S.importedLm = null; render(); }
  catch (e) { toast(e.message, 5000); }
}
async function onCsv(file) { const text = await file.text(); S.importedCsv = text; toast("CSV 를 읽었습니다. 분석 시작을 누르면 자세 추정 없이 지표만 계산합니다."); }
function fmtSec(t) { return `${(t || 0).toFixed(2)}초`; }
function segStart() { return S.settings.seg_start || 0; }
function segEnd() { return S.settings.seg_end ?? S.videoInfo?.duration ?? 0; }
let _drawTok = 0;
async function drawSetupCanvas() {
  const c = $("#setupCanvas"); if (!c) return; const tok = ++_drawTok; const { width, height } = analysisSize(S.video, S.settings.max_long_side); c.width = width; c.height = height; const ctx = c.getContext("2d");
  await seekTo(S.video, S.scrubT ?? segStart()); if (tok !== _drawTok) return; ctx.drawImage(S.video, 0, 0, width, height);
  const P = (q) => [q[0] * width, q[1] * height];
  const draw = (pts, col) => { ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2; pts.map(P).forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill(); }); if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(...P(pts[0])); ctx.lineTo(...P(pts[1])); ctx.stroke(); } };
  if (!S.clicks.wl.length) { ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, 0.3 * height); ctx.lineTo(width, 0.3 * height); ctx.stroke(); ctx.setLineDash([]); }
  draw(S.clicks.wl, "#ffee00"); draw(S.clicks.sc, "#ff8c00");
  const roi = S.clicks.roi || []; if (roi.length) { ctx.fillStyle = "#00e5ff"; roi.map(P).forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill(); }); }
  if (roi.length === 2) { const [a, b] = roi.map(P); ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); ctx.setLineDash([]); }
  c.onclick = (e) => { if (S.clickMode === "none") return; const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; const key = S.clickMode; const arr = (S.clicks[key] = S.clicks[key] || []); if (arr.length >= 2) arr.length = 0; arr.push([x, y]); render(); };
}
async function startAnalysis() {
  const st = { ...S.settings }; const { width, height } = analysisSize(S.video, st.max_long_side); const P = (q) => [q[0] * width, q[1] * height];
  st.waterline = S.clicks.wl.length === 2 ? S.clicks.wl.map(P) : null; st.scale_points = S.clicks.sc.length === 2 && st.scale_meters > 0 ? S.clicks.sc.map(P) : null; if (!st.scale_points) st.scale_meters = null;
  const roi = S.clicks.roi || []; if (roi.length === 2) { const [a, b] = roi.map(P); const pad = 0.05; let x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]); x0 = Math.max(0, x0 - w * pad); y0 = Math.max(0, y0 - h * pad); w = Math.min(width - x0, w * (1 + 2 * pad)); h = Math.min(height - y0, h * (1 + 2 * pad)); st.roi = { x: x0, y: y0, w, h }; } else st.roi = null;
  if (st.seg_start || st.seg_end) st.frame_step = 1;   // 구간을 고르면 모든 프레임 분석
  S.session = { id: db.newId(st.student_name), name: st.student_name, created: Date.now(), settings: st, videoInfo: { ...S.videoInfo, analysis: { width, height } }, lm: null, report: null, camera: null, poseInfo: null, review: { events: {}, joints: {}, comments: {}, extra: {} }, metrics: null, cycles: null };
  S.frameCache.clear(); S.runPending = true; go(1);
}

// ------------------------------------------------------------ ② 분석
function renderRun() {
  const s = S.session;
  if (!s) { app.innerHTML = `<div class="card"><h2>② 분석</h2><p class="muted">먼저 ① 설정에서 영상을 올리고 '분석 시작'을 눌러 주세요.</p></div>`; return; }
  app.innerHTML = `<div class="card"><h2>② 분석 — ${esc(s.name)}</h2><p class="muted">분석 중에는 이 화면을 켜 두세요. 다른 앱으로 가면 일시정지되고, 앱을 닫아도 진행 상황이 30프레임마다 저장되어 다시 열면 이어서 할 수 있습니다.</p><div class="progress"><div id="bar"></div></div><div id="ptext" class="muted"></div><pre class="log" id="log"></pre><p><button class="btn sec small" id="stopBtn" ${S.running ? "" : "hidden"}>중단</button></p></div>
  <div id="runResult"></div>`;
  $("#stopBtn").onclick = () => { S.stop = true; };
  if (S.runPending) { S.runPending = false; runAnalysis(); } else if (s.metrics) showRunResult();
}
function log(msg) { const el = $("#log"); if (el) { el.textContent += msg + "\n"; el.scrollTop = el.scrollHeight; } console.log(msg); }
function progress(stage, frac, extra = "") { const b = $("#bar"), t = $("#ptext"); if (b) b.style.width = `${Math.round(frac * 100)}%`; if (t) t.textContent = `${stage} ${Math.round(frac * 100)}% ${extra}`; }
async function getLandmarker(variant) { if (S.landmarker && S.landmarkerVariant === variant) return S.landmarker; if (S.landmarker) { try { S.landmarker.close(); } catch { } } progress("모델 불러오는 중", 0, `(${variant})`); S.landmarker = await createLandmarker({ variant }); S.landmarkerVariant = variant; log(`MediaPipe Pose ${variant} 로드 (${S.landmarker._delegate})`); return S.landmarker; }
async function runAnalysis() {
  const s = S.session, st = s.settings; S.running = true; S.stop = false; $("#stopBtn").hidden = false; const t0 = performance.now(); keepAwake();
  try {
    const under = st.underwater_preprocess && ["side_under", "bottom"].includes(st.view);
    if (S.importedCsv) {
      log("CSV 랜드마크 가져오기 (자세 추정 생략)"); const lines = S.importedCsv.trim().split(/\r?\n/).length - 1; const dur = S.videoInfo.duration; const fps = Math.round(lines / dur * 100) / 100 || S.videoInfo.fps;
      const { width, height } = s.videoInfo.analysis; const lm = Landmarks.fromCSV(S.importedCsv, fps, width, height);
      // 좌표가 다른 해상도 기준일 수 있어 가장 큰 x 로 스케일 추정
      let mx = 0; for (const j of JOINTS) for (const v of lm.x(j)) if (!Number.isNaN(v) && v > mx) mx = v;
      if (mx > width * 1.05) { const sc = width / S.videoInfo.width; log(`CSV 좌표가 원본 해상도 기준이라 ${sc.toFixed(3)}배로 축소합니다`); for (const j of JOINTS) { const d = lm.data[j]; for (let i = 0; i < lm.n; i++) { d.x[i] *= sc; d.y[i] *= sc; } } }
      s.videoInfo.fps = fps; s.lm = lm; s.report = null; s.camera = { moving: false, note: "CSV 가져오기: 카메라 이동 감지 생략" }; s.poseInfo = { backend: "CSV 가져오기", ms_per_frame: 0, analyzed_frames: lm.n, detect_rate: 1 }; S.importedCsv = null;
    } else {
      let variant = st.model;
      if (variant === "auto") {
        const res = {}; for (const v of ["full", "lite"]) { const lmk = await getLandmarker(v); progress("모델 비교", v === "full" ? 0.2 : 0.6); res[v] = await trial(S.video, lmk, { fps: s.videoInfo.fps, seconds: 3, step: 2, maxLong: st.max_long_side, underwater: under, start: st.seg_start || 0, end: st.seg_end ?? null, roi: st.roi || null }); log(`${v}: 검출률 ${(res[v].detect_rate * 100).toFixed(0)}%, 신뢰도 ${(res[v].mean_visibility * 100).toFixed(0)}점, ${res[v].ms_per_frame.toFixed(0)}ms/프레임`); }
        variant = (Math.round(res.full.detect_rate * 10) > Math.round(res.lite.detect_rate * 10) || res.full.mean_visibility >= res.lite.mean_visibility - 0.03) ? "full" : "lite"; log(`→ 선택: ${variant}`); s.poseInfo = { trials: res };
      }
      if (s.partial?.variant) variant = s.partial.variant;
      s.partial = s.partial || { k: 0, n: 0, variant }; s.partial.variant = variant; await persist();    // 영상과 설정을 먼저 기기에 저장
      const lmk = await getLandmarker(variant);
      const resume = s.partial.lm ? { lm: Landmarks.fromJSON(s.partial.lm), k: s.partial.k, camMags: s.partial.camMags } : null;
      if (resume) log(`이어서 분석: ${resume.k}프레임까지 완료된 상태에서 계속합니다`);
      log(`자세 추정 시작: ${s.videoInfo.analysis.width}x${s.videoInfo.analysis.height}, ${s.videoInfo.fps}fps, 구간 ${fmtSec(st.seg_start || 0)}~${fmtSec(st.seg_end ?? s.videoInfo.duration)}${st.frame_step > 1 ? ` (${st.frame_step}프레임 중 1)` : " (모든 프레임)"}${st.roi ? `, 확대 영역 ${Math.round(st.roi.w)}x${Math.round(st.roi.h)} → 최대 4배 확대` : ""}${st.track ? ", 🎯 자동 추적 확대" : ""}`);
      const out = await extractLandmarks(S.video, lmk, { fps: s.videoInfo.fps, step: st.frame_step, maxLong: st.max_long_side, underwater: under, cameraCfg: S.configs.thresholds.camera_motion, start: st.seg_start || 0, end: st.seg_end ?? null, roi: st.roi || null, track: !!st.track,
        onProgress: (i, n, ms) => progress("자세 추정", i / n, `(${ms.toFixed(0)} ms/프레임, 남은 시간 약 ${Math.ceil((n - i) * ms / 1000)}초)`), shouldStop: () => S.stop,
        resume, checkpointEvery: 30,
        onCheckpoint: async (lmPart, k, camMags) => { s.partial = { variant, k, n: lmPart.n, lm: lmPart.toJSON(), camMags }; try { await db.saveSession({ ...(await db.getSession(s.id)), partial: s.partial }); } catch (e) { console.warn(e); } },
        onPause: (paused) => { log(paused ? "⏸ 화면이 꺼지거나 다른 앱으로 이동해 일시정지했습니다. 돌아오면 이어서 진행합니다." : "▶ 다시 진행합니다"); if (!paused) keepAwake(); } });
      s.partial = null;
      const { lm, report } = prepareLandmarks(out.lm, S.configs.thresholds);
      s.lm = lm; s.report = report; s.camera = out.camera; s.poseInfo = { ...(s.poseInfo || {}), backend: `MediaPipe Pose ${variant} (${lmk._delegate})`, ms_per_frame: out.msPerFrame, analyzed_frames: lm.n, detect_rate: report.detect_rate };
      log(`자세 추정 완료: ${lm.n}프레임, ${out.msPerFrame.toFixed(0)} ms/프레임, 검출률 ${(report.detect_rate * 100).toFixed(0)}%`); log("카메라: " + out.camera.note);
      if (report.detect_rate < 0.3) log("⚠️ 사람 검출률이 낮습니다. 수중 전처리를 켜고/끄거나 다른 모델로 다시 시도해 보세요.");
    }
    progress("지표 계산", 0.9); recompute(); progress("완료", 1, `(${((performance.now() - t0) / 1000).toFixed(0)}초)`); log(`완료: ${((performance.now() - t0) / 1000).toFixed(0)}초`);
    await persist(); showRunResult(); toast("분석이 끝났습니다. ③ 검수에서 확인하세요."); uploadVideoIfWanted();
  } catch (e) { console.error(e); log("오류: " + e.message); $("#runResult").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  finally { S.running = false; releaseAwake(); const b = $("#stopBtn"); if (b) b.hidden = true; }
}
// 분석 중 화면 꺼짐 방지 (지원 브라우저) + 창 닫기 경고
let _wake = null;
async function keepAwake() { try { if ("wakeLock" in navigator && !document.hidden) _wake = await navigator.wakeLock.request("screen"); } catch { _wake = null; } }
function releaseAwake() { try { _wake?.release(); } catch { } _wake = null; }
window.addEventListener("beforeunload", (e) => { if (S.running) { e.preventDefault(); e.returnValue = "분석이 진행 중입니다. 지금 닫아도 다음에 이어서 할 수 있습니다."; } });

function recompute() {
  const s = S.session; const out = analyze({ lm: s.lm, report: s.report, settings: s.settings, configs: S.configs, review: s.review, cameraMotion: s.camera, log });
  s.lmView = out.lm; s.metrics = out.results; s.cycles = out.cycles; s.camera = out.camera; s.hasMetrics = true;
}
function showRunResult() {
  const s = S.session; const p = s.poseInfo || {}; const el = $("#runResult"); if (!el) return; updateNav();
  el.innerHTML = `<div class="card"><div class="grid"><div><div class="muted">백엔드</div><b>${esc(p.backend || "-")}</b></div><div><div class="muted">검출률</div><b>${p.detect_rate != null ? (p.detect_rate * 100).toFixed(0) + "%" : "-"}</b></div><div><div class="muted">처리 속도</div><b>${p.ms_per_frame ? p.ms_per_frame.toFixed(0) + " ms/프레임" : "-"}</b></div><div><div class="muted">분석 프레임</div><b>${p.analyzed_frames ?? "-"}</b></div></div>
  ${s.camera ? `<div class="${s.camera.moving ? "warn" : "info"}">카메라: ${esc(s.camera.note)}</div>` : ""}
  ${S.video ? `<h3>오버레이 미리보기</h3><div class="canvas-wrap" id="playerWrap"><video id="player" playsinline controls style="width:100%;display:block"></video><canvas id="overlay" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none"></canvas></div>` : ""}
  <h3>한눈에 요약</h3><div class="cards">${Object.values(s.metrics).map(r => `<div class="tcard t-${r.traffic} ${r.needs_review ? "review" : ""}"><b>${r.name}</b>${fmtTraffic(r.traffic)}${r.status !== "unmeasured" ? ` · 신뢰도 ${r.confidence.toFixed(0)}` : ""}${r.needs_review ? "<br>⚠ 검수 필요" : ""}</div>`).join("")}</div>
  <p><button class="btn" id="toReview">③ 검수로 이동</button></p></div>`;
  $("#toReview").onclick = () => go(2);
  const player = $("#player"); if (player) setupPlayer(player, $("#overlay"));
}
function setupPlayer(player, canvas) {
  const s = S.session; player.src = S.video.src; player.muted = true; const { width, height } = s.videoInfo.analysis; canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d");
  const drawAt = (t) => { ctx.clearRect(0, 0, width, height); const L = viewLm(); const i = Math.max(0, Math.min(L.n - 1, L.indexOfFrame(Math.round(t * s.videoInfo.fps)))); drawSkeleton(ctx, L, i, { lineWidth: 3 }); };
  if ("requestVideoFrameCallback" in player) { const loop = (now, meta) => { drawAt(meta.mediaTime); player.requestVideoFrameCallback(loop); }; player.requestVideoFrameCallback(loop); } else player.addEventListener("timeupdate", () => drawAt(player.currentTime));
  player.addEventListener("seeked", () => drawAt(player.currentTime)); player.addEventListener("loadeddata", () => drawAt(0));
}

// ------------------------------------------------------------ ③ 검수
function renderReview() {
  const s = S.session; if (!s?.metrics) { app.innerHTML = `<div class="card"><h2>③ 검수</h2><p class="muted">분석 결과가 없습니다. ② 분석을 먼저 실행하세요.</p></div>`; return; }
  const keys = Object.keys(s.metrics); S.tab = Math.min(S.tab, keys.length - 1); const k = keys[S.tab], r = s.metrics[k]; const thr = S.configs.thresholds.common.confidence_review_threshold ?? 60;
  const kv = keyValues(k, r);
  app.innerHTML = `<div class="card"><h2>③ 검수 — 자동 검출 확인·수정</h2><p class="muted">신뢰도 ${thr} 미만 지표는 빨간 테두리. 썸네일의 ◀ ▶ 로 기점 프레임을 옮기면 즉시 재계산됩니다.</p>
  <div class="tabs">${keys.map((kk, i) => `<button data-tab="${i}" class="${i === S.tab ? "active" : ""}">${TRAFFIC[s.metrics[kk].traffic]?.[0] || "⚪"} ${s.metrics[kk].name}</button>`).join("")}</div>
  <div class="metric-head ${r.needs_review ? "review" : ""}"><b>${r.name}</b> — ${fmtTraffic(r.traffic)}${r.status !== "unmeasured" ? ` · 신뢰도 <b>${r.confidence.toFixed(0)}</b>/100` : ""}${r.needs_review ? ' · <span style="color:#d64545"><b>검수 필요</b></span>' : ""}${r.status === "reference" ? " · 참고용 구도" : ""}${r.status === "unmeasured" ? `<br><span class="muted">${esc(r.reason)}</span>` : ""}</div>
  ${r.status === "unmeasured" ? "" : `${r.notes.map(n => `<div class="muted">• ${esc(n)}</div>`).join("")}
  <div class="kv" style="margin:8px 0">${kv.map(([a, b]) => `<span>${esc(a)}</span><span><b>${esc(b)}</b></span>`).join("")}</div>
  <div class="charts" id="charts"></div>
  ${r.events.length ? `<h3>검출 기점 (◀ ▶ 로 수정)</h3><p class="muted">✎ 관절 수정 · 📷 이 프레임을 사진 분석으로 보내기 ${Object.keys(REFS).length ? `· <label><input type="checkbox" id="showRef" ${S.showRef ? "checked" : ""}> ⭐ 모범 자세 겹치기</label>` : "· ⭐ 모범 자세는 사진 분석에서 저장"}</p><div class="events" id="events"></div>` : ""}
  <h3>코치 코멘트 <span class="muted">(자동 초안 — 수정하면 PDF에 반영)</span></h3><textarea id="comment">${esc(s.review.comments[k] || r.comment)}</textarea><p><button class="btn small" id="saveComment">코멘트 저장</button> <button class="btn small sec" id="resetComment">초안으로 되돌리기</button></p>`}
  </div><div id="jointPanel"></div>`;
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.tab = +b.dataset.tab; S.editFrame = null; render(); });
  if ($("#comment")) attachPolish($("#comment"), { metric: r.name, measures: measuresOf(r), esc, toast, onApply: (v) => { s.review.comments[k] = v; recompute(); persist(); toast("다듬은 코멘트를 저장했습니다"); } });
  $("#showRef")?.addEventListener("change", (e) => { S.showRef = e.target.checked; render(); });
  $("#saveComment")?.addEventListener("click", () => { s.review.comments[k] = $("#comment").value; recompute(); persist(); toast("저장했습니다"); render(); });
  $("#resetComment")?.addEventListener("click", () => { delete s.review.comments[k]; recompute(); persist(); render(); });
  if (r.status !== "unmeasured") { renderCharts(k, r); renderEvents(k, r); }
  if (S.editFrame !== null) renderJointPanel();
}
const chartCache = new Map();
function chartURL(k, idx, spec) { const key = `${k}:${idx}:${JSON.stringify(spec).length}:${S.session.id}:${S.recomputeStamp || 0}`; if (!chartCache.has(key)) chartCache.set(key, renderChart(spec, 640)); return chartCache.get(key); }
function renderCharts(k, r) { const el = $("#charts"); if (!el) return; el.innerHTML = r.charts.map((c, i) => `<img src="${chartURL(k, i, c)}" alt="${esc(c.title)}">`).join(""); }
async function renderEvents(k, r) {
  const el = $("#events"); if (!el) return; const token = (S.renderToken = (S.renderToken || 0) + 1); const s = S.session;
  el.innerHTML = r.events.map(ev => `<div class="ev" data-ev="${esc(ev.id)}"><div class="thumb muted">썸네일 준비 중…</div><div class="cap">${esc(ev.label)} · 프레임 ${ev.frame} (${(ev.frame / s.videoInfo.fps).toFixed(2)}s)${ev.edited ? " · ✏️수정됨" : ""}</div><div class="btns"><button data-d="-5">◀◀</button><button data-d="-1">◀</button><button data-d="1">▶</button><button data-d="5">▶▶</button>${ev.edited ? '<button data-d="reset" title="자동값으로">↺</button>' : ""}<button data-d="edit" title="관절 위치 수정">✎</button><button data-d="photo" title="이 프레임을 사진 분석으로 보내기">📷</button></div></div>`).join("");
  el.querySelectorAll(".ev").forEach(card => { const id = card.dataset.ev, ev = r.events.find(e => e.id === id); card.querySelectorAll("button").forEach(b => b.onclick = () => onEventButton(k, ev, b.dataset.d)); });
  if (!S.video) return;
  for (const ev of r.events) { if (token !== S.renderToken) return; const card = el.querySelector(`[data-ev="${CSS.escape(ev.id)}"] .thumb`); if (!card) continue; try { const angle = (ev.kind === "catch_end" || ev.kind === "knee_min") && ev.joints.length === 3 ? { joints: ev.joints, value: angleValue(ev) } : null; const side = (ev.joints[0] || "").startsWith("left") ? "left" : (ev.joints[0] || "").startsWith("right") ? "right" : armSide(); const url = await captureURL({ frame: ev.frame, label: ev.label, highlight: ev.joints, angle, refKind: REF_KIND_OF_EVENT[ev.kind], side }, 420); card.outerHTML = `<img src="${url}" alt="">`; } catch (e) { card.textContent = "캡처 실패"; } }
}
function angleValue(ev) { const lm = viewLm(), i = lm.indexOfFrame(ev.frame); const [a, b, c] = ev.joints.map(j => lm.data[j]); const v1x = a.x[i] - b.x[i], v1y = a.y[i] - b.y[i], v2x = c.x[i] - b.x[i], v2y = c.y[i] - b.y[i]; const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); return n ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180 / Math.PI : null; }
async function sendToPhoto(ev) {
  const s = S.session, L = viewLm(), i = L.indexOfFrame(ev.frame); const fps = s.videoInfo.fps;
  await seekTo(S.video, L.frame[i] / fps); const k = Math.min(1, 1600 / Math.max(S.video.videoWidth, S.video.videoHeight));
  const c = document.createElement("canvas"); c.width = Math.round(S.video.videoWidth * k); c.height = Math.round(S.video.videoHeight * k); const g = c.getContext("2d"); g.drawImage(S.video, 0, 0, c.width, c.height);
  if (s.settings.underwater_preprocess && ["side_under", "bottom"].includes(s.settings.view)) underwaterEnhance(g, c.width, c.height);
  const sc = c.width / L.width; const lmArr = JOINTS.map(j => [L.data[j].x[i] * sc, L.data[j].y[i] * sc, L.data[j].v[i]]);
  const side = (ev.joints[0] || "").startsWith("left") ? "left" : (ev.joints[0] || "").startsWith("right") ? "right" : armSide();
  const n = await addPhotoFromCanvas(c, { kind: REF_KIND_OF_EVENT[ev.kind] || "other", side, lmArr, name: `${ev.label} (${(L.frame[i] / fps).toFixed(2)}s)`, student: s.name, stroke: s.settings.stroke });
  toast(`📷 사진 분석에 추가했습니다 (${n}장). 위쪽 📷 사진 탭에서 확인하세요.`, 4000);
}
function onEventButton(k, ev, d) {
  const s = S.session; const evs = (s.review.events[k] = s.review.events[k] || {});
  if (d === "photo") { sendToPhoto(ev); return; }
  if (d === "edit") { S.editFrame = ev.frame; S.editJoint = EDITABLE_JOINTS.includes(ev.joints[1]) ? ev.joints[1] : EDITABLE_JOINTS.includes(ev.joints[0]) ? ev.joints[0] : S.editJoint; render(); setTimeout(() => $("#jointPanel")?.scrollIntoView({ behavior: "smooth" }), 50); return; }
  if (d === "reset") delete evs[ev.id]; else evs[ev.id] = Math.max(0, ev.frame + (+d));
  S.recomputeStamp = Date.now(); recompute(); persist(); render();
}
async function renderJointPanel() {
  const s = S.session, f = S.editFrame; const el = $("#jointPanel"); if (!el) return;
  el.innerHTML = `<div class="joint-edit"><h3>관절 위치 수정 — 프레임 ${f}</h3><p class="muted">점을 <b>손가락(마우스)으로 끌어서</b> 옮기세요. 놓는 순간 저장되고 지표가 다시 계산됩니다. 빈 곳을 누르면 아래에서 고른 관절이 그 자리로 옵니다.</p>
  <div class="grid"><label class="f">빈 곳 누를 때 옮길 관절<select id="jointSel">${EDITABLE_JOINTS.map(j => `<option value="${j}" ${j === S.editJoint ? "selected" : ""}>${KO_NAMES[j] || j}</option>`).join("")}</select></label>
  <label class="f">고친 만큼 앞뒤 프레임도 따라오게<select id="spreadSel">${[0, 3, 5, 10].map(v => `<option value="${v}" ${(s.review.spread ?? 5) === v ? "selected" : ""}>${v === 0 ? "이 프레임만" : `앞뒤 ${v}프레임`}</option>`).join("")}</select></label>
  <div><button class="btn small sec" id="prevF">◀ 이전 프레임</button> <button class="btn small sec" id="nextF">다음 프레임 ▶</button></div>
  <div><button class="btn small sec" id="resetJoints">이 프레임 수정 되돌리기</button> <button class="btn small" id="closeEdit">완료</button></div></div>
  <div class="canvas-wrap" style="margin-top:8px"><canvas id="editCanvas" style="touch-action:none;cursor:crosshair"></canvas></div><div class="muted" id="editList"></div><div id="editMetric" class="info" hidden></div></div>`;
  $("#jointSel").onchange = e => { S.editJoint = e.target.value; draw(); };
  $("#spreadSel").onchange = e => { s.review.spread = +e.target.value; afterEdit(); };
  $("#closeEdit").onclick = () => { S.editFrame = null; render(); };
  $("#resetJoints").onclick = () => { delete s.review.joints[String(f)]; afterEdit(); };
  const step = () => { const L = viewLm(); const i = L.indexOfFrame(S.editFrame); return { L, i }; };
  $("#prevF").onclick = () => { const { L, i } = step(); if (i > 0) { S.editFrame = L.frame[i - 1]; renderJointPanel(); } };
  $("#nextF").onclick = () => { const { L, i } = step(); if (i < L.n - 1) { S.editFrame = L.frame[i + 1]; renderJointPanel(); } };
  const c = $("#editCanvas"); const L0 = viewLm(); const i0 = L0.indexOfFrame(f); const fc = S.video ? await grabFrame(L0.frame[i0]) : null;
  // 사람 주변을 확대해서 보여 줌 (작은 점도 잡기 쉽게)
  const box = (await import("./viz/draw.js")).personBox(L0, i0, 0.45, 200) || { x: 0, y: 0, w: L0.width, h: L0.height };
  const scale = Math.min(1600 / box.w, 3); c.width = Math.round(box.w * scale); c.height = Math.round(box.h * scale);
  let drag = null;
  function draw() {
    const L = viewLm(), i = L.indexOfFrame(f); const ctx = c.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    if (fc) ctx.drawImage(fc, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height); else { ctx.fillStyle = "#223"; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.save(); ctx.translate(-box.x * scale, -box.y * scale); drawSkeleton(ctx, L, i, { highlight: [S.editJoint, drag?.j].filter(Boolean), lineWidth: 3, scale, minVis: 0 }); ctx.restore();
    if (drag) { ctx.fillStyle = "#ff2020"; ctx.beginPath(); ctx.arc((drag.x - box.x) * scale, (drag.y - box.y) * scale, 10, 0, Math.PI * 2); ctx.fill(); }
    const edits = s.review.joints[String(f)] || {}; $("#editList").textContent = Object.keys(edits).length ? "수정됨: " + Object.keys(edits).map(j => KO_NAMES[j] || j).join(", ") : "아직 수정 없음";
  }
  const toImg = (e) => { const r = c.getBoundingClientRect(); return [box.x + (e.clientX - r.left) * c.width / r.width / scale, box.y + (e.clientY - r.top) * c.height / r.height / scale]; };
  c.onpointerdown = (e) => {
    const [x, y] = toImg(e); const L = viewLm(), i = L.indexOfFrame(f); let best = null, bd = Infinity;
    for (const j of EDITABLE_JOINTS) { const jx = L.data[j].x[i], jy = L.data[j].y[i]; if (Number.isNaN(jx)) continue; const d = Math.hypot(jx - x, jy - y) * scale; if (d < bd) { bd = d; best = j; } }
    const grab = bd < 40 ? best : S.editJoint; drag = { j: grab, x, y }; S.editJoint = grab; $("#jointSel").value = grab; c.setPointerCapture(e.pointerId); draw();
  };
  c.onpointermove = (e) => { if (!drag) return; const [x, y] = toImg(e); drag.x = x; drag.y = y; draw(); };
  c.onpointerup = (e) => { if (!drag) return; (s.review.joints[String(f)] = s.review.joints[String(f)] || {})[drag.j] = [drag.x, drag.y]; drag = null; afterEdit(); };
  function afterEdit() {
    const before = JSON.stringify(Object.values(s.metrics).map(r => [r.key, r.summary?.mean ?? r.summary?.knee_mean ?? r.summary?.sink_angle_mean ?? null]));
    S.recomputeStamp = Date.now(); recompute(); persist(); draw();
    const k = Object.keys(s.metrics)[S.tab], r = s.metrics[k]; const m = $("#editMetric");
    m.hidden = false; m.innerHTML = `저장했습니다. <b>${esc(r.name)}</b>: ${esc(fmtTraffic(r.traffic))}` + (r.summary?.mean != null ? ` · 평균 ${r.summary.mean.toFixed(1)}°` : r.summary?.knee_mean != null ? ` · 무릎 ${r.summary.knee_mean.toFixed(1)}°` : r.summary?.sink_angle_mean != null ? ` · ${r.summary.sink_angle_mean.toFixed(1)}°` : "") + ` <span class="muted">(위쪽 수치·썸네일은 '완료'를 누르면 갱신)</span>`;
  }
  draw();
}

// ------------------------------------------------------------ ④ 리포트
function renderReport() {
  const s = S.session; if (!s?.metrics) { app.innerHTML = `<div class="card"><h2>④ 리포트</h2><p class="muted">분석 결과가 없습니다.</p></div>`; return; }
  const ex = s.review.extra || (s.review.extra = {}); const auto = autoTop3(s.metrics); const top = ex.top3 || auto;
  const drills = ex.drills || [...new Set(Object.values(s.metrics).flatMap(r => r.drills || []))].slice(0, 6);
  app.innerHTML = `<div class="card"><h2>④ 리포트</h2><h3>우선 개선 포인트 TOP 3 · 추천 드릴</h3><p class="muted">비워 두면 신호등(빨강→노랑)과 신뢰도 순으로 자동 선정합니다.</p>
  ${[0, 1, 2].map(i => `<div class="grid" style="margin-bottom:6px"><label class="f">포인트 ${i + 1}<input type="text" data-top="${i}" data-f="title" value="${esc(top[i]?.title || "")}"></label><label class="f">설명<input type="text" data-top="${i}" data-f="detail" value="${esc(top[i]?.detail || "")}"></label></div>`).join("")}
  <label class="f">추천 드릴 (줄바꿈으로 구분)<textarea id="drills">${esc(drills.join("\n"))}</textarea></label>
  <label class="f" style="margin-top:8px">마무리 한마디<textarea id="closing" style="min-height:60px">${esc(ex.closing || "")}</textarea></label>
  <h3>📈 이전 기록과 비교</h3><div id="history" class="muted">불러오는 중…</div>
  <h3>PDF 옵션</h3>
  <label class="c"><input type="checkbox" id="optQr" ${ex.qr ? "checked" : ""} ${S.video && cloud.user() ? "" : "disabled"}> 📱 PDF 에 분석 영상 QR 넣기 ${S.video ? (cloud.user() ? "<span class='muted'>(오버레이 영상을 만들어 서버에 올립니다 — 영상 길이만큼 걸림)</span>" : "<span class='muted'>(📂 메뉴에서 로그인하면 사용 가능)</span>") : "<span class='muted'>(영상이 있는 분석에서만)</span>"}</label>
  <label class="c"><input type="checkbox" id="optRef" ${S.showRef ? "checked" : ""}> ⭐ 캡처에 모범 자세 겹치기 <span class="muted">(저장된 모범: ${Object.keys(REFS).length ? Object.keys(REFS).join(", ") : "없음"})</span></label>
  <p><button class="btn" id="pdfBtn">📄 PDF 리포트 만들기</button> <span id="pdfStatus" class="muted"></span></p>
  <h3>원본 데이터</h3><p><button class="btn small sec" id="dlCsv">landmarks.csv</button> <button class="btn small sec" id="dlJson">metrics.json</button> ${S.video ? '<button class="btn small sec" id="dlOverlay">오버레이 영상 만들기</button>' : ""} <span id="ovStatus" class="muted"></span></p>
  <p class="muted">결과는 이 기기 브라우저에만 저장됩니다(📂 이전 분석). 브라우저 데이터를 지우면 사라지니 PDF 는 꼭 내려받으세요.</p></div>`;
  const saveExtra = () => { ex.top3 = [0, 1, 2].map(i => ({ title: $(`[data-top="${i}"][data-f="title"]`).value, detail: $(`[data-top="${i}"][data-f="detail"]`).value })); ex.drills = $("#drills").value.split("\n").map(x => x.trim()).filter(Boolean); ex.closing = $("#closing").value; persist(); };
  app.querySelectorAll("input,textarea").forEach(el => el.addEventListener("change", saveExtra));
  $("#pdfBtn").onclick = async () => { saveExtra(); const b = $("#pdfBtn"); b.disabled = true; try { await makePdf(); } catch (e) { console.error(e); toast("PDF 생성 실패: " + e.message, 6000); } finally { b.disabled = false; } };
  $("#dlCsv").onclick = () => download(new Blob([viewLm().toCSV()], { type: "text/csv" }), `${s.id}_landmarks.csv`);
  $("#dlJson").onclick = () => download(new Blob([JSON.stringify({ settings: s.settings, cycles: s.cycles, camera_motion: s.camera, metrics: s.metrics }, null, 1)], { type: "application/json" }), `${s.id}_metrics.json`);
  $("#dlOverlay")?.addEventListener("click", async () => { const b = await overlayBlob(); download(b, `${s.id}_overlay.${b.type.includes("mp4") ? "mp4" : "webm"}`); });
  $("#optQr")?.addEventListener("change", (e) => { ex.qr = e.target.checked; persist(); });
  $("#optRef").onchange = (e) => { S.showRef = e.target.checked; };
  gatherHistory(s.name, { photoMetrics: (rec) => photoMetricsOf(rec, S.configs), currentId: s.id, currentMetrics: s.metrics, currentCreated: s.created }).then(h => { S.history = h; const el = $("#history"); if (el) el.innerHTML = historyHtml(h, esc); });
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
async function loadFonts() { if (S.fonts) return S.fonts; const [r, b] = await Promise.all(["Regular", "Bold"].map(w => fetch(`./vendor/fonts/NotoSansKR-${w}-subset.ttf`).then(x => x.arrayBuffer()))); return (S.fonts = { regular: r, bold: b }); }
async function makePdf() {
  const s = S.session, st = $("#pdfStatus"); st.textContent = "그래프·캡처 준비 중…"; const images = { charts: {}, captures: {} };
  for (const [k, r] of Object.entries(s.metrics)) { if (r.status === "unmeasured") continue; images.charts[k] = r.charts.map((c, i) => chartURL(k, i, c)); images.captures[k] = []; const refKind = { catch_angle: "catch", knee_hip_kick: "kick", streamline: "glide", rolling: "roll" }[k]; if (S.video) for (const cap of r.captures.slice(0, 4)) { try { images.captures[k].push({ ...cap, dataURL: await captureURL({ ...cap, refKind }, 640) }); } catch (e) { console.warn(e); } } }
  let qr = null;
  if (s.review.extra?.qr && S.video && cloud.user()) {
    try {
      st.textContent = "분석 영상 만드는 중… (영상 길이만큼 걸립니다)"; const blob = await overlayBlob(st);
      st.textContent = "분석 영상 올리는 중…"; const ext = blob.type.includes("mp4") ? "mp4" : "webm"; const path = cloud.userPath(s.id, "overlay." + ext);
      const up = await cloud.uploadFile(path, blob, blob.type); const url = up.ok ? await cloud.signedUrl(path, 31536000) : null;
      if (url) qr = { url, dataURL: qrDataURL(url), note: `링크는 1년 동안 유효합니다 · ${ext === "webm" ? "아이폰은 최신 iOS 에서 재생됩니다" : "mp4"}` }; else toast("영상 업로드 실패 — QR 없이 만듭니다", 4000);
    } catch (e) { console.warn(e); toast("QR 영상 준비 실패: " + e.message, 5000); }
  }
  let history = S.history && S.history.rows.length >= 2 && S.history.used.length ? { ...S.history, chartURL: renderChart(historyChartSpec(S.history), 640) } : null;
  st.textContent = "PDF 만드는 중…"; const fonts = await loadFonts();
  const bytes = await buildPdf({ session: s, results: s.metrics, cycles: s.cycles, images, configs: { ...S.configs, STROKES, VIEWS, CAMERA_MODES }, fonts, history, qr });
  download(new Blob([bytes], { type: "application/pdf" }), `SwimLens_리포트_${s.name}.pdf`); st.textContent = `완료 (${(bytes.length / 1024).toFixed(0)} KB)`;
  if (cloud.user()) { const path = cloud.userPath(s.id, "report.pdf"); const r = await cloud.uploadFile(path, new Blob([bytes], { type: "application/pdf" }), "application/pdf"); if (r.ok) { s.pdfPath = path; await cloud.patchCloud(s.id, { pdf_path: path }); persist(); st.textContent += " · ☁ 서버에도 저장"; } else st.textContent += " · ☁ 서버 업로드 실패"; }
}
function qrDataURL(text) {
  const q = window.qrcode(0, "M"); q.addData(text); q.make(); const n = q.getModuleCount(), cell = 6, pad = 4; const c = document.createElement("canvas"); c.width = c.height = (n + pad * 2) * cell;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + pad) * cell, (r + pad) * cell, cell, cell);
  return c.toDataURL("image/png");
}
/** 스켈레톤 오버레이 영상 Blob (mp4 를 지원하면 mp4, 아니면 webm). 같은 분석이면 재사용 */
async function overlayBlob(statusEl) {
  const s = S.session; const key = s.id + ":" + (S.recomputeStamp || 0); if (S._ovKey === key && S._ovBlob) return S._ovBlob;
  if (!("MediaRecorder" in window)) throw new Error("이 브라우저는 영상 녹화를 지원하지 않습니다");
  const st = statusEl || $("#ovStatus"); const { width, height } = s.videoInfo.analysis; const c = document.createElement("canvas"); c.width = width; c.height = height; const ctx = c.getContext("2d");
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"]; const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
  const fps = s.videoInfo.fps; const L = viewLm(); const n = L.n; const outFps = Math.min(30, L.fps);
  const stream = c.captureStream(0); const track = stream.getVideoTracks()[0]; const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : {}); const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
  const ref = (i) => { const k = REF_KIND_OF_EVENT; return null; };
  for (let i = 0; i < n; i++) {
    await seekTo(S.video, L.frame[i] / fps); ctx.drawImage(S.video, 0, 0, width, height); drawSkeleton(ctx, L, i, { lineWidth: 3 });
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(6, 6, 170, 26); ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif"; ctx.fillText(`${L.frame[i]}  ${(L.t_ms[i] / 1000).toFixed(2)}s`, 12, 25);
    track.requestFrame && track.requestFrame(); await new Promise(r => setTimeout(r, 1000 / outFps)); if (i % 15 === 0 && st) st.textContent = `분석 영상 ${Math.round(i / n * 100)}%`;
  }
  rec.stop(); await new Promise(r => rec.onstop = r); const blob = new Blob(chunks, { type: (mime || "video/webm").split(";")[0] });
  S._ovKey = key; S._ovBlob = blob; if (st) st.textContent = "분석 영상 완료"; return blob;
}

// ------------------------------------------------------------ 라우팅/부팅
function updateNav() { document.querySelectorAll("#nav button").forEach(b => { const k = +b.dataset.step; b.classList.toggle("active", k === S.step); b.disabled = k === 4 ? false : (k >= 2 && !S.session?.metrics) || (k === 1 && !S.session); }); }
function render() {
  updateNav();
  if (S.step === 2) refreshRefs().then(() => {});
  [renderSetup, renderRun, renderReview, renderReport, renderPhoto][S.step]();
}
async function boot() {
  try { S.configs = await loadConfigs(); } catch (e) { app.innerHTML = `<div class="err">설정 파일을 불러오지 못했습니다: ${esc(e.message)}</div>`; return; }
  initPhoto({ app, $, esc, toast, configs: S.configs, download, loadFonts, STROKES, VIEWS, CAMERA_MODES });
  document.querySelectorAll("#nav button").forEach(b => b.onclick = () => go(+b.dataset.step));
  app.addEventListener("change", e => { const t = e.target; if (t.id === "file" && t.files?.[0]) onFile(t.files[0]); else if (t.id === "csvFile" && t.files?.[0]) onCsv(t.files[0]); });
  $("#menuBtn").onclick = () => { $("#drawer").hidden = false; renderDrawer(); }; $("#drawerClose").onclick = () => $("#drawer").hidden = true;
  const badge = document.createElement("span"); badge.id = "cloudBadge"; badge.className = "muted"; badge.style.color = "#fff"; badge.style.fontSize = "12px"; $("#menuBtn").before(badge); setCloudBadge();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => { });
  await refreshRefs(); render(); checkInterrupted();
}
window.__swimlens = S;
boot();
