// IndexedDB: 분석 세션 저장 (설정·랜드마크·검수·지표·영상 blob)
const DB = "swimlens", STORE = "sessions";
function open() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(mode, fn) { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => { db.close(); res(out && out.result !== undefined ? out.result : out); }; t.onerror = () => { db.close(); rej(t.error); }; }); }
export const saveSession = (sess) => tx("readwrite", s => s.put(sess));
export const getSession = (id) => tx("readonly", s => s.get(id));
export const deleteSession = (id) => tx("readwrite", s => s.delete(id));
export async function listSessions() { const all = await tx("readonly", s => s.getAll()); return (all || []).map(({ id, kind, name, created, settings, videoInfo, hasMetrics, partial }) => ({ id, kind: kind || "video", name, created, settings, videoInfo, hasMetrics, hasPartial: !!partial })).sort((a, b) => b.created - a.created); }
export function newId(name) { const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; return `${ymd}_${(name || "수강생").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 20)}_${d.getHours()}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`; }
