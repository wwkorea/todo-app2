import { create } from 'zustand'
import dayjs from 'dayjs'
import type { AdviceRecord, AppData, GlobalSettings, Item, TabData } from './types'
import { DEFAULT_GLOBAL_SETTINGS, defaultTabSetting } from './types'
import { api } from './api'

export type SaveState = 'saved' | 'dirty' | 'saving'

interface AppState {
  ready: boolean
  needSetup: boolean
  dataDir: string | null
  settings: GlobalSettings
  tabs: TabData[]
  activeTab: string | null
  /** 상세(편집) 화면에 열린 항목. null이면 리스트 화면 */
  openTabDir: string | null
  openItemId: string | null
  query: string
  saveState: SaveState
  settingsOpen: boolean
  /** 항목별 AI 도움말 캐시. key = `${tabDir}/${itemId}` */
  advice: Record<string, AdviceRecord>
  /** 현재 도움말 생성 중인 key (동시 1건만) */
  adviceBusy: string | null
}

export const useAppStore = create<AppState>(() => ({
  ready: false,
  needSetup: false,
  dataDir: null,
  settings: DEFAULT_GLOBAL_SETTINGS,
  tabs: [],
  activeTab: null,
  openTabDir: null,
  openItemId: null,
  query: '',
  saveState: 'saved',
  settingsOpen: false,
  advice: {},
  adviceBusy: null
}))

const set = useAppStore.setState
const get = useAppStore.getState

function now(): string {
  return dayjs().format('YYYY-MM-DDTHH:mm:ss')
}

function newId(): string {
  return dayjs().format('YYYYMMDD-HHmmssSSS')
}

function applyData(data: AppData): void {
  const prevActive = get().activeTab
  const tabDirs = data.tabs.map((t) => t.dir)
  const active =
    prevActive && tabDirs.includes(prevActive)
      ? prevActive
      : data.settings.last_tab && tabDirs.includes(data.settings.last_tab)
        ? data.settings.last_tab
        : (tabDirs[0] ?? null)
  set({
    ready: true,
    needSetup: false,
    dataDir: data.dataDir,
    settings: data.settings,
    tabs: data.tabs,
    activeTab: active
  })
}

export async function init(): Promise<void> {
  const config = await api.getConfig()
  if (!config.dataDir) {
    set({ ready: true, needSetup: true })
    return
  }
  try {
    applyData(await api.loadData())
    set({ advice: await api.loadAdvice() })
  } catch (e) {
    console.error('failed to load data dir, falling back to setup', e)
    set({ ready: true, needSetup: true })
  }
}

export async function setDataDir(dir: string): Promise<void> {
  applyData(await api.initData(dir))
  set({ advice: await api.loadAdvice() })
}

export async function reloadData(): Promise<void> {
  applyData(await api.loadData())
}

export function setActiveTab(dir: string): void {
  set({ activeTab: dir })
  const { settings } = get()
  const next = { ...settings, last_tab: dir }
  set({ settings: next })
  void api.saveSettings(next)
}

export function setQuery(query: string): void {
  set({ query })
}

export function setSettingsOpen(open: boolean): void {
  set({ settingsOpen: open })
}

function findTab(tabDir: string): TabData | undefined {
  return get().tabs.find((t) => t.dir === tabDir)
}

export function getOpenItem(): { tab: TabData; item: Item } | null {
  const { openTabDir, openItemId } = get()
  if (!openTabDir || !openItemId) return null
  const tab = findTab(openTabDir)
  const item = tab?.items.find((i) => i.id === openItemId)
  return tab && item ? { tab, item } : null
}

export async function newItem(tabDir: string): Promise<void> {
  const tab = findTab(tabDir)
  if (!tab) return
  const item: Item = {
    id: newId(),
    title: '',
    status: tab.setting.type === 'todo' ? tab.setting.default_status : undefined,
    priority: tab.setting.type === 'todo' ? 'medium' : undefined,
    tags: [],
    created_at: now(),
    updated_at: now(),
    body: ''
  }
  const setting = { ...tab.setting, order: [item.id, ...tab.setting.order] }
  set({
    tabs: get().tabs.map((t) =>
      t.dir === tabDir ? { ...t, setting, items: [item, ...t.items] } : t
    ),
    openTabDir: tabDir,
    openItemId: item.id,
    saveState: 'saved'
  })
  await api.saveItem(tabDir, item, get().settings.backup_keep)
  await api.saveTabSetting(tabDir, setting)
}

export function openItem(tabDir: string, id: string): void {
  set({ openTabDir: tabDir, openItemId: id, saveState: 'saved', query: '' })
}

export async function closeDetail(): Promise<void> {
  if (get().saveState !== 'saved') await saveOpenItem()
  set({ openTabDir: null, openItemId: null, saveState: 'saved' })
}

/** 상세 화면에서의 수정 — 메모리에 반영하고 dirty 표시만 (저장은 자동저장/수동저장에서) */
export function updateOpenItem(patch: Partial<Item>): void {
  const { openTabDir, openItemId } = get()
  if (!openTabDir || !openItemId) return
  set({
    tabs: get().tabs.map((t) =>
      t.dir !== openTabDir
        ? t
        : {
            ...t,
            items: t.items.map((i) => (i.id !== openItemId ? i : applyPatch(i, patch)))
          }
    ),
    saveState: 'dirty'
  })
}

function applyPatch(item: Item, patch: Partial<Item>): Item {
  const next = { ...item, ...patch, updated_at: now() }
  if ('status' in patch) {
    next.done_at = patch.status === 'done' ? now() : undefined
  }
  return next
}

export async function saveOpenItem(): Promise<void> {
  const found = getOpenItem()
  if (!found || get().saveState === 'saved') return
  set({ saveState: 'saving' })
  try {
    await api.saveItem(found.tab.dir, found.item, get().settings.backup_keep)
    // 저장 중 새 수정이 없었을 때만 saved로
    if (get().saveState === 'saving') set({ saveState: 'saved' })
  } catch (e) {
    console.error('save failed', e)
    set({ saveState: 'dirty' })
    throw e
  }
}

/** 리스트에서의 인라인 수정 (상태 등) — 즉시 저장 */
export async function updateItemInline(
  tabDir: string,
  id: string,
  patch: Partial<Item>
): Promise<void> {
  let saved: Item | undefined
  set({
    tabs: get().tabs.map((t) =>
      t.dir !== tabDir
        ? t
        : {
            ...t,
            items: t.items.map((i) => {
              if (i.id !== id) return i
              saved = applyPatch(i, patch)
              return saved
            })
          }
    )
  })
  if (saved) await api.saveItem(tabDir, saved, get().settings.backup_keep)
}

export async function deleteItemAction(tabDir: string, id: string): Promise<void> {
  const tab = findTab(tabDir)
  if (!tab) return
  const setting = { ...tab.setting, order: tab.setting.order.filter((x) => x !== id) }
  set({
    tabs: get().tabs.map((t) =>
      t.dir === tabDir ? { ...t, setting, items: t.items.filter((i) => i.id !== id) } : t
    ),
    ...(get().openItemId === id ? { openTabDir: null, openItemId: null } : {})
  })
  await api.deleteItem(tabDir, id, get().settings.backup_keep)
  await api.saveTabSetting(tabDir, setting)
}

/** 드래그 결과 반영 — md 파일은 건드리지 않고 setting.json의 order만 저장 */
export async function reorderItems(tabDir: string, orderedIds: string[]): Promise<void> {
  const tab = findTab(tabDir)
  if (!tab) return
  const setting = { ...tab.setting, order: orderedIds }
  const index = new Map(orderedIds.map((id, i) => [id, i]))
  const items = [...tab.items].sort(
    (a, b) => (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity)
  )
  set({
    tabs: get().tabs.map((t) => (t.dir === tabDir ? { ...t, setting, items } : t))
  })
  await api.saveTabSetting(tabDir, setting)
}

/**
 * 항목을 다른 탭으로 이동 — 대상 탭 맨 위에 배치.
 * 대상 탭 타입과 호환되지 않는 필드는 버린다 (memo로 가면 상태/우선순위/날짜 제거,
 * todo로 가면 대상 탭에 없는 상태를 기본 상태로 교체).
 */
export async function moveItemToTab(fromDir: string, id: string, toDir: string): Promise<void> {
  const from = findTab(fromDir)
  const to = findTab(toDir)
  const item = from?.items.find((i) => i.id === id)
  if (!from || !to || !item || fromDir === toDir) return

  const moved: Item = { ...item, updated_at: now() }
  if (to.setting.type === 'memo') {
    moved.status = undefined
    moved.priority = undefined
    moved.due_date = undefined
    moved.plan_date = undefined
    moved.done_at = undefined
  } else {
    if (!moved.status || !to.setting.statuses.includes(moved.status)) {
      moved.status = to.setting.default_status
      moved.done_at = undefined
    }
    moved.priority = moved.priority ?? 'medium'
  }

  const fromSetting = { ...from.setting, order: from.setting.order.filter((x) => x !== id) }
  const toSetting = { ...to.setting, order: [id, ...to.setting.order.filter((x) => x !== id)] }
  set({
    tabs: get().tabs.map((t) => {
      if (t.dir === fromDir)
        return { ...t, setting: fromSetting, items: t.items.filter((i) => i.id !== id) }
      if (t.dir === toDir) return { ...t, setting: toSetting, items: [moved, ...t.items] }
      return t
    })
  })

  const keep = get().settings.backup_keep
  // 새 위치에 먼저 쓰고 나서 원본 삭제 (중간에 죽어도 데이터는 남도록)
  await api.saveItem(toDir, moved, keep)
  await api.deleteItem(fromDir, id, keep)
  await api.saveTabSetting(toDir, toSetting)
  await api.saveTabSetting(fromDir, fromSetting)
}

/** 탭 자체의 드래그 순서 변경 — settings.json의 tab_order에 저장 */
export async function reorderTabs(orderedDirs: string[]): Promise<void> {
  const index = new Map(orderedDirs.map((d, i) => [d, i]))
  set({
    tabs: [...get().tabs].sort(
      (a, b) => (index.get(a.dir) ?? Infinity) - (index.get(b.dir) ?? Infinity)
    )
  })
  await saveSettingsPatch({ tab_order: orderedDirs })
}

/** 탭의 태그 목록 수정 — setting.json에 저장 */
export async function updateTabTags(tabDir: string, tags: string[]): Promise<void> {
  const tab = findTab(tabDir)
  if (!tab) return
  const setting = { ...tab.setting, tags }
  set({ tabs: get().tabs.map((t) => (t.dir === tabDir ? { ...t, setting } : t)) })
  await api.saveTabSetting(tabDir, setting)
}

export async function saveSettingsPatch(patch: Partial<GlobalSettings>): Promise<void> {
  const next = { ...get().settings, ...patch }
  set({ settings: next })
  await api.saveSettings(next)
}

export async function createTabAction(folder: string, name: string, type: 'todo' | 'memo') {
  applyData(await api.createTab(folder, defaultTabSetting(name, type)))
  const next = { ...get().settings, tab_order: get().tabs.map((t) => t.dir) }
  set({ settings: next })
  await api.saveSettings(next)
}
