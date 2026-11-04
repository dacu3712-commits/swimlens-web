// SwimLens 코멘트 다듬기 — Supabase Edge Function (Deno)
// 코치가 먼저 쓴 코멘트를 Claude 가 코치 말투로 다듬는다. API 키는 이 서버에만 있고 웹사이트(브라우저)에는 없다.
// 필요한 Secrets: ANTHROPIC_API_KEY (필수), ALLOWED_EMAILS (쉼표로 구분, 비우면 로그인한 누구나)
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `당신은 수영 코치 박상우(유튜브 '배신튜브')의 리포트 편집자입니다.
코치가 쓴 코멘트 초안을 수강생이 읽을 최종 문장으로 다듬습니다.

지킬 것:
- 코치가 쓴 내용과 판단을 그대로 유지합니다. 새 진단, 새 수치, 새 드릴을 지어내지 않습니다.
- 수치는 아래 '측정값'에 있는 것만 씁니다. 초안의 수치가 측정값과 다르면 측정값을 따르고, 결과의 note 에 한 줄로 알립니다.
- 말투는 아래 '코치 말투' 를 따릅니다. 존댓말, 짧은 문장, 한 문장에 한 가지 생각.
- 결과는 2~5문장. 잘하는 점 → 고칠 점 → 무엇을 연습할지 순서가 자연스러우면 그 순서로.
- 의학적 진단이나 부상 단정은 하지 않습니다.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  // 로그인한 사용자만 (Supabase 가 JWT 를 먼저 검증하지만, 허용 이메일도 확인)
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json(401, { error: "로그인이 필요합니다" });
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email ?? "").toLowerCase())) return json(403, { error: "허용되지 않은 계정입니다" });

  let body: { draft?: string; metric?: string; measures?: unknown; style?: string };
  try { body = await req.json(); } catch { return json(400, { error: "잘못된 요청" }); }
  const draft = String(body.draft ?? "").slice(0, 3000).trim();
  if (!draft) return json(400, { error: "다듬을 코멘트가 비어 있습니다" });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const user_msg = `지표: ${body.metric ?? "-"}
측정값(JSON): ${JSON.stringify(body.measures ?? {}).slice(0, 2000)}

코치 말투:
${String(body.style ?? "").slice(0, 3000)}

코치 초안:
${draft}

다듬은 코멘트를 JSON 으로만 답하세요: {"text": "다듬은 코멘트", "note": "수치 불일치 등 코치가 알아야 할 점 (없으면 빈 문자열)"}`;
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: user_msg }],
    } as any);
    if (res.stop_reason === "refusal") return json(422, { error: "이 문장은 다듬지 못했습니다. 원문을 그대로 쓰세요." });
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let out = { text, note: "" };
    try { const m = text.match(/\{[\s\S]*\}/); if (m) out = JSON.parse(m[0]); } catch { /* 텍스트 그대로 */ }
    return json(200, { ...out, usage: res.usage });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return json(err.status === 429 ? 429 : 502, { error: `Claude 호출 실패: ${err.message ?? e}` });
  }
});
