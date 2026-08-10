import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, DatePicker, Input, Modal, Select, Space, Tag, Tooltip, message } from 'antd'
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  LineOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SettingOutlined,
  TagOutlined
} from '@ant-design/icons'
import {
  aiComplete,
  buildChatMessages,
  buildTidyMessages,
  compareTidy,
  getAiConfig,
  stripFences
} from '../ai'
import { adviceKey, generateAdvice } from '../adviceWorker'
import type { ChatEntry } from '../types'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import dayjs from 'dayjs'
import { DEFAULT_TOKENS, type Item, type TabData } from '../types'
import {
  closeDetail,
  saveOpenItem,
  updateOpenItem,
  updateTabTags,
  useAppStore
} from '../store'
import { api } from '../api'
import MarkdownEditor, { MarkdownEditorHandle } from './MarkdownEditor'
import { statusLabel } from './ListView'

const SAVE_STATE_LABEL = { saved: '저장됨', dirty: '수정됨 ●', saving: '저장 중…' } as const

/** 탭 태그 목록 편집 모달 — 쉼표 구분 입력, setting.json에 저장 */
function TagManageModal({
  tab,
  open,
  onClose
}: {
  tab: TabData
  open: boolean
  onClose: () => void
}): React.ReactNode {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (open) setValue(tab.setting.tags.join(', '))
  }, [open, tab.setting.tags])

  const save = async (): Promise<void> => {
    const tags = [...new Set(value.split(',').map((t) => t.trim()).filter(Boolean))]
    await updateTabTags(tab.dir, tags)
    onClose()
  }

  return (
    <Modal
      title="태그 관리"
      open={open}
      onCancel={onClose}
      onOk={() => void save()}
      okText="저장"
      cancelText="취소"
    >
      <p className="setup-hint">
        쉼표(,)로 구분해 입력하세요. 목록에서 지운 태그도 이미 붙어 있는 문서에서는 사라지지
        않습니다.
      </p>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="테스트완료, v2반영"
        onPressEnter={() => void save()}
      />
    </Modal>
  )
}

export default function DetailView({ tab, item }: { tab: TabData; item: Item }): React.ReactNode {
  const saveState = useAppStore((s) => s.saveState)
  const autosaveMinutes = useAppStore((s) => s.settings.autosave_minutes)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const [tagModalOpen, setTagModalOpen] = useState(false)
  // 에디터는 마운트 시 1회만 본문을 읽으므로, 외부(AI 정리)에서 본문을 바꾸면 리마운트가 필요하다
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [tidy, setTidy] = useState<{
    open: boolean
    loading: boolean
    original: string
    result: string
    error?: string
  }>({ open: false, loading: false, original: '', result: '' })
  const isTodo = tab.setting.type === 'todo'
  const tokens = tab.setting.tokens.length ? tab.setting.tokens : [...DEFAULT_TOKENS]

  // 탭에 설정된 태그 + (설정에서 지워졌어도) 이 문서에 이미 붙어 있는 태그의 합집합
  const itemTags = item.tags ?? []
  const visibleTags = useMemo(
    () => [...tab.setting.tags, ...itemTags.filter((t) => !tab.setting.tags.includes(t))],
    [tab.setting.tags, itemTags]
  )

  const toggleTag = (tag: string): void => {
    updateOpenItem({
      tags: itemTags.includes(tag) ? itemTags.filter((t) => t !== tag) : [...itemTags, tag]
    })
  }

  // ---- 첨부파일 (본문이 아닌 frontmatter의 attachments 배열로 관리) ----
  const attachments = item.attachments ?? []

  const addAttachments = (paths: string[]): void => {
    const next = [...attachments]
    for (const p of paths) if (p && !next.includes(p)) next.push(p)
    if (next.length !== attachments.length) updateOpenItem({ attachments: next })
  }
  // Tauri 드롭 이벤트 콜백이 항상 최신 상태를 보도록 ref로 전달
  const addAttachmentsRef = useRef(addAttachments)
  addAttachmentsRef.current = addAttachments

  const openAttachment = (path: string): void => {
    void api.openFile(path).then((r) => {
      if (!r.ok) message.error(`파일 열기 실패: ${r.error}`)
    })
  }

  // 탐색기에서 창에 파일을 끌어놓으면 첨부 목록에 추가.
  // Tauri는 웹 표준 drop 이벤트 대신 자체 드래그드롭 이벤트로 경로를 전달한다
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') addAttachmentsRef.current(event.payload.paths)
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [])

  // ---- AI 자동 정리: 미리보기로 보여주고 사용자가 적용을 눌러야만 반영 ----
  const runTidy = async (): Promise<void> => {
    if (!getAiConfig()) {
      message.warning('설정(톱니바퀴)에서 AI API 주소와 모델을 먼저 입력하세요')
      return
    }
    const original = editorRef.current?.getMarkdown() ?? item.body
    if (!original.trim()) {
      message.info('정리할 내용이 없습니다')
      return
    }
    setTidy({ open: true, loading: true, original, result: '' })
    try {
      const result = stripFences(await aiComplete(buildTidyMessages(original)))
      setTidy((t) => ({ ...t, loading: false, result }))
    } catch (e) {
      setTidy((t) => ({ ...t, loading: false, error: String(e instanceof Error ? e.message : e) }))
    }
  }

  const applyTidy = (): void => {
    updateOpenItem({ body: tidy.result })
    setEditorEpoch((n) => n + 1)
    setTidy({ open: false, loading: false, original: '', result: '' })
    message.success('정리 결과를 적용했습니다. 저장 전 원본은 백업에 남습니다.')
  }

  const tidyChecks = tidy.result ? compareTidy(tidy.original, tidy.result, tokens) : []
  const tidyMismatch = tidyChecks.some((c) => c.before !== c.after)

  // ---- 하단 AI 도움말 패널 (백그라운드 워커가 생성, 여기서는 표시 + 수동 재생성) ----
  const advice = useAppStore((s) => s.advice[adviceKey(tab.dir, item.id)])
  const adviceBusy = useAppStore((s) => s.adviceBusy)
  const thisAdviceBusy = adviceBusy === adviceKey(tab.dir, item.id)
  const aiConfigured = getAiConfig() !== null
  const adviceEnabled = useAppStore((s) => s.settings.ai?.advice_enabled !== false)

  const regenerateAdvice = async (): Promise<void> => {
    if (saveState !== 'saved') await saveOpenItem()
    try {
      await generateAdvice(tab, item)
    } catch (e) {
      message.error(`도움말 생성 실패: ${String(e instanceof Error ? e.message : e)}`)
    }
  }

  // ---- 이어서 질문 (채팅) — 대화는 .ai/chat/ 사이드카에 저장, 본문과 분리 ----
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setChat([])
    setChatInput('')
    void api.loadChat(tab.dir, item.id).then((entries) => {
      if (!cancelled) setChat(entries)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const sendChat = async (): Promise<void> => {
    const question = chatInput.trim()
    if (!question || chatBusy) return
    const now = dayjs().format('YYYY-MM-DDTHH:mm:ss')
    const withQuestion: ChatEntry[] = [...chat, { role: 'user', content: question, at: now }]
    setChat(withQuestion)
    setChatInput('')
    setChatBusy(true)
    try {
      const answer = await aiComplete(buildChatMessages(tab, item, advice?.advice, chat, question))
      const full: ChatEntry[] = [
        ...withQuestion,
        { role: 'assistant', content: answer.trim(), at: dayjs().format('YYYY-MM-DDTHH:mm:ss') }
      ]
      setChat(full)
      await api.saveChat(tab.dir, item.id, full)
    } catch (e) {
      message.error(`질문 실패: ${String(e instanceof Error ? e.message : e)}`)
      setChat(chat) // 실패한 질문은 되돌림 (입력창에 복원)
      setChatInput(question)
    } finally {
      setChatBusy(false)
    }
  }

  const clearChat = async (): Promise<void> => {
    setChat([])
    await api.saveChat(tab.dir, item.id, [])
  }

  // 자동저장: 마지막 수정 후 N분 무입력이면 저장
  useEffect(() => {
    if (saveState !== 'dirty') return
    timerRef.current = setTimeout(
      () => void saveOpenItem(),
      Math.max(autosaveMinutes, 0.1) * 60_000
    )
    return () => clearTimeout(timerRef.current)
  }, [saveState, item.updated_at, autosaveMinutes])

  // Ctrl+S 수동 저장, Esc로 리스트 복귀(복귀 시 미저장분 저장)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveOpenItem()
      } else if (e.key === 'Escape') {
        void closeDetail()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 언마운트(다른 항목/탭 이동) 시 미저장분 저장
  useEffect(() => () => void saveOpenItem(), [])

  const dateValue = (s?: string): dayjs.Dayjs | null => (s ? dayjs(s) : null)

  return (
    <div className="detail-view">
      <div className="detail-header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => void closeDetail()}>
          목록
        </Button>
        <span className={`save-state save-state-${saveState}`}>{SAVE_STATE_LABEL[saveState]}</span>
        <Button size="small" onClick={() => void saveOpenItem()} disabled={saveState === 'saved'}>
          저장 (Ctrl+S)
        </Button>
      </div>

      <Input
        className="detail-title"
        variant="borderless"
        placeholder="제목"
        autoFocus={!item.title}
        value={item.title}
        onChange={(e) => updateOpenItem({ title: e.target.value })}
      />

      <Space wrap className="detail-fields" size="middle">
        {isTodo && (
          <>
            <Select
              size="small"
              value={item.status}
              popupMatchSelectWidth={false}
              onChange={(v) => updateOpenItem({ status: v })}
              options={tab.setting.statuses.map((s) => ({ value: s, label: statusLabel(s) }))}
              prefix={<span className="field-label">상태</span>}
            />
            <Select
              size="small"
              value={item.priority}
              popupMatchSelectWidth={false}
              onChange={(v) => updateOpenItem({ priority: v })}
              options={[
                { value: 'high', label: '높음' },
                { value: 'medium', label: '보통' },
                { value: 'low', label: '낮음' }
              ]}
              prefix={<span className="field-label">우선순위</span>}
            />
            <span className="field-group">
              <span className="field-label">계획일</span>
              <DatePicker
                size="small"
                value={dateValue(item.plan_date)}
                onChange={(d) =>
                  updateOpenItem({ plan_date: d ? d.format('YYYY-MM-DD') : undefined })
                }
              />
            </span>
            <span className="field-group">
              <span className="field-label">마감일</span>
              <DatePicker
                size="small"
                value={dateValue(item.due_date)}
                onChange={(d) =>
                  updateOpenItem({ due_date: d ? d.format('YYYY-MM-DD') : undefined })
                }
              />
            </span>
          </>
        )}
      </Space>

      <div className="editor-toolbar">
        <Tooltip title="체크박스">
          <Button
            type="text"
            size="small"
            icon={<CheckSquareOutlined />}
            onClick={() => editorRef.current?.insertMarkdown('- [ ] ')}
          />
        </Tooltip>
        <Tooltip title="오늘 날짜">
          <Button
            type="text"
            size="small"
            icon={<CalendarOutlined />}
            onClick={() => editorRef.current?.insertText(`(${dayjs().format('M월 D일')}) `)}
          />
        </Tooltip>
        <Tooltip title="구분선">
          <Button
            type="text"
            size="small"
            icon={<LineOutlined />}
            onClick={() => editorRef.current?.insertMarkdown('\n---\n')}
          />
        </Tooltip>
        <Tooltip title="파일 첨부 (탐색기에서 창으로 드래그해도 됨)">
          <Button
            type="text"
            size="small"
            icon={<PaperClipOutlined />}
            onClick={() =>
              void api.pickFile().then((p) => {
                if (p) addAttachments([p])
              })
            }
          />
        </Tooltip>
        <Tooltip title={`상태 토큰 삽입 — 본문에서 클릭하면 ${tokens.join(' → ')} 순환`}>
          <Button
            type="text"
            size="small"
            icon={<TagOutlined />}
            onClick={() => editorRef.current?.insertText(`[${tokens[0]}] `)}
          />
        </Tooltip>
        <Tooltip title="AI 자동 정리 — 미리보기를 확인한 뒤 적용됩니다">
          <Button
            type="text"
            size="small"
            icon={<RobotOutlined />}
            loading={tidy.open && tidy.loading}
            onClick={() => void runTidy()}
          />
        </Tooltip>
        <span className="toolbar-sep" />
        <span className="tag-row">
          {visibleTags.map((tag) => (
            <Tag.CheckableTag
              key={tag}
              checked={itemTags.includes(tag)}
              onChange={() => toggleTag(tag)}
            >
              {tag}
            </Tag.CheckableTag>
          ))}
          <Tooltip title="태그 관리">
            <Button
              type="text"
              size="small"
              className="tag-gear"
              icon={<SettingOutlined />}
              onClick={() => setTagModalOpen(true)}
            />
          </Tooltip>
        </span>
      </div>

      {attachments.length > 0 && (
        <div className="attachment-row">
          <PaperClipOutlined className="attachment-icon" />
          {attachments.map((p) => (
            <Tooltip key={p} title={p}>
              <Tag
                className="attachment-chip"
                closable
                onClick={() => openAttachment(p)}
                onClose={(e) => {
                  e.preventDefault()
                  updateOpenItem({ attachments: attachments.filter((x) => x !== p) })
                }}
              >
                {p.split(/[\\/]/).pop() ?? p}
              </Tag>
            </Tooltip>
          ))}
        </div>
      )}

      <MarkdownEditor
        key={`${item.id}:${editorEpoch}`}
        ref={editorRef}
        defaultValue={item.body}
        tokens={tokens}
        onChange={(md) => updateOpenItem({ body: md })}
      />

      {aiConfigured && adviceEnabled && (advice || thisAdviceBusy) && (
        <div className="advice-panel">
          <div className="advice-header">
            <RobotOutlined className="advice-icon" />
            <span className="advice-title">AI 도움말</span>
            {advice && <span className="advice-time">{advice.created_at.replace('T', ' ')}</span>}
            <Button
              type="text"
              size="small"
              loading={thisAdviceBusy}
              disabled={adviceBusy !== null && !thisAdviceBusy}
              onClick={() => void regenerateAdvice()}
            >
              다시 생성
            </Button>
          </div>
          {advice && <div className="advice-body">{advice.advice}</div>}
          {!advice && thisAdviceBusy && <div className="advice-body">생성 중입니다…</div>}
        </div>
      )}
      {aiConfigured && adviceEnabled && !advice && !thisAdviceBusy && (
        <div className="advice-empty">
          <Button
            type="text"
            size="small"
            icon={<RobotOutlined />}
            onClick={() => void regenerateAdvice()}
          >
            AI 도움말 생성
          </Button>
        </div>
      )}

      {aiConfigured && (
        <div className="chat-panel">
          {chat.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`chat-msg chat-${m.role}`}>
              <div className="chat-content">{m.content}</div>
              {m.role === 'assistant' && (
                <Button
                  type="text"
                  size="small"
                  className="chat-insert"
                  onClick={() => editorRef.current?.insertMarkdown(`\n${m.content}\n`)}
                >
                  본문에 삽입
                </Button>
              )}
            </div>
          ))}
          {chatBusy && (
            <div className="chat-msg chat-assistant">
              <div className="chat-content">답변 작성 중…</div>
            </div>
          )}
          <div className="chat-input-row">
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="이 항목에 대해 이어서 질문하기… (Enter 전송, Shift+Enter 줄바꿈)"
              onPressEnter={(e) => {
                if (e.shiftKey) return
                e.preventDefault()
                void sendChat()
              }}
              disabled={chatBusy}
            />
            <Button
              type="primary"
              loading={chatBusy}
              disabled={!chatInput.trim()}
              onClick={() => void sendChat()}
            >
              질문
            </Button>
            {chat.length > 0 && (
              <Tooltip title="대화 지우기">
                <Button onClick={() => void clearChat()}>지우기</Button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      <TagManageModal tab={tab} open={tagModalOpen} onClose={() => setTagModalOpen(false)} />

      <Modal
        title="AI 자동 정리 — 미리보기"
        open={tidy.open}
        width={900}
        onCancel={() => setTidy({ open: false, loading: false, original: '', result: '' })}
        footer={[
          <Button
            key="cancel"
            onClick={() => setTidy({ open: false, loading: false, original: '', result: '' })}
          >
            취소
          </Button>,
          <Button
            key="apply"
            type="primary"
            disabled={tidy.loading || !tidy.result}
            onClick={applyTidy}
          >
            적용
          </Button>
        ]}
      >
        {tidy.loading && <p className="setup-hint">정리 중입니다…</p>}
        {tidy.error && <Alert type="error" message={`정리 실패: ${tidy.error}`} showIcon />}
        {tidy.result && (
          <>
            {tidyMismatch && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                message="체크박스/상태 토큰 개수가 원본과 다릅니다. 내용이 빠졌을 수 있으니 확인 후 적용하세요."
                description={tidyChecks
                  .filter((c) => c.before !== c.after)
                  .map((c) => `${c.label}: ${c.before}개 → ${c.after}개`)
                  .join(', ')}
              />
            )}
            <div className="tidy-compare">
              <div>
                <div className="tidy-pane-title">원본</div>
                <pre className="tidy-pane">{tidy.original}</pre>
              </div>
              <div>
                <div className="tidy-pane-title">정리안</div>
                <pre className="tidy-pane">{tidy.result}</pre>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
