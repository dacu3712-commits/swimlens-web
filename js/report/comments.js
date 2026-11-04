// 코치 코멘트 초안 (파이썬 report/comments.py)
function fmt(t, kw) { return String(t || "").replace(/\{(\w+)(?::([^}]+))?\}/g, (m, k, spec) => { const v = kw[k]; if (v === undefined || v === null) return m; if (typeof v === "number" && spec) { const mm = spec.match(/^([+])?\.(\d)f$/); if (mm) { const s = v.toFixed(+mm[2]); return mm[1] === "+" && v >= 0 ? "+" + s : s; } } return String(v); }); }
export function draft(r, C) {
  const rules = C[r.key] || {}, s = r.summary || {};
  if (r.status === "unmeasured") return fmt(C.general.unmeasured, { reason: r.reason });
  let text = ""; const k = r.key;
  if (k === "catch_angle" && s.mean !== null && s.mean !== undefined) { const [lo, hi] = s.green_range || [90, 110]; text = fmt(rules[r.traffic] || rules.yellow, { mean: s.mean, lo, hi, direction: s.mean < lo ? rules.direction_low : rules.direction_high }); }
  else if (k === "split_time") { const rm = s.ratio_mean || {}; text = fmt(rules.default, { catch_pct: (rm["캐치"] || 0) + (rm["글라이드"] || 0), pull_pct: rm["풀"] || 0, finish_pct: rm["피니시"] || 0, recovery_pct: rm["리커버리"] || 0, cycle_sec: s.cycle_sec_mean || 0 }); if (r.traffic === "yellow" && s.max_diff_phase) text += " " + fmt(rules.yellow, { diff_pct: s.left_right_diff_pct[s.max_diff_phase] }); }
  else if (k === "rolling") text = fmt(rules[r.traffic] || rules.green, { left: s.left_max_mean || 0, right: s.right_max_mean || 0, side: s.worse_side || "", value: s.worse_value || 0, lo: (s.green_range || [0, 0])[0], hi: (s.green_range || [0, 0])[1], asym: s.asymmetry || 0 });
  else if (k === "hand_path") { text = fmt(rules.default, { depth_str: s.depth_str || "-", inward_str: s.inward_str || "-" }); if (s.crossover) text += " " + (rules.crossover || ""); }
  else if (k === "knee_hip_kick") { const [lo, hi] = s.knee_green || [110, 140]; text = fmt(rules[r.traffic in rules ? r.traffic : "green"], { knee: s.knee_mean || 0, lo, hi }); if (s.timing_enabled) for (const [tag, label] of [["entry", "입수킥"], ["exit", "출수킥"]]) { const d = s[tag + "_kick_diff_ms_mean"]; if (d === null || d === undefined) continue; text += " " + (Math.abs(d) <= 100 ? fmt(rules.timing_match, { label, diff_ms: d }) : fmt(rules.timing_off, { label, abs_ms: Math.abs(d), direction: d > 0 ? rules.direction_late : rules.direction_early })); } }
  else if (k === "breathing_speed") text = fmt(rules[r.traffic] || rules.green, { slowdown: s.slowdown_pct || 0 });
  else if (k === "breakout") { const kk = { "일치": "match", "손이 늦음": "hand_late", "머리가 먼저 나옴": "head_early" }[s.judgement] || "match"; text = fmt(rules[kk], { underwater_sec: s.underwater_sec || 0, kicks: s.kick_count || 0, diff_ms: s.diff_ms || 0, abs_ms: Math.abs(s.diff_ms || 0) }); }
  else if (k === "streamline") text = fmt(rules[r.traffic] || rules.green, { angle: s.sink_angle_mean || 0 });
  if (r.needs_review) text += " " + fmt(C.general.low_confidence, { confidence: r.confidence });
  return text.trim();
}
export function draftAll(results, C, edited = {}) { for (const [k, r] of Object.entries(results)) { r.comment = edited[k] || draft(r, C); r.drills = r.status !== "unmeasured" && (r.traffic === "yellow" || r.traffic === "red") ? [...(C[k]?.drills || [])] : []; } }
