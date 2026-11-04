# SwimLens Web 배포 (수영 게임과 같은 방식: GitHub Pages)

## 방법 A — 새 저장소 (권장, 깔끔)
1. GitHub 에서 **새 공개(Public) 저장소** `swimlens-web` 만들기 (README 없이 빈 저장소).
2. 이 폴더(`projects/swimlens-web`)의 내용을 그 저장소의 `main` 브랜치에 올립니다.
   - Claude 세션에서: "swimlens-web 저장소에 배포해 줘" 라고 하면 제가 밀어넣습니다 (저장소를 세션에 추가해 주셔야 합니다).
3. 저장소 Settings → Pages → Build and deployment: **Deploy from a branch**, Branch `main` / `(root)` → Save.
4. 1~2분 뒤 `https://dacu3712-commits.github.io/swimlens-web/` 로 접속. 폰 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.

## 방법 B — 기존 수영 게임 저장소의 하위 폴더
`swim-master-web` 저장소에 `swimlens/` 폴더로 넣으면 `https://dacu3712-commits.github.io/swim-master-web/swimlens/` 로 열립니다.
게임의 서비스 워커가 루트 범위를 쓰지만, SwimLens 는 자기 폴더 범위의 서비스 워커를 따로 등록하므로 서로 간섭하지 않습니다.

## 업데이트
코드를 고친 뒤 같은 저장소에 다시 올리면 됩니다. 서비스 워커가 앱 파일은 네트워크 우선으로 받으므로 새로고침 한 번이면 새 버전이 뜹니다. (큰 파일인 모델·wasm 은 캐시에 남아 재다운로드하지 않습니다.)

## 저장소 크기
`vendor/` 가 약 70MB(모델 3종 46MB + wasm 19MB)입니다. GitHub 한 파일 100MB 제한 안이라 그대로 올려도 됩니다. 용량을 줄이려면 `vendor/models/pose_landmarker_heavy.task`(30MB)를 빼고 설정에서 Heavy 를 쓰지 않으면 됩니다.

## Supabase 연결 (수영 게임 SWIM MASTER 와 같은 서버·같은 계정)

로그인하면 분석 결과가 **서버(Supabase)에도 저장**되어 폰·PC 어디서든 같은 결과를 열 수 있고, 브라우저 데이터를 지워도 남습니다.
1. Supabase 대시보드(게임에 쓰는 프로젝트) → **SQL Editor** → `supabase/schema.sql` 내용을 붙여 넣고 Run (한 번만). 표 `swimlens_sessions` 와 비공개 버킷 `swimlens` 가 만들어집니다. 게임 표는 건드리지 않습니다.
2. 사이트 📂 메뉴에서 **게임과 같은 이메일/비밀번호로 로그인**. (Authentication → Email 로그인이 이미 켜져 있어야 하며, 게임이 쓰고 있으므로 보통 켜져 있습니다.)
3. 이후 분석이 끝나거나 검수를 고칠 때마다 자동으로 서버에 저장되고, PDF 를 만들면 PDF 도 올라갑니다. "영상도 서버에 보관" 을 켜면 영상(용량 큼)까지 올라가 다른 기기에서 캡처·관절 수정까지 할 수 있습니다.
- 저장 위치: 표 `public.swimlens_sessions`(본인 행만 읽기/쓰기, RLS), 스토리지 `swimlens/<내 user id>/<세션 id>/report.pdf, source.mp4`.
- 무료 플랜 용량(DB 500MB, 스토리지 1GB)을 넘기지 않으려면 영상 보관은 필요한 것만 켜세요.
- 나중에 다른 사람에게 열 때: 각자 가입(게임과 같은 가입 흐름)하면 자기 결과만 보게 이미 설정되어 있습니다.

## ✨ 코멘트 다듬기 설정 (한 번만, 약 5분)

코치가 먼저 쓴 코멘트를 Claude 가 코치 말투로 다듬어 "제안"으로 보여 주는 기능입니다. API 키는 Supabase 서버에만 두고 웹사이트에는 넣지 않습니다.

1. **Claude API 키 만들기**: https://platform.claude.com → API Keys → Create Key → 복사 (결제 수단 등록 필요, 코멘트 1회 약 10~30원).
2. **Supabase 대시보드 → Edge Functions → Deploy a new function → Via Editor**
   - 함수 이름: `swimlens-polish`
   - 내용: 저장소의 `supabase/functions/swimlens-polish/index.ts` 전체를 붙여 넣고 **Deploy**.
3. **Edge Functions → Secrets (또는 Project Settings → Edge Functions)** 에서 추가:
   - `ANTHROPIC_API_KEY` = 1번 키
   - `ALLOWED_EMAILS` = `dacu3712@gmail.com` (쉼표로 여러 명. 비우면 로그인한 누구나 쓸 수 있으니 꼭 넣으세요)
4. 사이트 📂 메뉴에서 로그인 → 검수 화면 코멘트 아래 **✨ 다듬기** → 제안을 보고 **적용** 또는 **버리기**.
- 말투는 `config/coach_style.md` 를 고치면 바로 반영됩니다 (시그니처 큐, 문장 길이 등).
- 다듬기는 코치 초안의 내용과 수치를 바꾸지 않도록 지시되어 있고, 측정값과 다른 숫자가 있으면 ⚠ 로 알려 줍니다.
