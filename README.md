# rag-todo-app (Tauri)

노션 스타일 로컬 마크다운 todo/memo 데스크톱 앱 — Electron 버전(`../rag-todo-app`)의 **Tauri v2 이식판**.
기능·데이터 포맷·백업 구조는 동일하고, 실행파일 크기가 300MB급 → 수 MB급으로 줄어든다.

## 사전 준비 (최초 1회)

Tauri는 Rust로 컴파일되므로 아래가 필요하다.

1. **Visual Studio Build Tools** (C++ 데스크톱 개발 워크로드, MSVC + Windows SDK)
2. **Rust (rustup)**

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

```bash
winget install --id Rustlang.Rustup
```

설치 후 **새 터미널**에서 `cargo --version`이 나오면 준비 완료.

## 실행 / 빌드

```bash
npm install
npm run tauri dev      # 개발 모드 (첫 컴파일은 몇 분 걸림, 이후는 빠름)
npm run tauri build    # 배포 빌드 → src-tauri/target/release/bundle/nsis/ 에 설치 exe
npm run typecheck      # 프론트엔드 타입 검사
```

## Electron 버전과의 차이

|                    | Electron                                | Tauri (이 프로젝트)                                  |
| ------------------ | --------------------------------------- | ---------------------------------------------------- |
| 파일 IO/백업       | main 프로세스(Node) `src/main/store.ts` | 웹뷰에서 `@tauri-apps/plugin-fs` 호출 (`src/api.ts`) |
| frontmatter        | gray-matter (Node Buffer 의존)          | js-yaml 직접 파싱 (`src/frontmatter.ts`)             |
| 설정 파일 위치     | `%APPDATA%/rag-todo-app/config.json`    | Tauri appConfigDir의 `config.json`                   |
| 트레이/창닫기 숨김 | main 프로세스                           | `src/desktop.ts` (Tauri tray/window API)             |
| 파일 접근 권한     | 무제한                                  | `src-tauri/capabilities/default.json`에 선언         |

렌더러(React + antd + Milkdown + dnd-kit)와 데이터 포맷(md + frontmatter, setting.json, backup/backup_days)은 100% 동일 — **기존 데이터 폴더를 그대로 지정하면 이어서 쓸 수 있다.**

참고: Windows의 Rust `rename`은 대상 파일이 있으면 실패하므로, atomic write가 "백업 → 원본 삭제 → rename" 순서로 동작한다 (`src/api.ts`의 `atomicWrite` 주석 참고).
