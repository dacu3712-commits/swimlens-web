// ✨ 다듬기 버튼: 코치가 먼저 쓴 코멘트 → Claude 가 다듬은 제안 → 적용/버리기
import { polishComment } from "./cloud.js";
export function attachPolish(textarea, { metric, measures, onApply, esc, toast }) {
  if (!textarea || textarea.dataset.polish) return; textarea.dataset.polish = "1";
  const bar = document.createElement("div"); bar.style.margin = "4px 0 8px";
  bar.innerHTML = `<button type="button" class="btn small sec">✨ 다듬기</button> <span class="muted">내가 쓴 문장을 코치 말투로 다듬어 제안합니다 (로그인 필요, 1회 약 10~30원)</span><div class="polish-out" hidden></div>`;
  textarea.after(bar); const btn = bar.querySelector("button"), out = bar.querySelector(".polish-out");
  btn.onclick = async () => {
    const draft = textarea.value.trim(); if (!draft) return toast("먼저 코멘트를 써 주세요");
    btn.disabled = true; btn.textContent = "✨ 다듬는 중…";
    const r = await polishComment({ draft, metric, measures });
    btn.disabled = false; btn.textContent = "✨ 다듬기";
    if (!r.ok) { toast(r.msg, 6000); return; }
    out.hidden = false; out.className = "polish-out info";
    out.innerHTML = `<b>제안</b><div style="white-space:pre-wrap;margin:4px 0">${esc(r.text)}</div>${r.note ? `<div class="muted">⚠ ${esc(r.note)}</div>` : ""}<button type="button" class="btn small" data-a="apply">적용</button> <button type="button" class="btn small sec" data-a="drop">버리기</button>`;
    out.querySelector('[data-a="apply"]').onclick = () => { textarea.value = r.text; out.hidden = true; onApply(r.text); };
    out.querySelector('[data-a="drop"]').onclick = () => { out.hidden = true; };
  };
}
export function measuresOf(r) { const s = {}; for (const [k, v] of Object.entries(r.summary || {})) if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") s[k] = typeof v === "number" ? Math.round(v * 10) / 10 : v; s.traffic = r.traffic; s.confidence = Math.round(r.confidence || 0); return s; }
