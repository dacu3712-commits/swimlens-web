const ORDER = { red: 0, yellow: 1, info: 2, green: 3, na: 4 };
export function autoTop3(metrics) {
  const c = Object.values(metrics).filter(r => r.status !== "unmeasured" && (r.traffic === "red" || r.traffic === "yellow")).sort((a, b) => (ORDER[a.traffic] - ORDER[b.traffic]) || (b.confidence - a.confidence));
  const out = c.slice(0, 3).map(r => ({ title: r.name, detail: (r.comment || "").split(". ")[0].slice(0, 80) }));
  while (out.length < 3) out.push({ title: "", detail: "" }); return out;
}
