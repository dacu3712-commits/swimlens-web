// PDF 리포트 (pdf-lib + Noto Sans KR 서브셋). 파이썬 report/pdf.py 와 같은 구성
import { autoTop3 } from "./summary.js";
const TRAFFIC = { green: ["좋음", [0.18, 0.62, 0.36]], yellow: ["주의", [0.89, 0.71, 0.02]], red: ["개선 필요", [0.84, 0.27, 0.27]], na: ["측정 불가", [0.6, 0.6, 0.6]], info: ["참고", [0.29, 0.5, 0.76]] };
const BRAND = "배신튜브 박상우 코치";
const f1 = (v, d = 1, suf = "") => v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(d) + suf;
export function keyValues(k, r) {
  const s = r.summary || {}, kv = [];
  if (k === "catch_angle") { kv.push(["평균 캐치 각도", f1(s.mean, 0, "°")], ["표준편차", f1(s.std, 1, "°")], ["권장 범위", `${(s.green_range || ["-", "-"]).join("~")}°`], ["측정 사이클", String(s.n || 0)]); if (s.left_mean != null && s.right_mean != null) kv.push(["왼팔 / 오른팔", `${s.left_mean.toFixed(0)}° / ${s.right_mean.toFixed(0)}°`]); }
  else if (k === "split_time") { const rm = s.ratio_mean || {}, dm = s.duration_mean || {}; kv.push(["사이클 평균", f1(s.cycle_sec_mean, 2, "초")]); for (const ph of ["글라이드", "캐치", "풀", "피니시", "리커버리"]) kv.push([ph, `${f1(dm[ph], 2, "초")}  (${f1(rm[ph], 0, "%")})`]); if (s.max_diff_phase) kv.push(["좌우 최대 차이", `${s.max_diff_phase} ${s.left_right_diff_pct[s.max_diff_phase].toFixed(0)}%p`]); }
  else if (k === "rolling") kv.push(["왼쪽 최대 롤링", f1(s.left_max_mean, 0, "°")], ["오른쪽 최대 롤링", f1(s.right_max_mean, 0, "°")], ["좌우 비대칭", f1(s.asymmetry, 0, "°")], ["권장 범위", `${(s.green_range || ["-", "-"]).join("~")}°`], ["골반 롤링 (좌/우)", `${f1(s.hip_left_mean, 0, "°")} / ${f1(s.hip_right_mean, 0, "°")}`]);
  else if (k === "hand_path") { kv.push(["최저 깊이", s.depth_str || "-"], ["안쪽 진입", s.inward_str || "-"]); if (s.press_ratio_mean != null) kv.push(["누르기 / 당기기 비율", `${(s.press_ratio_mean * 100).toFixed(0)}% / ${(s.pull_ratio_mean * 100).toFixed(0)}%`]); if ("crossover" in s) kv.push(["크로스오버", s.crossover ? "있음" : "없음"]); }
  else if (k === "knee_hip_kick") { kv.push(["킥 직전 무릎 각도", f1(s.knee_mean, 0, "°")], ["같은 순간 골반 각도", f1(s.hip_mean, 0, "°")], ["권장 무릎 범위", `${(s.knee_green || ["-", "-"]).join("~")}°`], ["사이클당 킥 수", f1(s.kicks_per_cycle_mean, 1, "회")]); if (s.timing_enabled) kv.push(["입수킥 시간차", s.entry_kick_diff_ms_mean == null ? "-" : `${s.entry_kick_diff_ms_mean >= 0 ? "+" : ""}${s.entry_kick_diff_ms_mean.toFixed(0)}ms (+ 늦음)`], ["출수킥 시간차", s.exit_kick_diff_ms_mean == null ? "-" : `${s.exit_kick_diff_ms_mean >= 0 ? "+" : ""}${s.exit_kick_diff_ms_mean.toFixed(0)}ms (+ 늦음)`]); }
  else if (k === "breathing_speed") { const u = s.has_scale ? "m/s" : "px/s"; kv.push(["노브레싱 속도", f1(s.has_scale ? s.speed_nobreath_m_s : s.speed_nobreath_px_s, 2, " " + u)], ["브레싱 속도", f1(s.has_scale ? s.speed_breath_m_s : s.speed_breath_px_s, 2, " " + u)], ["감속률", f1(s.slowdown_pct, 1, "%")], ["사이클 수 (호흡/무호흡)", `${s.n_breath || 0} / ${s.n_nobreath || 0}`]); }
  else if (k === "breakout") kv.push(["수중 구간 시간", f1(s.underwater_sec, 2, "초")], ["수중 거리", f1(s.underwater_distance_m, 1, " m")], ["돌핀킥 횟수", String(s.kick_count ?? "-")], ["첫 캐치 − 머리 출수", s.diff_ms == null ? "-" : `${s.diff_ms >= 0 ? "+" : ""}${s.diff_ms.toFixed(0)}ms`], ["판정", s.judgement || "-"]);
  else if (k === "streamline") kv.push(["하체 가라앉음 각도(평균)", f1(s.sink_angle_mean, 1, "°")], ["최대", f1(s.sink_angle_max, 1, "°")], ["골반 꺾임", f1(s.hip_bend_mean, 1, "°")], ["기준", `0~${s.green_max ?? 5}° 좋음 / ~${s.yellow_max ?? 10}° 보통`]);
  return kv;
}
export function headline(k, r) {
  const s = r.summary || {}; if (r.status === "unmeasured") return "측정 불가";
  try { return { catch_angle: () => `${s.mean.toFixed(0)}°`, split_time: () => `사이클 ${s.cycle_sec_mean.toFixed(2)}초`, rolling: () => `좌 ${s.left_max_mean.toFixed(0)}° / 우 ${s.right_max_mean.toFixed(0)}°`, hand_path: () => String(s.depth_str).includes("cm") ? s.depth_str : String(s.inward_str || "-").slice(0, 12), knee_hip_kick: () => `무릎 ${s.knee_mean.toFixed(0)}°`, breathing_speed: () => `감속 ${s.slowdown_pct.toFixed(1)}%`, breakout: () => s.judgement || "-", streamline: () => `${s.sink_angle_mean.toFixed(1)}°` }[k](); } catch { return "-"; }
}
/**
 * build({session, results, images:{charts:{key:[dataURL]}, captures:{key:[dataURL]}}, configs, fonts:{regular,bold ArrayBuffer}})
 */
export async function buildPdf({ session, results, cycles, images, configs, fonts }) {
  const { PDFDocument, rgb } = window.PDFLib; const doc = await PDFDocument.create(); doc.registerFontkit(window.fontkit);
  // fontkit 의 서브셋 임베드가 이 폰트에서 글리프를 잃어버리므로 통째로 임베드 (폰트 자체가 2350자 서브셋이라 ~0.6MB)
  const F = await doc.embedFont(fonts.regular, { subset: false }), FB = await doc.embedFont(fonts.bold, { subset: false });
  const fk = F.embedder?.font; const has = (cp) => { try { return !fk || fk.hasGlyphForCodePoint(cp); } catch { return true; } };
  const clean = (t) => Array.from(String(t ?? "")).map(ch => (ch === "\n" || has(ch.codePointAt(0))) ? ch : "?").join("");
  const PW = 595.28, PH = 841.89, M = 42, W = PW - 2 * M; const s = session.settings; let page, y, pageNo = 0;
  const navy = rgb(0.11, 0.23, 0.36), gray = rgb(0.33, 0.33, 0.33);
  const wrap = (text, font, size, maxW) => { const out = []; for (const para of clean(text).split("\n")) { let line = ""; for (const ch of para) { const t = line + ch; if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = ch; } else line = t; } out.push(line); } return out; };
  const text = (t, x, yy, { size = 10.5, font = F, color = rgb(0, 0, 0), maxW = W, lineH = 1.45 } = {}) => { const lines = wrap(t, font, size, maxW); for (const ln of lines) { page.drawText(ln, { x, y: yy - size, size, font, color }); yy -= size * lineH; } return yy; };
  const footer = () => { page.drawText(`SwimLens · ${BRAND} · 자동 분석 + 코치 검수 리포트`, { x: M, y: 24, size: 8, font: F, color: gray }); page.drawText(String(pageNo), { x: PW - M - 10, y: 24, size: 8, font: F, color: gray }); };
  const newPage = () => { page = doc.addPage([PW, PH]); pageNo++; footer(); y = PH - M; return page; };
  const image = async (dataURL, x, yy, maxW, maxH) => { if (!dataURL) return 0; const bytes = Uint8Array.from(atob(dataURL.split(",")[1]), c => c.charCodeAt(0)); const img = dataURL.startsWith("data:image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); const sc = Math.min(maxW / img.width, maxH / img.height); const w = img.width * sc, h = img.height * sc; page.drawImage(img, { x, y: yy - h, width: w, height: h }); return h; };
  const ensure = (need) => { if (y - need < M + 20) newPage(); };
  // ---- 표지
  newPage(); y -= 140; y = text("SwimLens 수영 영상 분석 리포트", M, y, { size: 26, font: FB, maxW: W }); y = text(BRAND, M, y - 4, { size: 14, color: gray }); y -= 40;
  const vi = session.videoInfo || {}; const cover = [["수강생", s.student_name], ["분석일", new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })], ["영법", configs.STROKES[s.stroke] || s.stroke], ["촬영 구도", configs.VIEWS[s.view] || s.view], ["카메라", (configs.CAMERA_MODES[s.camera_mode] || s.camera_mode) + (session.camera?.moving ? " (배경 이동 감지됨)" : "")], ["자세 추정", session.poseInfo?.backend || "MediaPipe Pose (브라우저)"], ["영상", `${vi.width || "-"}x${vi.height || "-"} @ ${vi.fps ? vi.fps.toFixed(0) : "-"}fps, ${vi.duration ? vi.duration.toFixed(1) : "-"}초`]];
  for (const [a, b] of cover) { page.drawText(clean(a), { x: M + 40, y: y - 10, size: 10.5, font: FB, color: navy }); page.drawText(clean(b), { x: M + 160, y: y - 10, size: 10.5, font: F }); page.drawLine({ start: { x: M + 40, y: y - 18 }, end: { x: M + 400, y: y - 18 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) }); y -= 24; }
  y -= 60; text(configs.comments.general.disclaimer, M, y, { size: 8.5, color: gray });
  // ---- 요약
  newPage(); y = text("한눈에 요약", M, y, { size: 18, font: FB, color: navy }); y = text("8개 지표의 신호등입니다. 초록 = 권장 범위, 노랑 = 주의, 빨강 = 개선 필요, 회색 = 이 영상/구도에서 측정 불가.", M, y - 4) - 8;
  const keys = Object.keys(results); const cw = W / 4 - 4, ch = 82;
  keys.forEach((k, i) => { const r = results[k]; const [lab, col] = TRAFFIC[r.traffic] || TRAFFIC.na; const cx = M + (i % 4) * (cw + 5.3), cy = y - Math.floor(i / 4) * (ch + 6); page.drawRectangle({ x: cx, y: cy - ch, width: cw, height: ch, color: rgb(...col) }); let ty = cy - 10; for (const [t, fnt, sz] of [[r.name, FB, 9.5], [lab, FB, 9], [headline(k, r), F, 9], [r.status !== "unmeasured" ? `신뢰도 ${r.confidence.toFixed(0)}` + (r.needs_review ? " · 검수됨" : "") : "", F, 8], [r.status === "reference" ? "(참고용)" : "", F, 8]]) { if (!t) continue; const lines = wrap(t, fnt, sz, cw - 8); for (const ln of lines) { const wdt = fnt.widthOfTextAtSize(ln, sz); page.drawText(ln, { x: cx + (cw - wdt) / 2, y: ty - sz, size: sz, font: fnt, color: rgb(1, 1, 1) }); ty -= sz * 1.35; } } });
  y -= 2 * (ch + 6) + 10;
  const un = Object.values(results).filter(r => r.status === "unmeasured"); if (un.length) { y = text("측정하지 못한 지표", M, y, { size: 13, font: FB }); for (const r of un) y = text(`• ${r.name}: ${r.reason}`, M, y - 2); }
  y = text(`스트로크 사이클 ${cycles?.n_cycles || 0}개 분석` + (cycles?.side ? ` (분석 팔: ${{ left: "왼팔", right: "오른팔", both: "양팔" }[cycles.side] || cycles.side})` : ""), M, y - 8, { size: 8.5, color: gray });
  if (session.camera?.note) y = text("카메라: " + session.camera.note, M, y, { size: 8.5, color: gray });
  // ---- 지표별
  for (const [k, r] of Object.entries(results)) {
    if (r.status === "unmeasured") continue;
    newPage(); const [lab, col] = TRAFFIC[r.traffic] || TRAFFIC.na;
    page.drawText(clean(r.name), { x: M, y: y - 18, size: 18, font: FB, color: navy }); page.drawRectangle({ x: PW - M - 80, y: y - 22, width: 80, height: 22, color: rgb(...col) }); const lw = FB.widthOfTextAtSize(lab, 10); page.drawText(lab, { x: PW - M - 40 - lw / 2, y: y - 16, size: 10, font: FB, color: rgb(1, 1, 1) }); y -= 30;
    y = text(`자동 인식 신뢰도 ${r.confidence.toFixed(0)}/100` + (r.needs_review ? "  · 코치 검수 반영" : "") + (r.status === "reference" ? "  · 참고용 구도" : ""), M, y, { size: 8.5, color: gray }) - 4;
    const kv = keyValues(k, r); const top = y; let ky = y;
    for (const [a, b] of kv) { page.drawText(clean(a), { x: M, y: ky - 9, size: 8.5, font: F, color: gray }); const bl = wrap(b, FB, 10, 120); bl.forEach((ln, i) => page.drawText(ln, { x: M + 96, y: ky - 10 - i * 12, size: 10, font: FB })); ky -= 14 + (bl.length - 1) * 12; page.drawLine({ start: { x: M, y: ky + 2 }, end: { x: M + 215, y: ky + 2 }, thickness: 0.3, color: rgb(0.87, 0.87, 0.87) }); }
    const caps = images.captures?.[k] || []; const prim = caps.find(c => c.primary) || caps[0]; let ih = 0;
    if (prim) { ih = await image(prim.dataURL, M + 230, top, W - 230, 150); page.drawText(clean(prim.caption || ""), { x: M + 230, y: top - ih - 11, size: 8, font: F, color: gray }); ih += 14; }
    y = Math.min(ky, top - ih) - 8;
    for (const url of (images.charts?.[k] || []).slice(0, 2)) { ensure(190); const h = await image(url, M, y, W, 185); y -= h + 6; }
    const others = caps.filter(c => c !== prim).slice(0, 3);
    if (others.length) { ensure(110); const cwid = (W - 12) / 3; for (let i = 0; i < others.length; i++) { const h = await image(others[i].dataURL, M + i * (cwid + 6), y, cwid, 90); page.drawText(clean(others[i].caption || ""), { x: M + i * (cwid + 6), y: y - h - 10, size: 7.5, font: F, color: gray }); } y -= 110; }
    for (const nt of r.notes || []) { ensure(14); y = text("• " + nt, M, y, { size: 8.5, color: gray }); }
    ensure(70); y = text("코치 코멘트", M, y - 6, { size: 13, font: FB });
    const cl = wrap(r.comment || "", F, 10.5, W - 16); const bh = cl.length * 15 + 12; page.drawRectangle({ x: M, y: y - bh, width: W, height: bh, color: rgb(0.957, 0.969, 0.984) }); y = text(r.comment || "", M + 8, y - 6, { size: 10.5, maxW: W - 16 }) - 10;
    if (r.drills?.length) y = text("추천 드릴: " + r.drills.join(" · "), M, y, { size: 8.5, color: gray });
  }
  // ---- 마무리
  newPage(); y = text("우선 개선 포인트 TOP 3", M, y, { size: 18, font: FB, color: navy });
  const extra = session.review?.extra || {}; const top3 = (extra.top3 || autoTop3(results)).filter(t => t.title);
  if (!top3.length) y = text("모든 측정 지표가 권장 범위 안에 있습니다. 지금 동작을 유지하며 영상 기록을 이어가 보세요.", M, y);
  top3.slice(0, 3).forEach((t, i) => { y = text(`${i + 1}. ${t.title} — ${t.detail || ""}`, M, y - 2, { font: F }); });
  y -= 16; y = text("추천 드릴", M, y, { size: 18, font: FB, color: navy });
  const drills = extra.drills || [...new Set(Object.values(results).flatMap(r => r.drills || []))].slice(0, 6);
  if (drills.length) for (const d of drills) y = text("□ " + d, M, y); else y = text("(코치 입력)", M, y, { size: 8.5, color: gray });
  if (extra.closing) { y -= 16; y = text("코치의 한마디", M, y, { size: 18, font: FB, color: navy }); y = text(extra.closing, M, y); }
  y -= 16; y = text("측정 조건 안내", M, y, { size: 13, font: FB }); y = text(configs.comments.general.disclaimer, M, y, { size: 8.5, color: gray });
  y = text("• 각도는 카메라 광축에 수직인 평면에서의 투영 각도입니다. 측면 영상에서 카메라를 향해 기울어진 팔·다리는 실제보다 작거나 크게 측정될 수 있습니다.\n• 속도·거리는 '거리 기준 2점 + 실제 거리' 보정과 고정 카메라에서만 m 단위로 표시되며, 카메라가 따라가며 촬영한 영상에서는 계산하지 않습니다.\n• 신뢰도 점수는 관절 인식 확률과 보간 비율로 계산한 자동 추정치이며, 60점 미만 지표는 코치가 기점을 직접 검수했습니다.", M, y, { size: 8.5, color: gray });
  doc.setTitle(`SwimLens 리포트 - ${s.student_name}`); doc.setAuthor(BRAND);
  return await doc.save();
}
