import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Input, Modal, Select, Space, Tag, Tooltip } from 'antd'
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  LineOutlined,
  SettingOutlined,
  TagOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { DEFAULT_TOKENS, type Item, type TabData } from '../types'
import {
  closeDetail,
  saveOpenItem,
  updateOpenItem,
  updateTabTags,
  useAppStore
} from '../store'
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
        <Tooltip title={`상태 토큰 삽입 — 본문에서 클릭하면 ${tokens.join(' → ')} 순환`}>
          <Button
            type="text"
            size="small"
            icon={<TagOutlined />}
            onClick={() => editorRef.current?.insertText(`[${tokens[0]}] `)}
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

      <MarkdownEditor
        key={item.id}
        ref={editorRef}
        defaultValue={item.body}
        tokens={tokens}
        onChange={(md) => updateOpenItem({ body: md })}
      />

      <TagManageModal tab={tab} open={tagModalOpen} onClose={() => setTagModalOpen(false)} />
    </div>
  )
}
