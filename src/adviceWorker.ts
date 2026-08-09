import dayjs from 'dayjs'
import type { Item, TabData } from './types'
import { AiMessage, aiComplete, getAiConfig } from './ai'
import { useAppStore } from './store'
import { api } from './api'

const TICK_MS = 5 * 60_000
const FIRST_TICK_MS = 30_000
/** 이 시간 안에 수정된 항목은 아직 작성 중일 수 있으니 건너뜀 */
const RECENT_EDIT_MS = 2 * 60_000
const MIN_CONTENT_LENGTH = 10

/** 내용 변경 감지용 해시 (djb2) — 같은 내용에 중복 조언하지 않기 위한 기준 */
export function hashContent(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}

const ADVICE_SYSTEM_PROMPT = `당신은 개발자의 업무 todo/메모를 검토하는 사내 조수입니다. 항목을 읽고 실질적으로 도움이 되는 조언을 한국어로 짧게 작성하세요.

다음 중 실제로 해당하는 것만 다루세요: 빠뜨린 것·리스크, 추천하는 다음 액션, 마감·우선순위 관련 조언, 더 명확히 적어두면 좋을 부분.
형식: 불릿(-) 2~4개, 각 한 문장. 인사말·과장·칭찬 없이 본론만. 항목 내용만으로 알 수 없는 것을 지어내지 마세요. 조언할 것이 마땅치 않으면 "특이사항 없음" 한 줄만 쓰세요.`

function buildAdviceMessages(tab: TabData, item: Item): AiMessage[] {
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
  return [
    { role: 'system', content: ADVICE_SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') }
  ]
}

export function adviceKey(tabDir: string, itemId: string): string {
  return `${tabDir}/${itemId}`
}

/** 항목 하나에 대해 도움말 생성 (수동 재생성 버튼과 워커가 공용) */
export async function generateAdvice(tab: TabData, item: Item): Promise<void> {
  const key = adviceKey(tab.dir, item.id)
  const s = useAppStore.getState()
  if (s.adviceBusy) return
  useAppStore.setState({ adviceBusy: key })
  try {
    const advice = (await aiComplete(buildAdviceMessages(tab, item))).trim()
    const record = {
      hash: hashContent(`${item.title}\n${item.body}`),
      advice,
      created_at: dayjs().format('YYYY-MM-DDTHH:mm:ss')
    }
    useAppStore.setState((st) => ({ advice: { ...st.advice, [key]: record } }))
    await api.saveAdvice(tab.dir, item.id, record)
  } finally {
    useAppStore.setState({ adviceBusy: null })
  }
}

/** 도움말이 필요한 항목 하나 선정: 내용이 바뀌었고, 지금 편집 중이 아니고, 방금 수정한 것도 아닌 것 */
function pickCandidate(): { tab: TabData; item: Item } | null {
  const s = useAppStore.getState()
  const now = Date.now()
  for (const tab of s.tabs) {
    for (const item of tab.items) {
      const content = `${item.title}\n${item.body}`
      if (content.trim().length < MIN_CONTENT_LENGTH) continue
      if (item.id === s.openItemId) continue
      const updated = dayjs(item.updated_at).valueOf()
      if (Number.isFinite(updated) && now - updated < RECENT_EDIT_MS) continue
      const rec = s.advice[adviceKey(tab.dir, item.id)]
      if (rec?.hash === hashContent(content)) continue
      return { tab, item }
    }
  }
  return null
}

async function tick(): Promise<void> {
  const s = useAppStore.getState()
  if (!s.ready || s.needSetup || s.adviceBusy) return
  if (s.settings.ai?.advice_enabled === false) return // 기본 ON
  if (!getAiConfig()) return
  const candidate = pickCandidate()
  if (!candidate) return
  try {
    await generateAdvice(candidate.tab, candidate.item)
  } catch (e) {
    // 백그라운드 작업이므로 조용히 로그만 — 다음 사이클에 재시도됨
    console.error('advice generation failed', e)
  }
}

let started = false

/** 앱 시작 시 1회 호출 — 30초 후 첫 사이클, 이후 5분 간격 */
export function startAdviceWorker(): void {
  if (started) return
  started = true
  setTimeout(() => void tick(), FIRST_TICK_MS)
  setInterval(() => void tick(), TICK_MS)
}
