// 파이썬 버전과 같은 랜드마크를 넣었을 때 같은 수치가 나오는지 확인
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Landmarks } from "../js/keypoints.js";
import { analyze } from "../js/pipeline.js";
import { peaks } from "../js/signal/events.js";
import { savgol } from "../js/signal/clean.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require(path.join(here, "../vendor/jsyaml/js-yaml.min.js"));
const cfgDir = path.join(here, "../config");
const configs = { thresholds: yaml.load(fs.readFileSync(path.join(cfgDir, "thresholds.yaml"), "utf8")), matrix: yaml.load(fs.readFileSync(path.join(cfgDir, "matrix.yaml"), "utf8")), comments: yaml.load(fs.readFileSync(path.join(cfgDir, "comments.yaml"), "utf8")) };
const demoDir = path.join(here, "../../../output/swimlens/20261103_합성데모_자유형");

function loadDemo(dir = demoDir) {
  const sess = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
  const py = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8"));
  const v = sess.video; const raw = Landmarks.fromCSV(fs.readFileSync(path.join(dir, "landmarks.csv"), "utf8"), v.fps, v.width, v.height);
  return { sess, py, raw };
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: js=${a} py=${b}`);

test("savgol 은 scipy 와 같은 값 (2차, 창 9)", () => {
  const x = Array.from({ length: 30 }, (_, i) => Math.sin(i / 3) + (i % 3) * 0.1);
  const y = savgol(Float64Array.from(x), 9, 2);
  // scipy 로 미리 계산한 값 (파이썬에서 생성)
  const ref = JSON.parse(fs.readFileSync(path.join(here, "fixtures/savgol_ref.json"), "utf8"));
  ref.forEach((v, i) => close(y[i], v, 1e-6, "savgol[" + i + "]"));
});

test("find_peaks 와 같은 피크", () => {
  const t = Array.from({ length: 120 }, (_, i) => i / 30); const x = Float64Array.from(t.map(v => Math.sin(2 * Math.PI * v)));
  const pk = peaks(x, 30, 0.5, 0.3, true); assert.equal(pk.length, 4); for (let i = 1; i < pk.length; i++) assert.ok(Math.abs(pk[i] - pk[i - 1] - 30) <= 1);
});

function checkParity(sess, py, raw) {
  const { results, cycles } = analyze({ lm: raw, settings: sess.settings, configs, cameraMotion: sess.camera_motion });
  assert.equal(cycles.n_cycles, py.cycles.n_cycles, "사이클 수");
  cycles.cycles.forEach((c, i) => { assert.equal(c.start, py.cycles.cycles[i].start); assert.equal(c.end, py.cycles.cycles[i].end); });
  for (const k of Object.keys(py.metrics)) {
    const a = results[k], b = py.metrics[k];
    assert.equal(a.status, b.status, k + " status"); assert.equal(a.traffic, b.traffic, k + " traffic");
    if (b.status === "unmeasured") continue;
    close(a.confidence, b.confidence, 1.0, k + " confidence");
    for (const [sk, sv] of Object.entries(b.summary)) if (typeof sv === "number") { assert.ok(typeof a.summary[sk] === "number", `${k}.${sk} missing in js`); close(a.summary[sk], sv, Math.max(0.05, Math.abs(sv) * 0.01), `${k}.${sk}`); }
    const ea = a.events.map(e => [e.id, e.frame]), eb = b.events.map(e => [e.id, e.frame]); assert.deepEqual(ea, eb, k + " events");
    assert.equal(a.comment, b.comment, k + " comment");
  }
}
test("합성 자유형(브레이크아웃·호흡) 데모: 파이썬 결과와 일치", () => { const { sess, py, raw } = loadDemo(); checkParity(sess, py, raw); });
test("합성 접영: 파이썬 결과와 일치", () => { const { sess, py, raw } = loadDemo(path.join(here, "fixtures/butterfly")); checkParity(sess, py, raw); });
test("합성 정면(롤링): 파이썬 결과와 일치", () => { const { sess, py, raw } = loadDemo(path.join(here, "fixtures/front")); checkParity(sess, py, raw); });

test("검수 수정(기점 이동·코멘트) 반영", () => {
  const { sess, py, raw } = loadDemo();
  const ev = py.metrics.catch_angle.events[0];
  const { results } = analyze({ lm: raw, settings: sess.settings, configs, review: { events: { catch_angle: { [ev.id]: ev.frame + 3 } }, comments: { catch_angle: "코치 수정" } } });
  assert.equal(results.catch_angle.events[0].frame, ev.frame + 3); assert.equal(results.catch_angle.events[0].edited, true); assert.equal(results.catch_angle.comment, "코치 수정");
});
