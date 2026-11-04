# 🏊 SwimLens Web — 설치 없이 브라우저에서 돌아가는 수영 영상 분석

`projects/swimlens`(파이썬 버전)와 **같은 8가지 지표·같은 판정 기준**을 브라우저 안에서 계산하는 정적 웹사이트입니다.
서버가 없습니다. 영상은 어디로도 전송되지 않고, 자세 추정(MediaPipe Pose, WebAssembly)·지표 계산·PDF 생성이 전부 기기 안에서 이루어집니다.
수영 게임(`swim-master-web`)처럼 **GitHub Pages 에 올려 폰 브라우저로 접속**하면 됩니다.

## 사용법

1. 사이트를 열고 ① 설정에서 영상을 올립니다 (mp4/mov, 20~40초 클립 권장).
2. 영법·구도·방향·카메라를 고르고, 첫 프레임에서 **수면선 2점**(가능하면 **거리 기준 2점 + 실제 m**)을 누릅니다.
3. 🚀 분석 시작 → 자세 추정(기기 성능에 따라 영상 길이의 1~5배 시간) → 8개 지표 신호등.
4. ③ 검수에서 기점 프레임 ◀ ▶ 이동, ✎ 관절 위치 수정, 코멘트 편집 → 바로 재계산.
5. ④ 리포트에서 TOP3·드릴 입력 후 **PDF 다운로드**. landmarks.csv / metrics.json / 오버레이 영상(webm)도 받을 수 있습니다.
6. 결과는 이 기기 브라우저(IndexedDB)에 저장되며 📂 버튼으로 다시 엽니다. 브라우저 데이터를 지우면 사라지니 PDF 는 꼭 내려받으세요.

### 영상이 안 열릴 때
- 아이폰 기본 촬영은 HEVC(H.265)라서 안드로이드/PC Chrome 에서 재생이 안 될 수 있습니다. **아이폰 Safari 로 접속**하거나, 카메라 설정 → 포맷 → "호환성 우선"으로 촬영하세요.
- 긴 영상은 폰 갤러리에서 20~40초로 잘라 올리면 분석이 빠릅니다.

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `styles.css`, `js/main.js` | 화면(설정·분석·검수·리포트) |
| `js/pose.js`, `js/video.js`, `js/camera.js` | MediaPipe 자세 추정, 프레임 읽기, 카메라 이동 감지 |
| `js/signal/*`, `js/metrics/*` | 파이썬 버전을 그대로 옮긴 신호 처리·8지표 (Node 테스트로 수치 일치 확인) |
| `js/report/pdf.js` | pdf-lib 한글 PDF |
| `config/*.yaml` | 판정 기준·코멘트·구도표 — **파이썬 버전과 동일 파일**, 여기서 고치면 바로 반영 |
| `vendor/` | MediaPipe wasm·모델(lite/full/heavy), Chart.js, pdf-lib, js-yaml, Noto Sans KR 서브셋 (CDN 없이 자체 포함) |
| `tests/parity.test.mjs` | 파이썬 결과(metrics.json)와 JS 결과 비교 테스트: `node --test tests/parity.test.mjs` |

## 로컬에서 띄우기 (개발·확인용)

```
cd projects/swimlens-web
python3 -m http.server 8090
# 브라우저에서 http://localhost:8090
```
`file://` 로 열면 모듈·wasm 이 막히므로 꼭 http 서버로 여세요.

## GitHub Pages 배포

`DEPLOY.md` 참고. 요약: 공개 저장소에 이 폴더 내용을 올리고 Settings → Pages 에서 브랜치 배포를 켜면 `https://<계정>.github.io/<저장소>/` 로 접속됩니다.
