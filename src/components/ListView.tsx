import { useMemo } from 'react'
import { Button, Empty, Popconfirm, Select, Tag, Tooltip } from 'antd'
import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import dayjs from 'dayjs'
import type { Item, TabData } from '../types'
import { deleteItemAction, newItem, openItem, updateItemInline } from '../store'

const STATUS_COLORS: Record<string, string> = {
  todo: 'default',
  'in-progress': 'processing',
  done: 'success',
  hold: 'warning'
}

const STATUS_LABELS: Record<string, string> = {
  todo: '대기',
  'in-progress': '진행중',
  done: '완료',
  hold: '보류'
}

const PRIORITY_META: Record<string, { color: string; label: string }> = {
  high: { color: 'red', label: '높음' },
  medium: { color: 'gold', label: '보통' },
  low: { color: 'default', label: '낮음' }
}

export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s
}

function DueDate({ date }: { date?: string }): React.ReactNode {
  if (!date) return <span className="col-date cell-empty">-</span>
  const diff = dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day')
  const cls = diff < 0 ? 'due-overdue' : diff <= 3 ? 'due-soon' : ''
  return (
    <Tooltip title={diff < 0 ? `${-diff}일 지남` : `D-${diff}`}>
      <span className={`col-date ${cls}`}>{dayjs(date).format('M/D')}</span>
    </Tooltip>
  )
}

function Row({ tab, item }: { tab: TabData; item: Item }): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  })
  const isTodo = tab.setting.type === 'todo'
  const done = item.status === 'done'

  return (
    <div
      ref={setNodeRef}
      className={`row ${isDragging ? 'row-dragging' : ''} ${done ? 'row-done' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="row-handle" {...attributes} {...listeners}>
        <HolderOutlined />
      </span>
      {isTodo && (
        <Select
          size="small"
          variant="borderless"
          value={item.status}
          popupMatchSelectWidth={false}
          onChange={(v) => void updateItemInline(tab.dir, item.id, { status: v })}
          options={tab.setting.statuses.map((s) => ({
            value: s,
            label: <Tag color={STATUS_COLORS[s] ?? 'default'}>{statusLabel(s)}</Tag>
          }))}
          className="col-status"
        />
      )}
      <span className="row-title" onClick={() => openItem(tab.dir, item.id)}>
        <span className="row-title-text">
          {item.title || <span className="cell-empty">(제목 없음)</span>}
        </span>
        {(item.tags?.length ?? 0) > 0 && (
          <span className="row-tags">
            {item.tags!.map((t) => (
              <Tag key={t} className="row-tag">
                {t}
              </Tag>
            ))}
          </span>
        )}
      </span>
      {isTodo && (
        <>
          <Select
            size="small"
            variant="borderless"
            value={item.priority}
            popupMatchSelectWidth={false}
            onChange={(v) => void updateItemInline(tab.dir, item.id, { priority: v })}
            options={Object.entries(PRIORITY_META).map(([value, m]) => ({
              value,
              label: <Tag color={m.color}>{m.label}</Tag>
            }))}
            className="col-priority"
          />
          <DueDate date={item.plan_date} />
          <DueDate date={item.due_date} />
        </>
      )}
      {!isTodo && (
        <span className="col-updated">
          {dayjs(item.updated_at).isValid() ? dayjs(item.updated_at).format('M/D HH:mm') : ''}
        </span>
      )}
      <Popconfirm
        title="이 항목을 삭제할까요?"
        description="삭제 전 백업이 남습니다."
        onConfirm={() => void deleteItemAction(tab.dir, item.id)}
        okText="삭제"
        cancelText="취소"
      >
        <Button type="text" size="small" icon={<DeleteOutlined />} className="row-delete" />
      </Popconfirm>
    </div>
  )
}

/** 드래그 컨텍스트는 App(MainBody)에서 탭과 공유 — 여기서는 SortableContext만 구성 */
export default function ListView({ tab }: { tab: TabData }): React.ReactNode {
  const ids = useMemo(() => tab.items.map((i) => i.id), [tab.items])

  return (
    <div className="list-view">
      <Button
        type="text"
        icon={<PlusOutlined />}
        className="new-button"
        onClick={() => void newItem(tab.dir)}
      >
        New
      </Button>
      {tab.items.length === 0 ? (
        <Empty description="항목이 없습니다" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          {tab.setting.type === 'todo' && (
            <div className="list-header">
              <span className="row-handle header-spacer" />
              <span className="col-status">상태</span>
              <span className="row-title">제목</span>
              <span className="col-priority">우선순위</span>
              <span className="col-date">계획</span>
              <span className="col-date">마감</span>
              <span className="col-del" />
            </div>
          )}
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {tab.items.map((item) => (
              <Row key={item.id} tab={tab} item={item} />
            ))}
          </SortableContext>
        </>
      )}
    </div>
  )
}
