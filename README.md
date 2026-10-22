# AI 리뷰 봇

GitHub App Webhook으로 Pull Request를 받아 diff를 읽고, 품질·보안·성능 에이전트가 찾은 내용을 PR 리뷰 댓글로 남기는 Node.js 서버입니다. 코드를 수정하거나 명령을 실행하지 않습니다.

## 요구 사항

- Node.js 22.5 이상
- GitHub App
- OpenAI 호환 Chat Completions API 키

## 설치와 실행

```bash
npm ci
npm run dev
```

`.env.example`을 `.env`로 복사한 뒤 값을 채웁니다. 서버는 시작 시 `.env`를 읽고, 이미 프로세스에 있는 환경변수는 바꾸지 않습니다.

운영 빌드:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t ai-review-bot .
docker run --env-file .env -p 3000:3000 -v ai-review-data:/app/data ai-review-bot
```

컨테이너 안의 `/app/data/review-bot.sqlite`에 딜리버리, 게시 기록, 대기 작업을 남깁니다. 볼륨을 빼면 컨테이너를 지울 때 그 기록도 사라집니다.

상태 확인은 `GET /health`입니다. 브라우저에서 `http://localhost:3000`을 엽니다. Pull Request 주소 전체나 `owner/repo#번호`를 넣으면 리뷰가 시작되고, 댓글은 GitHub Pull Request에 달립니다. 화면에는 저장소별 최신 상태, 심각도 개수, 지적 제목, 댓글 링크가 보입니다. 댓글 언어는 한국어 또는 영어로 고를 수 있고, 그 요청의 GitHub 댓글에만 적용됩니다. Webhook으로 시작된 리뷰는 한국어입니다. 최근 카드의 다시 리뷰를 누르면 같은 주소가 입력란에 채워지고, 이전에 넣었던 주소와 언어는 그 브라우저 탭을 닫기 전까지 남아 있습니다. 이 포트에 닿는 사람은 리뷰를 요청할 수 있으므로 공개 인터넷에 포트를 열지 마세요. Webhook 경로는 `POST /webhooks/github`입니다.

## GitHub App

앱 이름은 GitHub 전체에서 고유해야 합니다. 사용자 OAuth와 Device Flow는 끄고, Webhook은 켭니다.

로컬 서버는 GitHub가 직접 호출할 수 없습니다. smee.io 같은 공개 주소를 `https://example.ngrok.io/webhooks/github` 형태로 Webhook URL에 넣고, 그 트래픽을 `http://localhost:3000/webhooks/github`로 전달합니다.

Webhook Secret은 `.env`의 `GITHUB_WEBHOOK_SECRET`과 같아야 합니다. 생성 후 설정 페이지의 App ID는 `GITHUB_APP_ID`, 내려받은 PEM private key는 `GITHUB_APP_PRIVATE_KEY`입니다. 화면에 보이는 SHA256 지문이 아니라 PEM 본문이어야 합니다. PEM의 줄바꿈은 `\n` 두 글자로 넣어도 서버가 실제 줄바꿈으로 바꿉니다.

저장소 권한은 Metadata 읽기, Contents 읽기, Pull requests 읽기·쓰기만 켭니다. 구독 이벤트는 Pull request만 켭니다. 설치 토큰은 그보다 좁습니다. diff를 읽을 때는 `metadata: read`, `contents: read`, `pull_requests: read`를, 댓글을 쓸 때는 `metadata: read`, `pull_requests: write`를 대상 저장소에만 요청합니다.

## 환경변수

값은 `.env.example`에 있습니다. 서버는 시작 시 알려진 키만 읽고, 필수 값이 없으면 종료합니다. 오류 문장에는 환경변수 값을 넣지 않습니다.

| 키 | 설명 |
| --- | --- |
| `NODE_ENV` | `development`, `test`, `production` |
| `PORT` | 수신 포트. 기본 3000 |
| `LOG_LEVEL` | pino 로그 수준 |
| `SERVICE_NAME` | 로그에 남기는 서비스 이름 |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC 비밀 |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App PEM private key |
| `GITHUB_API_BASE_URL` | GitHub API origin. 기본 `https://api.github.com` |
| `GITHUB_REQUEST_TIMEOUT_MS` | GitHub 호출 제한 시간. 기본 10000 |
| `REVIEW_MAX_FILES` | 리뷰할 파일 수. 기본 20 |
| `REVIEW_MAX_FILE_BYTES` | 파일 크기 상한. 기본 204800 |
| `REVIEW_MAX_DIFF_BYTES` | 파일당 diff 상한. 기본 20480 |
| `REVIEW_MAX_INLINE_COMMENTS` | 인라인 코멘트 상한. 기본 10 |
| `REVIEW_STATE_PATH` | 재시작 뒤에도 남는 SQLite 파일. 기본 `data/review-bot.sqlite`. `memory`는 프로세스 메모리만 사용 |
| `LLM_API_KEY` | LLM API 키. 비어 있으면 에이전트 호출이 실패합니다 |
| `LLM_BASE_URL` | OpenAI 호환 origin. 기본 `https://api.openai.com` |
| `LLM_MODEL` | 모델 이름. 기본 `gpt-4o-mini` |
| `LLM_REQUEST_TIMEOUT_MS` | LLM 호출 제한 시간. 기본 60000 |
| `LLM_MAX_INPUT_CHARS` | 에이전트 한 호출에 넣는 diff 문자 수. 기본 48000 |

`GITHUB_LIVE_REVIEW=1`은 실제 저장소에 댓글을 남기는 수동 테스트용입니다. 기본 `npm test`에서는 실행되지 않습니다. 켤 때는 `GITHUB_LIVE_INSTALLATION_ID`, `GITHUB_LIVE_OWNER`, `GITHUB_LIVE_REPO`, `GITHUB_LIVE_PULL`, `GITHUB_LIVE_HEAD_SHA`도 필요합니다.

## 아키텍처

```text
GitHub Webhook
  -> 서명 검증과 스키마 검증
  -> 202 응답
  -> SQLite 작업 큐
  -> Pull Request diff 조회
  -> 품질, 보안, 성능 에이전트
  -> 결정적 통합
  -> Pull Request 리뷰 게시
```

Webhook은 서명, 스키마, 중복 확인, 큐 등록만 하고 `202`를 반환합니다. LLM 분석은 응답 이후에 실행됩니다. 서명 검증은 재직렬화한 JSON이 아니라 수신한 원문 바이트로 합니다.

같은 딜리버리, 성공한 커밋의 게시 키, 아직 끝나지 않은 작업은 SQLite 파일에 남습니다. 프로세스가 다시 시작되면 대기 작업과 중간에 끊긴 작업을 이어 실행하고, 이미 끝난 작업과 이미 게시한 커밋은 다시 처리하지 않습니다. 이 파일은 서버 하나에서만 엽니다.

에이전트는 `LlmProvider`만 호출합니다. 기본 구현은 OpenAI 호환 `POST /v1/chat/completions`입니다. 모델 출력은 Zod를 통과한 필드만 사용하고, diff에 없는 경로·줄·근거는 버립니다. 같은 파일에서 줄이 겹치고 요지가 같으면 더 높은 심각도 하나로 합칩니다.

리뷰 본문은 서버가 Markdown으로 조립합니다. 인라인 코멘트는 새 파일 쪽 diff에 있는 줄이고 심각도가 중간 이상일 때만 붙입니다. GitHub가 인라인을 `422`로 거부하면 요약 리뷰만 다시 게시합니다. 지적이 없어도 해당 커밋에 짧은 요약을 한 건 남깁니다. 세 에이전트가 모두 실패하면 댓글을 만들지 않습니다.

작업이 끝날 때 처리 시간, 프롬프트·완성 토큰, 누적 처리 건수와 실패율을 구조화 로그로 남깁니다. 비밀, diff 본문, 모델 원문은 로그에 넣지 않습니다.

## 테스트

```bash
npm run typecheck
npm test
npm run build
```

GitHub와 LLM은 가짜 구현으로 검증합니다. CI도 같은 명령을 실행하며 실제 API를 호출하지 않습니다.
