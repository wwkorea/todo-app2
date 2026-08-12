import { useEffect, useImperativeHandle, useRef, forwardRef, type CSSProperties } from 'react'
import { Crepe } from '@milkdown/crepe'
import { useAppStore } from '../store'
import { editorViewCtx } from '@milkdown/kit/core'
import { $prose, insert } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

export interface MarkdownEditorHandle {
  /** 커서 위치에 마크다운 삽입 (툴바 버튼용) */
  insertMarkdown: (markdown: string, inline?: boolean) => void
  insertText: (text: string) => void
  getMarkdown: () => string
}

interface Props {
  defaultValue: string
  /** 인라인 상태 토큰 목록 — 클릭하면 다음 토큰으로 순환 */
  tokens: string[]
  onChange: (markdown: string) => void
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 본문 속 [미처리] [진행중] [완료] 텍스트를 칩으로 렌더링하고, 클릭 시 순환시키는 플러그인 */
function statusTokenPlugin(tokens: string[]) {
  const re = new RegExp(`\\[(${tokens.map(escapeRe).join('|')})\\]`, 'g')

  const scan = (doc: ProseNode): { from: number; to: number; token: string }[] => {
    const found: { from: number; to: number; token: string }[] = []
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(node.text))) {
        found.push({ from: pos + m.index, to: pos + m.index + m[0].length, token: m[1] })
      }
    })
    return found
  }

  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('status-tokens'),
        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              scan(state.doc).map(({ from, to, token }) =>
                Decoration.inline(from, to, {
                  class: `status-token status-token-${tokens.indexOf(token)}`
                })
              )
            )
          },
          handleClick(view, pos) {
            const hit = scan(view.state.doc).find((r) => pos >= r.from && pos <= r.to)
            if (!hit) return false
            const next = tokens[(tokens.indexOf(hit.token) + 1) % tokens.length]
            view.dispatch(view.state.tr.insertText(`[${next}]`, hit.from, hit.to))
            return true
          }
        }
      })
  )
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { defaultValue, tokens, onChange },
  ref
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editorFontSize = useAppStore((s) => s.settings.editor_font_size ?? 16)

  useEffect(() => {
    if (!rootRef.current) return
    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue,
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: false
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '내용을 입력하세요…' }
      }
    })
    crepe.editor.use(statusTokenPlugin(tokens))
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown))
    })
    let destroyed = false
    crepe.create().then(() => {
      if (!destroyed) crepeRef.current = crepe
    })
    return () => {
      destroyed = true
      crepeRef.current = null
      void crepe.destroy()
    }
    // defaultValue는 마운트 시 1회만 사용 — 항목 전환 시에는 key로 리마운트한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    insertMarkdown(markdown, inline = false) {
      const crepe = crepeRef.current
      if (!crepe) return
      crepe.editor.action(insert(markdown, inline))
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },
    insertText(text) {
      const crepe = crepeRef.current
      if (!crepe) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.insertText(text))
        view.focus()
      })
    },
    getMarkdown() {
      return crepeRef.current?.getMarkdown() ?? defaultValue
    }
  }))

  return (
    <div
      className="md-editor"
      ref={rootRef}
      style={{ '--editor-font-size': `${editorFontSize}px` } as CSSProperties}
    />
  )
})

export default MarkdownEditor
