import type { AiSettings, ChatEntry, Item, TabData } from './types'
import { useAppStore } from './store'
import { api } from './api'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 설정에서 AI 구성을 읽어 유효하면 반환, 아니면 null */
export function getAiConfig(): AiSettings | null {
  const ai = useAppStore.getState().settings.ai
  if (!ai?.base_url?.trim() || !ai.model?.trim()) return null
  return ai
}

export async function aiComplete(messages: AiMessage[]): Promise<string> {
  const cfg = getAiConfig()
  if (!cfg) throw new Error('설정에서 AI API 주소와 모델을 먼저 입력하세요')
  const r = await api.aiComplete({ base_url: cfg.base_url, model: cfg.model }, messages)
  if (!r.ok || !r.content) throw new Error(r.error ?? '알 수 없는 오류')
  return r.content
}

const TIDY_SYSTEM_PROMPT = `당신은 업무 todo/메모 문서를 정리하는 도우미입니다. 사용자가 급하게 대충 적은 마크다운 문서를 읽기 좋게 정리합니다.

규칙 (반드시 지킬 것):
1. 정보를 추가·삭제·창작하지 마세요. 원문의 모든 내용(숫자, 날짜, 이름, 경로 포함)이 정리 후에도 남아 있어야 합니다.
2. 허용되는 작업: 오타·띄어쓰기 교정, 어색한 문장 다듬기, 관련 내용끼리 묶기, 목록화(-), 소제목(##)·구분선(---) 추가, 중복 표현 정리.
3. 체크박스 문법(\`- [ ]\`, \`- [x]\`)은 개수와 체크 상태를 그대로 보존하세요.
4. [미처리] [진행중] [완료] [보류] [취소] [협의중] 같은 대괄호 상태 토큰은 개수와 내용을 그대로 보존하세요.
5. 결과는 정리된 마크다운 본문만 출력하세요. 설명, 인사말, 코드펜스(\`\`\`)로 감싸기 금지.`

export function buildTidyMessages(body: string): AiMessage[] {
  return [
    { role: 'system', content: TIDY_SYSTEM_PROMPT },
    { role: 'user', content: body }
  ]
}

/** LLM이 코드펜스로 감싸서 답한 경우 벗겨낸다 */
export function stripFences(text: string): string {
  const m = /^\s*```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text)
  return (m ? m[1] : text).trim()
}

const CHAT_SYSTEM_PROMPT = `당신은 개발자의 업무 todo/메모에 대해 대화하는 사내 조수입니다. 아래에 주어지는 항목 정보를 참고해 사용자의 질문에 한국어로 간결하고 실용적으로 답하세요. 항목 내용만으로 알 수 없는 것은 아는 척하지 말고 모른다고 하세요. 마크다운을 써도 됩니다.`

function itemContext(tab: TabData, item: Item): string {
  const lines = [
    `[탭] ${tab.setting.name} (${tab.setting.type})`,
    `[제목] ${item.title || '(제목 없음)'}`
  ]
  if (item.status) lines.push(`[상태] ${item.status}`)
  if (item.priority) lines.push(`[우선순위] ${item.priority}`)
  if (item.due_date) lines.push(`[마감일] ${item.due_date}`)
  if (item.plan_date) lines.push(`[계획일] ${item.plan_date}`)
  if (item.tags?.length) lines.push(`[태그] ${item.tags.join(', ')}`)
  lines.push('', '[본문]', item.body)
  return lines.join('\n')
}

/** 항목 컨텍스트 + 기존 도움말 + 대화 이력 + 새 질문 → LLM 메시지 배열 */
export function buildChatMessages(
  tab: TabData,
  item: Item,
  advice: string | undefined,
  history: ChatEntry[],
  question: string
): AiMessage[] {
  const messages: AiMessage[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    { role: 'user', content: `다음은 대화의 대상이 되는 항목입니다.\n\n${itemContext(tab, item)}` }
  ]
  if (advice) {
    messages.push({ role: 'assistant', content: `(제가 이 항목에 남긴 도움말)\n${advice}` })
  }
  for (const h of history) messages.push({ role: h.role, content: h.content })
  messages.push({ role: 'user', content: question })
  return messages
}

export interface TidyCheck {
  label: string
  before: number
  after: number
}

/** 정리 전후 체크박스/상태 토큰 개수 비교 — 달라졌으면 사용자에게 경고할 근거 */
export function compareTidy(before: string, after: string, tokens: string[]): TidyCheck[] {
  const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length
  const checks: TidyCheck[] = [
    {
      label: '체크박스',
      before: count(before, /- \[[ xX]\]/g),
      after: count(after, /- \[[ xX]\]/g)
    }
  ]
  for (const t of tokens) {
    const re = new RegExp(`\\[${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'g')
    checks.push({ label: `[${t}]`, before: count(before, re), after: count(after, re) })
  }
  return checks.filter((c) => c.before > 0 || c.after > 0)
}
