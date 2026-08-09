export type TabType = 'todo' | 'memo'
export type Priority = 'high' | 'medium' | 'low'

export interface ItemMeta {
  id: string
  title: string
  status?: string
  priority?: Priority
  due_date?: string
  plan_date?: string
  tags?: string[]
  /** 첨부파일 절대 경로 목록 — 본문이 아닌 메타데이터로 관리 */
  attachments?: string[]
  created_at: string
  updated_at: string
  done_at?: string
}

export interface Item extends ItemMeta {
  body: string
}

export interface TabSetting {
  name: string
  type: TabType
  statuses: string[]
  default_status?: string
  /** 본문 에디터에서 쓰는 인라인 상태 토큰 (순서대로 클릭 순환) */
  tokens: string[]
  /** 이 탭에서 쓰는 태그 목록 (항목에 붙였다 뗐다 하는 토글 태그) */
  tags: string[]
  /** 수동 정렬 순서 (item id 배열) — 드래그 결과는 여기에만 저장 */
  order: string[]
  sort: 'manual' | 'due_date' | 'priority' | 'updated'
}

export interface TabData {
  /** 데이터 디렉토리 기준 폴더명 (= 탭 식별자) */
  dir: string
  setting: TabSetting
  items: Item[]
}

/**
 * 사내 LLM API 설정 (OpenAI 호환 chat/completions 형식 가정).
 * API 키는 여기(데이터 폴더 settings.json)에 두지 않는다 —
 * Windows 자격 증명 관리자에 저장 (백업/공유 시 유출 방지, Rust keyring).
 */
export interface AiSettings {
  /** 예: http://llm.company.local/v1 — 끝에 /chat/completions 는 앱이 붙임 */
  base_url: string
  model: string
  /** (2일차 예정) 주기적 도움말 on/off — 자동 정리 버튼과는 무관 */
  advice_enabled?: boolean
}

export interface GlobalSettings {
  schema_version: number
  tab_order: string[]
  autosave_minutes: number
  backup_keep: number
  last_tab?: string
  theme?: 'light' | 'dark'
  ai?: AiSettings
}

export interface AppData {
  dataDir: string
  settings: GlobalSettings
  tabs: TabData[]
}

/**
 * 항목별 AI 도움말 — 데이터 폴더 `.ai/advice/<탭>/<id>.json` 사이드카로 저장.
 * 본문(md)에 섞지 않는 이유: 원본 오염 방지 + 추후 RAG 임베딩 시 AI 글 제외.
 */
export interface AdviceRecord {
  /** 생성 당시 본문+제목 해시 — 내용이 바뀌면 해시가 달라져 재생성 대상이 됨 */
  hash: string
  advice: string
  created_at: string
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  schema_version: 1,
  tab_order: [],
  autosave_minutes: 3,
  backup_keep: 5
}

export const DEFAULT_TOKENS = ['미처리', '진행중', '완료', '보류', '취소', '협의중']
export const DEFAULT_TAGS = ['테스트완료', 'v2반영']

export function defaultTabSetting(name: string, type: TabType): TabSetting {
  return {
    name,
    type,
    statuses: type === 'todo' ? ['todo', 'in-progress', 'done', 'hold'] : [],
    default_status: type === 'todo' ? 'todo' : undefined,
    tokens: [...DEFAULT_TOKENS],
    tags: type === 'todo' ? [...DEFAULT_TAGS] : [],
    order: [],
    sort: 'manual'
  }
}
