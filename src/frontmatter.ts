import { JSON_SCHEMA, dump, load } from 'js-yaml'

/**
 * gray-matter 대체 (Tauri 웹뷰에는 Node Buffer가 없음).
 * JSON_SCHEMA를 써서 날짜가 Date 객체로 변환되지 않고 문자열 그대로 유지되게 한다.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { data: {}, content: raw }
  let data: Record<string, unknown> = {}
  try {
    const parsed = load(m[1], { schema: JSON_SCHEMA })
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch (e) {
    console.error('frontmatter parse failed', e)
  }
  return { data, content: raw.slice(m[0].length) }
}

export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  const yaml = dump(data, { schema: JSON_SCHEMA, lineWidth: -1 })
  return `---\n${yaml}---\n\n${content}`
}
