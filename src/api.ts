import { open } from '@tauri-apps/plugin-dialog'
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile
} from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import {
  AppData,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_TOKENS,
  GlobalSettings,
  Item,
  ItemMeta,
  TabData,
  TabSetting,
  defaultTabSetting
} from './types'
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'

const EXCLUDE_DIRS = new Set(['backup', 'backup_days'])

/** 마지막으로 로드한 데이터 폴더 (Electron 버전에서 main이 config에서 읽던 것을 캐시로 대체) */
let currentDataDir: string | null = null

function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function today(): string {
  return ts().slice(0, 8)
}

/**
 * 임시파일에 쓴 뒤 rename — 쓰기 도중 크래시에도 원본이 깨지지 않게.
 * (Windows의 Rust rename은 대상이 존재하면 실패하므로 rename 직전에 원본을 지운다.
 *  원본은 이미 backup/에 복사된 뒤라 이 짧은 틈에 죽어도 복구 가능하다.)
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`
  await writeTextFile(tmp, content)
  if (await exists(filePath)) await remove(filePath)
  await rename(tmp, filePath)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await readTextFile(filePath)) }
  } catch {
    return fallback
  }
}

async function configPath(): Promise<string> {
  return join(await appConfigDir(), 'config.json')
}

async function scanTabDirs(dataDir: string): Promise<string[]> {
  const result: string[] = []
  for (const e of await readDir(dataDir)) {
    if (!e.isDirectory || EXCLUDE_DIRS.has(e.name)) continue
    if (await exists(await join(dataDir, e.name, 'setting.json'))) result.push(e.name)
  }
  return result
}

async function createTabFs(dataDir: string, folder: string, setting: TabSetting): Promise<void> {
  const dir = await join(dataDir, folder)
  await mkdir(dir, { recursive: true })
  await atomicWrite(await join(dir, 'setting.json'), JSON.stringify(setting, null, 2))
}

async function ensureDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const settingsPath = await join(dataDir, 'settings.json')
  if (!(await exists(settingsPath))) {
    await atomicWrite(settingsPath, JSON.stringify(DEFAULT_GLOBAL_SETTINGS, null, 2))
  }
  if ((await scanTabDirs(dataDir)).length === 0) {
    await createTabFs(dataDir, 'todos', defaultTabSetting('Todos', 'todo'))
    await createTabFs(dataDir, 'memos', defaultTabSetting('Memos', 'memo'))
  }
}

async function loadTab(dataDir: string, tabDir: string): Promise<TabData> {
  const dir = await join(dataDir, tabDir)
  const setting = await readJson<TabSetting>(
    await join(dir, 'setting.json'),
    defaultTabSetting(tabDir, 'todo')
  )
  if (!Array.isArray(setting.tags)) {
    setting.tags = defaultTabSetting(setting.name, setting.type).tags
  }
  if (!Array.isArray(setting.tokens) || setting.tokens.join(',') === '미처리,진행중,완료') {
    setting.tokens = [...DEFAULT_TOKENS]
  }

  const items: Item[] = []
  for (const f of await readDir(dir)) {
    if (!f.isFile || !f.name.endsWith('.md')) continue
    try {
      const raw = await readTextFile(await join(dir, f.name))
      const parsed = parseFrontmatter(raw)
      const meta = parsed.data as unknown as ItemMeta & { tested?: boolean; v2_applied?: boolean }
      const id = meta.id ?? f.name.replace(/\.md$/, '')
      // 구버전 마이그레이션: tested / v2_applied 불리언 → 태그
      const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : []
      if (meta.tested === true && !tags.includes('테스트완료')) tags.push('테스트완료')
      if (meta.v2_applied === true && !tags.includes('v2반영')) tags.push('v2반영')
      delete meta.tested
      delete meta.v2_applied
      items.push({
        ...meta,
        id: String(id),
        title: meta.title ?? String(id),
        tags,
        created_at: String(meta.created_at ?? ''),
        updated_at: String(meta.updated_at ?? ''),
        body: parsed.content.replace(/^\n/, '')
      })
    } catch (e) {
      console.error(`failed to parse ${tabDir}/${f.name}`, e)
    }
  }

  const orderIndex = new Map(setting.order.map((id, i) => [id, i]))
  items.sort((a, b) => {
    const ia = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER
    const ib = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER
    return ia - ib || a.id.localeCompare(b.id)
  })
  return { dir: tabDir, setting, items }
}

async function loadAll(dataDir: string): Promise<AppData> {
  await ensureDataDir(dataDir)
  const settings = await readJson<GlobalSettings>(
    await join(dataDir, 'settings.json'),
    DEFAULT_GLOBAL_SETTINGS
  )
  const dirs = await scanTabDirs(dataDir)
  const base = settings.tab_order.length > 0 ? settings.tab_order : ['todos']
  const ordered = [
    ...base.filter((d) => dirs.includes(d)),
    ...dirs.filter((d) => !base.includes(d))
  ]
  const tabs: TabData[] = []
  for (const d of ordered) tabs.push(await loadTab(dataDir, d))
  currentDataDir = dataDir
  return { dataDir, settings, tabs }
}

function requireDataDir(): string {
  if (!currentDataDir) throw new Error('data directory is not configured')
  return currentDataDir
}

/** 저장 직전 원본을 backup/(파일별 롤링 N개) + backup_days/(하루 1회)로 복사 */
async function backupFile(
  dataDir: string,
  tabDir: string,
  id: string,
  keep: number
): Promise<void> {
  const src = await join(dataDir, tabDir, `${id}.md`)
  if (!(await exists(src))) return

  const bdir = await join(dataDir, 'backup', tabDir)
  await mkdir(bdir, { recursive: true })
  await copyFile(src, await join(bdir, `${id}_${ts()}.md`))
  const siblings = (await readDir(bdir))
    .filter((f) => f.isFile && f.name.startsWith(`${id}_`) && f.name.endsWith('.md'))
    .map((f) => f.name)
    .sort()
    .reverse()
  for (const old of siblings.slice(Math.max(keep, 1))) {
    await remove(await join(bdir, old))
  }

  const ddir = await join(dataDir, 'backup_days', today(), tabDir)
  await mkdir(ddir, { recursive: true })
  const dayDest = await join(ddir, `${id}.md`)
  if (!(await exists(dayDest))) await copyFile(src, dayDest)
}

function serializeItem(item: Item): string {
  const { body, ...meta } = item
  const cleanMeta: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    cleanMeta[k] = v
  }
  return stringifyFrontmatter(body.endsWith('\n') ? body : `${body}\n`, cleanMeta)
}

/** Electron preload의 window.api와 동일한 표면 — 렌더러 코드는 import 경로만 바뀐다 */
export const api = {
  async getConfig(): Promise<{ dataDir: string | null }> {
    try {
      const raw = JSON.parse(await readTextFile(await configPath()))
      return { dataDir: typeof raw.dataDir === 'string' ? raw.dataDir : null }
    } catch {
      return { dataDir: null }
    }
  },

  async pickDir(): Promise<string | null> {
    const dir = await open({ title: '데이터 저장 폴더 선택', directory: true })
    return typeof dir === 'string' ? dir : null
  },

  async initData(dataDir: string): Promise<AppData> {
    await ensureDataDir(dataDir)
    await mkdir(await appConfigDir(), { recursive: true })
    await writeTextFile(await configPath(), JSON.stringify({ dataDir }, null, 2))
    return loadAll(dataDir)
  },

  async loadData(): Promise<AppData> {
    const { dataDir } = await api.getConfig()
    if (!dataDir) throw new Error('data directory is not configured')
    return loadAll(dataDir)
  },

  async saveItem(tabDir: string, item: Item, backupKeep: number): Promise<void> {
    const dataDir = requireDataDir()
    await backupFile(dataDir, tabDir, item.id, backupKeep)
    await atomicWrite(await join(dataDir, tabDir, `${item.id}.md`), serializeItem(item))
  },

  async deleteItem(tabDir: string, id: string, backupKeep: number): Promise<void> {
    const dataDir = requireDataDir()
    await backupFile(dataDir, tabDir, id, backupKeep)
    const p = await join(dataDir, tabDir, `${id}.md`)
    if (await exists(p)) await remove(p)
  },

  async saveTabSetting(tabDir: string, setting: TabSetting): Promise<void> {
    const dataDir = requireDataDir()
    await atomicWrite(
      await join(dataDir, tabDir, 'setting.json'),
      JSON.stringify(setting, null, 2)
    )
  },

  async createTab(folder: string, setting: TabSetting): Promise<AppData> {
    if (!/^[\w-]+$/.test(folder)) throw new Error('탭 폴더명은 영문/숫자/-/_ 만 가능합니다')
    const dataDir = requireDataDir()
    await createTabFs(dataDir, folder, setting)
    return loadAll(dataDir)
  },

  async saveSettings(settings: GlobalSettings): Promise<void> {
    const dataDir = requireDataDir()
    await atomicWrite(await join(dataDir, 'settings.json'), JSON.stringify(settings, null, 2))
  }
}

export type Api = typeof api
