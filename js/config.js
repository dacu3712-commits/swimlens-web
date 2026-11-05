// config/*.yaml 로드 (js-yaml 전역)
const _cache = {};
export async function loadConfigs(base = "./config") {
  if (_cache.v) return _cache.v;
  const get = async (n) => window.jsyaml.load(await (await fetch(`${base}/${n}?v=${Date.now()}`)).text());
  const [thresholds, matrix, comments] = await Promise.all([get("thresholds.yaml"), get("matrix.yaml"), get("comments.yaml")]);
  return (_cache.v = { thresholds, matrix, comments });
}
export const STROKES = { freestyle: "자유형", butterfly: "접영", backstroke: "배영", breaststroke: "평영" };
export const VIEWS = { side_under: "측면-수중", side_above: "측면-수상", front: "정면", back: "후면", bottom: "바닥(수중 아래)" };
export const DIRECTIONS = { ltr: "왼쪽 → 오른쪽", rtl: "오른쪽 → 왼쪽" };
export const CAMERA_SIDES = { left: "왼팔이 카메라 쪽", right: "오른팔이 카메라 쪽" };
export const CAMERA_MODES = { fixed: "고정 삼각대", moving: "따라가며 촬영" };
