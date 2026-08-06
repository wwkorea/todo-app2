import type { AiSettings } from './types'
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
