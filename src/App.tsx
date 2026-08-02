import React, { useEffect, useMemo } from 'react'
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Spin,
  Tabs,
  theme as antdTheme
} from 'antd'
import koKR from 'antd/locale/ko_KR'
import { SearchOutlined, SettingOutlined } from '@ant-design/icons'
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Item, TabData } from './types'
import {
  getOpenItem,
  init,
  moveItemToTab,
  openItem,
  reorderItems,
  reorderTabs,
  saveOpenItem,
  setActiveTab,
  setQuery,
  setSettingsOpen,
  useAppStore
} from './store'
import ListView from './components/ListView'
import DetailView from './components/DetailView'
import SettingsModal from './components/SettingsModal'

/**
 * v1 검색: 제목+본문 부분일치 (전체 탭 대상).
 * 2차에서 RAG 시맨틱 검색으로 교체할 수 있도록 이 함수만 갈아끼우면 되는 구조를 유지한다.
 */
function searchItems(tabs: TabData[], query: string): { tab: TabData; item: Item }[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const results: { tab: TabData; item: Item }[] = []
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (item.title.toLowerCase().includes(q) || item.body.toLowerCase().includes(q)) {
        results.push({ tab, item })
      }
    }
  }
  return results
}

function SearchResults({ tabs, query }: { tabs: TabData[]; query: string }): React.ReactNode {
  const results = useMemo(() => searchItems(tabs, query), [tabs, query])
  if (results.length === 0)
    return <Empty description="검색 결과가 없습니다" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  return (
    <div className="search-results">
      {results.map(({ tab, item }) => (
        <div
          key={`${tab.dir}/${item.id}`}
          className="search-row"
          onClick={() => openItem(tab.dir, item.id)}
        >
          <span className="search-tab">{tab.setting.name}</span>
          <span className="search-title">{item.title || '(제목 없음)'}</span>
          <span className="search-snippet">{item.body.slice(0, 80)}</span>
        </div>
      ))}
    </div>
  )
}

/** 탭 라벨을 드래그 가능 + 드롭 대상(행을 떨어뜨리면 그 탭으로 이동)으로 감싸는 노드 */
function DraggableTabNode(props: React.HTMLAttributes<HTMLDivElement> & { 'data-node-key': string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isOver, active } = useSortable({
    id: props['data-node-key']
  })
  const child = props.children as React.ReactElement<Record<string, unknown>>
  const itemDragOver = isOver && active != null && String(active.id) !== props['data-node-key']
  return React.cloneElement(child, {
    ref: setNodeRef,
    style: { ...props.style, transform: CSS.Translate.toString(transform), transition },
    className: `${(child.props.className as string) ?? ''} ${itemDragOver ? 'tab-drop-target' : ''}`,
    ...attributes,
    ...listeners
  })
}

function DraggableTabs({ tabs, activeKey }: { tabs: TabData[]; activeKey?: string }) {
  const dirs = tabs.map((t) => t.dir)
  return (
    <Tabs
      activeKey={activeKey}
      onChange={setActiveTab}
      items={tabs.map((t) => ({ key: t.dir, label: `${t.setting.name} (${t.items.length})` }))}
      className="app-tabs"
      renderTabBar={(tabBarProps, DefaultTabBar) => (
        <SortableContext items={dirs} strategy={horizontalListSortingStrategy}>
          <DefaultTabBar {...tabBarProps}>
            {(node) => (
              <DraggableTabNode {...node.props} key={node.key} data-node-key={String(node.key)}>
                {node}
              </DraggableTabNode>
            )}
          </DefaultTabBar>
        </SortableContext>
      )}
    />
  )
}

function Main(): React.ReactNode {
  const ready = useAppStore((s) => s.ready)
  const needSetup = useAppStore((s) => s.needSetup)
  const tabs = useAppStore((s) => s.tabs)
  const activeTab = useAppStore((s) => s.activeTab)
  const openItemId = useAppStore((s) => s.openItemId)
  const openTabDir = useAppStore((s) => s.openTabDir)
  const query = useAppStore((s) => s.query)

  useEffect(() => {
    void init()
  }, [])

  // 앱 종료/새로고침 시 미저장분 저장 시도
  useEffect(() => {
    const onUnload = (): void => void saveOpenItem()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  if (!ready) {
    return (
      <div className="center-screen">
        <Spin size="large" />
      </div>
    )
  }

  const opened = openTabDir && openItemId ? getOpenItem() : null
  const currentTab = tabs.find((t) => t.dir === activeTab)

  return <MainBody {...{ needSetup, tabs, activeTab, query, opened, currentTab }} />
}

function MainBody({
  needSetup,
  tabs,
  activeTab,
  query,
  opened,
  currentTab
}: {
  needSetup: boolean
  tabs: TabData[]
  activeTab: string | null
  query: string
  opened: { tab: TabData; item: Item } | null
  currentTab?: TabData
}): React.ReactNode {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const { modal } = AntApp.useApp()

  // 넓은 행 vs 작은 탭 라벨 조합에서는 중심점 거리(closestCenter)가 탭을 못 잡으므로
  // 포인터가 실제로 올라가 있는 대상을 우선 사용한다
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args)
    return hits.length > 0 ? hits : closestCenter(args)
  }

  // 탭 정렬 / 행 정렬 / 행→탭 이동을 한 컨텍스트에서 처리
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over) return
    const a = String(active.id)
    const o = String(over.id)
    if (a === o) return
    const tabDirs = tabs.map((t) => t.dir)

    if (tabDirs.includes(a)) {
      // 탭을 끌었다 → 탭 순서 변경
      if (tabDirs.includes(o)) {
        void reorderTabs(arrayMove(tabDirs, tabDirs.indexOf(a), tabDirs.indexOf(o)))
      }
      return
    }

    if (!currentTab) return
    if (tabDirs.includes(o)) {
      // 행을 탭 라벨에 떨어뜨렸다 → 확인 후 그 탭으로 이동 (맨 위 배치)
      if (o === currentTab.dir) return
      const item = currentTab.items.find((i) => i.id === a)
      const target = tabs.find((t) => t.dir === o)
      if (!item || !target) return
      const crossType = currentTab.setting.type !== target.setting.type
      modal.confirm({
        title: '항목 이동',
        content: `'${item.title || '(제목 없음)'}' 항목을 '${target.setting.name}' 탭으로 이동할까요?${
          crossType ? ' 탭 유형이 달라 호환되지 않는 필드(상태·우선순위·날짜 등)는 제거됩니다.' : ''
        }`,
        okText: '이동',
        cancelText: '취소',
        onOk: () => moveItemToTab(currentTab.dir, a, o)
      })
      return
    }
    // 행을 행 위에 떨어뜨렸다 → 리스트 내 순서 변경
    const ids = currentTab.items.map((i) => i.id)
    if (ids.includes(o) && ids.includes(a)) {
      void reorderItems(currentTab.dir, arrayMove(ids, ids.indexOf(a), ids.indexOf(o)))
    }
  }

  return (
    <div className="app">
      {!needSetup && (
        <>
          <div className="app-header">
            <Input
              className="search-input"
              prefix={<SearchOutlined />}
              placeholder="검색 (전체 탭, 제목+본문)"
              allowClear
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              aria-label="설정"
            />
          </div>

          {opened ? (
            <DetailView tab={opened.tab} item={opened.item} />
          ) : query.trim() ? (
            <SearchResults tabs={tabs} query={query} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
              <DraggableTabs tabs={tabs} activeKey={activeTab ?? undefined} />
              {currentTab && <ListView tab={currentTab} />}
            </DndContext>
          )}
        </>
      )}
      <SettingsModal firstRun={needSetup} />
    </div>
  )
}

export default function App(): React.ReactNode {
  const themeMode = useAppStore((s) => s.settings.theme ?? 'light')
  const dark = themeMode === 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  return (
    <ConfigProvider
      locale={koKR}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#2f6fed',
          borderRadius: 6,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
          ...(dark ? {} : { colorText: '#37352f' })
        },
        components: {
          Segmented: {
            itemSelectedBg: '#2f6fed',
            itemSelectedColor: '#ffffff'
          }
        }
      }}
    >
      <AntApp>
        <Main />
      </AntApp>
    </ConfigProvider>
  )
}
