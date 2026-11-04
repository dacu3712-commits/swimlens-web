// Supabase 연동 (수영 게임 SWIM MASTER 와 같은 프로젝트·같은 로그인 계정)
// - REST + Auth 만 사용 (라이브러리 없음). 로그인하면 분석 결과를 swimlens_sessions 표에, PDF 를 swimlens 버킷에 저장한다.
export const SUPABASE_URL = "https://oybuvnopuacmljgwlzjb.supabase.co";
export const SUPABASE_KEY = "sb_publishable_kdiZas7V5dL8_JsvaJfwgA_p5TpKIat";   // 공개 가능한 publishable 키 (게임과 동일)
const LS = "swimlens_auth";
let auth = null;                                   // {access, refresh, exp, email, id}
try { auth = JSON.parse(localStorage.getItem(LS) || "null"); } catch { auth = null; }
export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const user = () => auth ? { email: auth.email, id: auth.id } : null;
function store(a) { auth = a; try { if (a) localStorage.setItem(LS, JSON.stringify(a)); else localStorage.removeItem(LS); } catch { } }
async function req(path, { method = "GET", body, token, headers = {}, raw = false } = {}) {
  try {
    const res = await fetch(SUPABASE_URL + path, { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token || auth?.access || SUPABASE_KEY}`, ...(raw ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) { return { ok: false, status: 0, data: null, error: e.message }; }
}
function fromToken(data, email) {
  if (!data?.access_token) return null;
  return { access: data.access_token, refresh: data.refresh_token, exp: Date.now() + (data.expires_in || 3600) * 1000 - 60000, email: data.user?.email || email, id: data.user?.id || auth?.id };
}
export async function login(email, password) {
  const r = await req("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, token: SUPABASE_KEY });
  if (!r.ok) { const msg = JSON.stringify(r.data || "").toLowerCase(); return { ok: false, msg: r.status === 0 ? "서버에 연결하지 못했습니다" : /invalid/.test(msg) ? "이메일 또는 비밀번호가 맞지 않습니다" : "로그인 실패 (" + r.status + ")" }; }
  store(fromToken(r.data, email)); return { ok: true };
}
export async function signup(email, password) {
  const r = await req("/auth/v1/signup", { method: "POST", body: { email, password }, token: SUPABASE_KEY });
  if (r.ok && r.data?.access_token) { store(fromToken(r.data, email)); return { ok: true, code: "created" }; }
  if (r.ok) return { ok: false, code: "confirm", msg: "가입 확인 메일을 눌러 주세요" };
  return { ok: false, code: "err", msg: JSON.stringify(r.data || "").slice(0, 120) };
}
export function logout() { store(null); }
let refreshing = null;
export async function ensureToken() {
  if (!auth) return false; if (Date.now() < auth.exp) return true;
  if (!refreshing) refreshing = req("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: auth.refresh }, token: SUPABASE_KEY }).then(r => { const a = fromToken(r.data, auth.email); if (a) { store(a); return true; } if (r.status >= 400 && r.status < 500) store(null); return false; }).finally(() => { refreshing = null; });
  return refreshing;
}
// ---------------- 세션 표
const T = "/rest/v1/swimlens_sessions";
export async function listCloud() {
  if (!(await ensureToken())) return { ok: false, rows: [] };
  const r = await req(`${T}?select=id,name,created,settings,video_info,has_metrics,updated_at,pdf_path,video_path&order=created.desc&limit=200`);
  return { ok: r.ok, rows: r.ok && Array.isArray(r.data) ? r.data : [], status: r.status };
}
export async function upsertCloud(sess, landmarksCsv) {
  if (!(await ensureToken())) return { ok: false, msg: "로그인이 필요합니다" };
  const row = { id: sess.id, user_id: auth.id, name: sess.name, created: sess.created, settings: sess.settings, video_info: sess.videoInfo, metrics: sess.metrics, review: sess.review, cycles: sess.cycles, camera: sess.camera, pose_info: sess.poseInfo, landmarks_csv: landmarksCsv, has_metrics: !!sess.metrics, updated_at: new Date().toISOString() };
  if (sess.videoPath) row.video_path = sess.videoPath; if (sess.pdfPath) row.pdf_path = sess.pdfPath;   // 경로는 알고 있을 때만 (null 로 덮어쓰지 않게)
  const r = await req(T, { method: "POST", body: row, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
  return { ok: r.ok, status: r.status, msg: r.ok ? "" : `저장 실패 (${r.status}) ${JSON.stringify(r.data || r.error || "").slice(0, 160)}` };
}
export async function getCloud(id) {
  if (!(await ensureToken())) return null;
  const r = await req(`${T}?id=eq.${encodeURIComponent(id)}&select=*`); return r.ok && r.data?.[0] ? r.data[0] : null;
}
export async function deleteCloud(id) { if (!(await ensureToken())) return false; const r = await req(`${T}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return r.ok; }
// ---------------- 스토리지 (PDF, 선택적으로 영상)
const BUCKET = "swimlens";
export async function uploadFile(path, blob, contentType) {
  if (!(await ensureToken())) return { ok: false };
  const r = await req(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", body: blob, raw: true, headers: { "Content-Type": contentType, "x-upsert": "true" } });
  return { ok: r.ok, status: r.status, path };
}
export async function signedUrl(path, seconds = 3600) {
  if (!(await ensureToken())) return null;
  const r = await req(`/storage/v1/object/sign/${BUCKET}/${path}`, { method: "POST", body: { expiresIn: seconds } });
  return r.ok && r.data?.signedURL ? SUPABASE_URL + "/storage/v1" + r.data.signedURL : null;
}
export async function patchCloud(id, fields) { if (!(await ensureToken())) return false; const r = await req(`${T}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: fields, headers: { Prefer: "return=minimal" } }); return r.ok; }
export const userPath = (sessId, file) => `${auth?.id}/${sessId}/${file}`;
