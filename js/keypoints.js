// 공통 관절 스키마 (파이썬 swimlens/pose/keypoints.py 와 동일)
export const JOINTS = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right",
  "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "left_pinky", "right_pinky", "left_index", "right_index", "left_thumb", "right_thumb",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
  "left_heel", "right_heel", "left_foot_index", "right_foot_index",
];
export const KO_NAMES = {
  nose: "코", left_eye: "왼눈", right_eye: "오른눈", left_ear: "왼귀", right_ear: "오른귀",
  left_shoulder: "왼어깨", right_shoulder: "오른어깨", left_elbow: "왼팔꿈치", right_elbow: "오른팔꿈치",
  left_wrist: "왼손목", right_wrist: "오른손목", left_hip: "왼골반", right_hip: "오른골반",
  left_knee: "왼무릎", right_knee: "오른무릎", left_ankle: "왼발목", right_ankle: "오른발목",
  left_heel: "왼뒤꿈치", right_heel: "오른뒤꿈치", left_foot_index: "왼발끝", right_foot_index: "오른발끝",
};
export const SKELETON = [
  ["left_shoulder", "right_shoulder"], ["left_hip", "right_hip"],
  ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"],
  ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["left_ankle", "left_heel"], ["left_ankle", "left_foot_index"],
  ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["right_ankle", "right_heel"], ["right_ankle", "right_foot_index"],
  ["nose", "left_ear"], ["nose", "right_ear"],
];
export const EDITABLE_JOINTS = ["left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_knee", "right_knee",
  "left_ankle", "right_ankle", "left_shoulder", "right_shoulder", "left_hip", "right_hip", "nose"];
export const CORE_JOINTS = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];

/** 랜드마크 묶음: 관절별 x, y(픽셀), v(visibility) 배열 */
export class Landmarks {
  constructor(n, fps, width, height) {
    this.n = n; this.fps = fps; this.width = width; this.height = height;
    this.frame = new Int32Array(n); this.t_ms = new Float64Array(n);
    this.data = {};
    for (const j of JOINTS) this.data[j] = { x: new Float64Array(n).fill(NaN), y: new Float64Array(n).fill(NaN), v: new Float64Array(n) };
  }
  get t() { const o = new Float64Array(this.n); for (let i = 0; i < this.n; i++) o[i] = this.t_ms[i] / 1000; return o; }
  x(j) { return this.data[j].x; } y(j) { return this.data[j].y; } v(j) { return this.data[j].v; }
  set(i, j, x, y, v) { const d = this.data[j]; d.x[i] = x; d.y[i] = y; d.v[i] = v; }
  xy(j, i) { return [this.data[j].x[i], this.data[j].y[i]]; }
  row(i) { const r = { frame: this.frame[i], t_ms: this.t_ms[i] }; for (const j of JOINTS) { r[j + "_x"] = this.data[j].x[i]; r[j + "_y"] = this.data[j].y[i]; r[j + "_v"] = this.data[j].v[i]; } return r; }
  clone() { const o = new Landmarks(this.n, this.fps, this.width, this.height); o.frame.set(this.frame); o.t_ms.set(this.t_ms); for (const j of JOINTS) { o.data[j].x.set(this.data[j].x); o.data[j].y.set(this.data[j].y); o.data[j].v.set(this.data[j].v); } return o; }
  indexOfFrame(f) { const i = this.frame.indexOf(f); return i >= 0 ? i : Math.max(0, Math.min(this.n - 1, f)); }
  toCSV() {
    const cols = ["frame", "t_ms"]; for (const j of JOINTS) cols.push(j + "_x", j + "_y", j + "_v");
    const lines = [cols.join(",")];
    for (let i = 0; i < this.n; i++) { const r = [this.frame[i], this.t_ms[i].toFixed(3)]; for (const j of JOINTS) { const d = this.data[j]; r.push(Number.isNaN(d.x[i]) ? "" : d.x[i].toFixed(3), Number.isNaN(d.y[i]) ? "" : d.y[i].toFixed(3), d.v[i].toFixed(3)); } lines.push(r.join(",")); }
    return lines.join("\n");
  }
  static fromCSV(text, fps, width, height) {
    const lines = text.trim().split(/\r?\n/); const head = lines[0].split(","); const n = lines.length - 1;
    const lm = new Landmarks(n, fps, width, height); const idx = {}; head.forEach((h, k) => idx[h] = k);
    for (let i = 0; i < n; i++) {
      const c = lines[i + 1].split(","); lm.frame[i] = +c[idx.frame]; lm.t_ms[i] = +c[idx.t_ms];
      for (const j of JOINTS) { const x = c[idx[j + "_x"]], y = c[idx[j + "_y"]], v = c[idx[j + "_v"]]; lm.set(i, j, x === "" || x === undefined ? NaN : +x, y === "" || y === undefined ? NaN : +y, v === "" || v === undefined ? 0 : +v); }
    }
    return lm;
  }
  toJSON() { const d = {}; for (const j of JOINTS) d[j] = { x: Array.from(this.data[j].x), y: Array.from(this.data[j].y), v: Array.from(this.data[j].v) }; return { n: this.n, fps: this.fps, width: this.width, height: this.height, frame: Array.from(this.frame), t_ms: Array.from(this.t_ms), data: d }; }
  static fromJSON(o) { const lm = new Landmarks(o.n, o.fps, o.width, o.height); lm.frame.set(o.frame); lm.t_ms.set(o.t_ms); for (const j of JOINTS) { lm.data[j].x.set(o.data[j].x.map(v => v === null ? NaN : v)); lm.data[j].y.set(o.data[j].y.map(v => v === null ? NaN : v)); lm.data[j].v.set(o.data[j].v); } return lm; }
}
