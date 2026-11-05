// 🎞 영상 → 사진 후보 30장: 빠른 자세 추정으로 캐치·킥·글라이드·롤링 순간을 골라 보여 주고,
// 코치가 고른 뒤 앞뒤 프레임을 좌우로 넘겨 정확한 순간을 맞춘 다음 사진 분석으로 넘긴다.
import { JOINTS } from "./keypoints.js";
import { loadVideo, estimateFps, seekTo, underwaterEnhance } from "./video.js";
import { createLandmarker } from "./pose.js";
import { angleAt } from "./signal/geometry.js";
import { KINDS } from "./photo.js";

const C = { file: null, video: null, fps: 30, duration: 0, a: 0, b: 0, cands: [], busy: false, adjust: null, underwater: false, target: 30 };
let env = null, lmk = null;   // env: {$, esc, toast, addSelected(list), onDone()}
export function initCandidates(e) { env = e; }
export async function setCandidateVideo(file) { C.file = file; C.video = await loadVideo(file); C.fps = await estimateFps(C.video); C.duration = C.video.duration; C.a = 0; C.b = C.duration; C.cands = []; C.adjust = null; }
const J = (n) => JOINTS.indexOf(n);
const fmt = (t) => `${t.toFixed(2)}초`;

function measures(arr) {
  if (!arr) return null; const P = (n) => arr[J(n)]; const vis = (n) => P(n)[2];
  const side = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"].reduce((s, j) => s + vis("left_" + j) - vis("right_" + j), 0) > 0 ? "left" : "right";
  const g = (n) => P(`${side}_${n}`); const A = (a, b, c) => { const v = angleAt(g(a)[0], g(a)[1], g(b)[0], g(b)[1], g(c)[0], g(c)[1]); return Number.isNaN(v) ? null : v; };
  const core = ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip", `${side}_elbow`, `${side}_wrist`, `${side}_knee`, `${side}_ankle`];
  const conf = core.reduce((s, n) => s + vis(n), 0) / core.length;
  const xs = arr.filter(p => p[2] > 0.3).map(p => p[0]), ys = arr.filter(p => p[2] > 0.3).map(p => p[1]);
  const box = xs.length > 3 ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
  const L = P("left_shoulder"), R = P("right_shoulder");
  return { side, conf, box, elbow: A("shoulder", "elbow", "wrist"), knee: A("hip", "knee", "ankle"), under: g("wrist")[1] > g("shoulder")[1],
    body: Math.hypot(g("shoulder")[0] - g("ankle")[0], g("shoulder")[1] - g("ankle")[1]), roll: Math.atan2(-(L[1] - R[1]), Math.abs(L[0] - R[0]) + 1e-9) * 180 / Math.PI };
}
function extremes(vals, ok, maxima, win = 3) {
  const out = []; for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v === null || !ok(i)) continue; let best = true; for (let k = Math.max(0, i - win); k <= Math.min(vals.length - 1, i + win); k++) { const w = vals[k]; if (k !== i && w !== null && (maxima ? w > v : w < v)) { best = false; break; } } if (best) out.push(i); } return out;
}
async function sampleRange(onProg) {
  if (!lmk) lmk = await createLandmarker({ variant: "lite" });
  const v = C.video, W = 480, H = Math.round(v.videoHeight * W / v.videoWidth); const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d", { willReadFrequently: true });
  const f0 = Math.round(C.a * C.fps), f1 = Math.round(C.b * C.fps); const n = Math.min(240, Math.max(1, f1 - f0)); const step = Math.max(1, (f1 - f0) / n);
  const S = []; let ts = (lmk._lastTs ?? -1) + 1;
  for (let k = 0; k < n; k++) { const f = Math.round(f0 + k * step); await seekTo(v, f / C.fps); g.drawImage(v, 0, 0, W, H); if (C.underwater) underwaterEnhance(g, W, H); ts += 40; lmk._lastTs = ts;
    const r = lmk.detectForVideo(cv, ts); const arr = r.landmarks?.[0] ? r.landmarks[0].slice(0, JOINTS.length).map(p => [p.x * W, p.y * H, Math.min(p.visibility ?? 1, p.presence ?? 1)]) : null;
    S.push({ frame: f, t: f / C.fps, m: measures(arr), W, H }); if (k % 6 === 0) { onProg(k / n); await new Promise(r => setTimeout(r, 0)); } }
  return S;
}
function pickCandidates(S, target) {
  const ok = (i) => S[i].m && S[i].m.conf > 0.35; const val = (f) => S.map(s => s.m ? f(s.m) : null);
  const minGap = Math.max(0.12, (C.b - C.a) / (target * 3));
  const lists = [
    ["catch", extremes(val(m => m.elbow), i => ok(i) && S[i].m.under && S[i].m.elbow < 150, false), (i) => (180 - S[i].m.elbow) * S[i].m.conf, 8],
    ["kick", extremes(val(m => m.knee), i => ok(i) && S[i].m.knee < 165, false), (i) => (180 - S[i].m.knee) * S[i].m.conf, 6],
    ["glide", extremes(val(m => m.body), ok, true), (i) => S[i].m.body * S[i].m.conf, 6],
    ["roll", extremes(val(m => Math.abs(m.roll)), i => ok(i) && Math.abs(S[i].m.roll) > 20, true), (i) => Math.abs(S[i].m.roll) * S[i].m.conf, 4],
  ];
  const chosen = [];
  const add = (i, kind, score) => { if (chosen.some(c => Math.abs(c.t - S[i].t) < minGap)) return false; chosen.push({ frame: S[i].frame, t: S[i].t, kind, score, box: S[i].m?.box, side: S[i].m?.side, sw: S[i].W, sh: S[i].H, auto: true }); return true; };
  for (const [kind, idx, sc, cap] of lists) { let k = 0; for (const i of [...idx].sort((p, q) => sc(q) - sc(p))) { if (k >= cap) break; if (add(i, kind, sc(i))) k++; } }
  // 나머지: 구간 전체에 고르게, 사람이 잘 보이는 프레임
  const rest = S.map((s, i) => i).filter(ok); const buckets = Math.max(1, target - chosen.length);
  for (let b = 0; b < buckets && chosen.length < target; b++) { const lo = Math.floor(b * rest.length / buckets), hi = Math.floor((b + 1) * rest.length / buckets); let best = null; for (let k = lo; k < hi; k++) { const i = rest[k]; if (best === null || S[i].m.conf > S[best].m.conf) best = i; } if (best !== null) add(best, "other", S[best].m.conf); }
  // 아직 모자라면 남은 프레임을 시간 간격이 가장 넓은 곳부터 채움
  for (let guard = 0; chosen.length < target && guard < 3; guard++) {
    const pool = rest.filter(i => !chosen.some(c => c.frame === S[i].frame)); if (!pool.length) break;
    pool.sort((p, q) => Math.min(...chosen.map(c => Math.abs(c.t - S[q].t)), 1e9) - Math.min(...chosen.map(c => Math.abs(c.t - S[p].t)), 1e9));
    for (const i of pool) { if (chosen.length >= target) break; add(i, "other", S[i].m.conf); }
    if (chosen.length < target) { const g = minGap; for (const i of pool) { if (chosen.length >= target) break; if (!chosen.some(c => Math.abs(c.t - S[i].t) < g / 3)) chosen.push({ frame: S[i].frame, t: S[i].t, kind: "other", score: S[i].m.conf, box: S[i].m.box, side: S[i].m.side, sw: S[i].W, sh: S[i].H, auto: true }); } }
  }
  if (!chosen.length) for (let b = 0; b < target; b++) { const i = Math.floor(b * S.length / target); chosen.push({ frame: S[i].frame, t: S[i].t, kind: "other", score: 0, auto: true }); }
  return chosen.sort((p, q) => p.t - q.t).slice(0, target);
}
async function thumb(frame, box, w = 200, sw, sh) {
  const v = C.video; await seekTo(v, Math.min(frame / C.fps, Math.max(0, C.duration - 0.001)));
  const k = v.videoWidth / (sw || v.videoWidth); let x = 0, y = 0, cw = v.videoWidth, ch = v.videoHeight;
  if (box) { const bw = (box[2] - box[0]) * k, bh = (box[3] - box[1]) * k; let ww = Math.max(bw * 1.8, v.videoWidth * 0.2), hh = Math.max(bh * 1.8, ww * 9 / 16); if (ww / hh < 16 / 9) ww = hh * 16 / 9; else hh = ww * 9 / 16; ww = Math.min(ww, v.videoWidth); hh = Math.min(hh, v.videoHeight); x = Math.max(0, Math.min(v.videoWidth - ww, (box[0] + box[2]) / 2 * k - ww / 2)); y = Math.max(0, Math.min(v.videoHeight - hh, (box[1] + box[3]) / 2 * k - hh / 2)); cw = ww; ch = hh; }
  const c = document.createElement("canvas"); c.width = w; c.height = Math.round(w * ch / cw); const g = c.getContext("2d"); g.drawImage(v, x, y, cw, ch, 0, 0, c.width, c.height); if (C.underwater) underwaterEnhance(g, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}
export async function fullFrame(frame) {
  const v = C.video; await seekTo(v, Math.min(frame / C.fps, Math.max(0, C.duration - 0.001))); const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas"); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); const g = c.getContext("2d"); g.drawImage(v, 0, 0, c.width, c.height); if (C.underwater) underwaterEnhance(g, c.width, c.height); return c;
}

// ------------------------------------------------------------------ 화면
export function renderCandidates(el) {
  const { $, esc } = env; if (!el) return;
  const sel = C.cands.filter(c => c.selected).length;
  el.innerHTML = `<div class="card"><h2>🎞 영상에서 사진 후보 뽑기</h2>
  <p class="muted">영상을 넣으면 캐치·킥·글라이드·롤링 순간을 자동으로 찾아 <b>후보 ${C.target}장</b>을 보여 줍니다. 마음에 드는 것을 고르고, 필요하면 <b>좌우로 넘겨서</b> 조금 앞·뒤 프레임으로 맞춘 뒤 사진 분석으로 넘기세요.</p>
  <label class="drop" id="cDrop"><input type="file" id="cFile" accept="video/*,.mp4,.mov,.m4v,.webm"><div>${C.file ? `📼 <b>${esc(C.file.name)}</b> (${C.duration.toFixed(1)}초, ${C.fps}fps) — 다른 영상은 여기를 누르세요` : "📼 여기를 눌러 영상을 고르거나 끌어다 놓으세요"}</div></label>
  ${C.video ? `<div class="grid" style="margin-top:8px">
    <label class="f">후보를 찾을 구간 시작 <span class="muted" id="cAv">${fmt(C.a)}</span><input type="range" id="cA" min="0" max="${C.duration}" step="${(1 / C.fps).toFixed(4)}" value="${C.a}"></label>
    <label class="f">구간 끝 <span class="muted" id="cBv">${fmt(C.b)}</span><input type="range" id="cB" min="0" max="${C.duration}" step="${(1 / C.fps).toFixed(4)}" value="${C.b}"></label>
    <label class="f">후보 수<select id="cN">${[12, 20, 30, 40].map(n => `<option ${n === C.target ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="c"><input type="checkbox" id="cUnder" ${C.underwater ? "checked" : ""}> 수중 색보정</label></div>
    <p><button class="btn" id="cRun" ${C.busy ? "disabled" : ""}>🔎 후보 ${C.target}장 뽑기</button> <span id="cProg" class="muted"></span></p>` : ""}
  ${C.cands.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0"><b>후보 ${C.cands.length}장</b> · 선택 ${sel}장
    <button class="btn small sec" data-pick="catch">캐치 후보 모두</button><button class="btn small sec" data-pick="kick">킥 후보 모두</button><button class="btn small sec" data-pick="glide">글라이드 후보 모두</button><button class="btn small sec" data-pick="none">선택 해제</button>
    <button class="btn small" id="cSend" ${sel ? "" : "disabled"}>✅ 선택한 ${sel}장 → 사진 분석</button></div>
    <div class="events" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${C.cands.map((c, i) => `<div class="ev" style="${c.selected ? "outline:3px solid #0f4c81" : ""}" data-ci="${i}">
      <img src="${c.thumb || ""}" alt="" style="cursor:pointer" data-toggle="${i}">
      <div class="cap">${fmt(c.t)} · ${c.kind === "other" ? "기타" : KINDS[c.kind].split(" ")[0] + " 후보"}${c.moved ? ` · ✏️${c.moved > 0 ? "+" : ""}${c.moved}프레임` : ""}</div>
      <div class="btns"><button data-toggle="${i}">${c.selected ? "☑ 선택됨" : "☐ 선택"}</button><button data-adj="${i}">↔ 앞뒤 조정</button></div></div>`).join("")}</div>` : ""}
  <div id="cAdjust"></div></div>`;
  $("#cFile").onchange = async (e) => { if (e.target.files[0]) { try { await setCandidateVideo(e.target.files[0]); } catch (er) { env.toast(er.message, 5000); } renderCandidates(el); } };
  const drop = $("#cDrop"); drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); }); drop.addEventListener("dragleave", () => drop.classList.remove("over")); drop.addEventListener("drop", async e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) { await setCandidateVideo(f); renderCandidates(el); } });
  if (C.video) {
    $("#cA").oninput = (e) => { C.a = Math.min(+e.target.value, C.b - 0.2); $("#cAv").textContent = fmt(C.a); }; $("#cB").oninput = (e) => { C.b = Math.max(+e.target.value, C.a + 0.2); $("#cBv").textContent = fmt(C.b); };
    $("#cN").onchange = (e) => { C.target = +e.target.value; renderCandidates(el); }; $("#cUnder").onchange = (e) => { C.underwater = e.target.checked; };
    $("#cRun").onclick = async () => {
      C.busy = true; const pr = $("#cProg"); try {
        pr.textContent = "자세를 빠르게 훑는 중… 0%"; const S = await sampleRange((f) => { pr.textContent = `자세를 빠르게 훑는 중… ${Math.round(f * 100)}%`; });
        C.cands = pickCandidates(S, C.target); for (const [k, c] of C.cands.entries()) { pr.textContent = `후보 사진 만드는 중… ${k + 1}/${C.cands.length}`; c.thumb = await thumb(c.frame, c.box, 220, c.sw, c.sh); c.origFrame = c.frame; }
      } catch (er) { console.error(er); env.toast("후보 뽑기 실패: " + er.message, 5000); } finally { C.busy = false; renderCandidates(el); }
    };
  }
  el.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { const c = C.cands[+b.dataset.toggle]; c.selected = !c.selected; renderCandidates(el); });
  el.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const k = b.dataset.pick; C.cands.forEach(c => { if (k === "none") c.selected = false; else if (c.kind === k) c.selected = true; }); renderCandidates(el); });
  el.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => { C.adjust = +b.dataset.adj; renderAdjust(el); setTimeout(() => $("#cAdjust")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); });
  $("#cSend")?.addEventListener("click", async () => {
    const list = C.cands.filter(c => c.selected).sort((p, q) => p.t - q.t); const btn = $("#cSend"); btn.disabled = true;
    for (const [k, c] of list.entries()) { btn.textContent = `사진 분석으로 보내는 중… ${k + 1}/${list.length}`; await env.addSelected(c, await fullFrame(c.frame)); }
    C.cands.forEach(c => c.selected = false); env.toast(`📷 ${list.length}장을 사진 분석에 추가했습니다`); env.onDone();
  });
  if (C.adjust !== null) renderAdjust(el);
}
/** ↔ 앞뒤 조정: 큰 미리보기 + 좌우 슬라이더 + 좌우로 넘기는 필름 스트립 */
async function renderAdjust(el) {
  const { $ } = env; const box = $("#cAdjust"); const c = C.cands[C.adjust]; if (!box || !c) return;
  const span = Math.round(C.fps * 1.5); const base = c.origFrame ?? c.frame; const lo = Math.max(0, base - span), hi = Math.min(Math.floor(C.duration * C.fps) - 1, base + span);
  box.innerHTML = `<div class="joint-edit"><h3>↔ ${fmt(c.t)} 후보 앞뒤 조정</h3><p class="muted">아래 필름을 <b>좌우로 밀어서</b> 원하는 프레임을 누르거나, 막대를 끌어 ±1.5초 안에서 고르세요.</p>
    <img id="adjBig" src="${c.thumb}" style="width:100%;max-width:720px;border-radius:8px;display:block">
    <input type="range" id="adjR" min="${lo}" max="${hi}" step="1" value="${c.frame}" style="width:100%">
    <div class="muted" id="adjInfo">프레임 ${c.frame} · ${fmt(c.frame / C.fps)} · 원래보다 ${c.frame - base >= 0 ? "+" : ""}${c.frame - base}프레임</div>
    <div style="display:flex;gap:6px;margin:6px 0"><button class="btn small sec" id="adjM">◀ 1프레임</button><button class="btn small sec" id="adjP">1프레임 ▶</button><button class="btn small sec" id="adjReset">원래 후보로</button><button class="btn small" id="adjOk">✅ 이 프레임으로 (선택)</button><button class="btn small sec" id="adjClose">닫기</button></div>
    <div id="strip" style="display:flex;gap:4px;overflow-x:auto;padding:4px 0;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch"></div></div>`;
  const big = $("#adjBig"), info = $("#adjInfo"); let tok = 0;
  const show = async (f) => { const my = ++tok; c.frame = f; c.t = f / C.fps; info.textContent = `프레임 ${f} · ${fmt(c.t)} · 원래보다 ${f - base >= 0 ? "+" : ""}${f - base}프레임`; $("#adjR").value = f; const url = await thumb(f, c.box, 720, c.sw, c.sh); if (my === tok) big.src = url; markStrip(); };
  $("#adjR").oninput = (e) => show(+e.target.value);
  $("#adjM").onclick = () => show(Math.max(lo, c.frame - 1)); $("#adjP").onclick = () => show(Math.min(hi, c.frame + 1)); $("#adjReset").onclick = () => show(base);
  $("#adjClose").onclick = () => { C.adjust = null; box.innerHTML = ""; renderCandidates(el); };
  $("#adjOk").onclick = async () => { c.selected = true; c.moved = c.frame - base; c.thumb = await thumb(c.frame, c.box, 220, c.sw, c.sh); C.adjust = null; renderCandidates(el); };
  // 필름 스트립 (2프레임 간격, 앞뒤로 천천히 채움)
  const strip = $("#strip"); const stepF = C.fps >= 90 ? 4 : 2; const frames = []; for (let f = lo; f <= hi; f += stepF) frames.push(f);
  strip.innerHTML = frames.map(f => `<div data-f="${f}" style="flex:0 0 auto;width:110px;scroll-snap-align:center;cursor:pointer;text-align:center;font-size:11px;color:#5d6b78"><div style="width:110px;height:62px;background:#223;border-radius:4px;overflow:hidden"></div>${f - base >= 0 ? "+" : ""}${f - base}</div>`).join("");
  function markStrip() { strip.querySelectorAll("[data-f]").forEach(d => d.firstElementChild.style.outline = Math.abs(+d.dataset.f - c.frame) < stepF / 2 + 0.01 ? "3px solid #0f4c81" : "none"); }
  strip.querySelectorAll("[data-f]").forEach(d => d.onclick = () => show(+d.dataset.f)); markStrip();
  const cur = strip.querySelector(`[data-f="${frames.reduce((a, b) => Math.abs(b - c.frame) < Math.abs(a - c.frame) ? b : a)}"]`); cur?.scrollIntoView({ inline: "center", block: "nearest" });
  const order = frames.map((f, i) => i).sort((p, q) => Math.abs(frames[p] - base) - Math.abs(frames[q] - base));
  const myStrip = box.firstElementChild;
  for (const i of order) { if (!box.contains(myStrip) || C.adjust === null) return; const d = strip.children[i]; const url = await thumb(frames[i], c.box, 110, c.sw, c.sh); d.firstElementChild.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover">`; }
}
