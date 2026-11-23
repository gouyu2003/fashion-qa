import { useEffect, useRef, useState } from 'react'
import { Button, Empty } from 'antd'
import { X } from 'lucide-react'
import { citationTitle } from './AnswerContent'
import EvidenceLocation from './EvidenceLocation'
import FabricComparison from './FabricCard'
import { collectFabricCards } from './evidenceFacts'
import type { ChatMessage } from './chatApi'
import type { SourceOption } from './types'

export const citationPanelId = 'chat-citation-panel'

export default function CitationPanel({ message, source, onClose, selection, headingId = 'citation-heading' }: {
  message: ChatMessage
  source?: Pick<SourceOption, 'source_id' | 'name'>
  onClose?: () => void
  selection?: { index?: number }
  headingId?: string
}) {
  const evidence = message.result?.supporting_evidence ?? []
  const cards = collectFabricCards(evidence)
  const [highlight, setHighlight] = useState<number>()
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (!selection) return
    const index = selection.index
    const target = index === undefined ? heading.current : list.current?.querySelector<HTMLElement>(`li:nth-child(${index + 1})`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView?.({ block: 'nearest' })
    setHighlight(index)
    if (index === undefined) return
    const timeout = window.setTimeout(() => setHighlight(undefined), 2200)
    return () => window.clearTimeout(timeout)
  }, [selection])

  return (
    <section id={citationPanelId} className="citation-panel" aria-labelledby={headingId}>
      <header className="citation-head">
        <div>
          <h2 id={headingId} ref={heading} tabIndex={-1}>引用 · {evidence.length} 条</h2>
          <small>本轮保存的支撑证据</small>
        </div>
        {onClose ? <Button type="text" aria-label="关闭引用" icon={<X size={17} aria-hidden="true" />} onClick={onClose} /> : null}
      </header>

      <div className="citation-body">
        {evidence.length ? (
          <ol className="citation-list" ref={list}>
            {evidence.map((item, index) => (
              <li className={`citation-item${highlight === index ? ' is-highlighted' : ''}`} key={index} tabIndex={-1}>
                <span className="citation-index">{String(index + 1).padStart(2, '0')}</span>
                <article>
                  <strong>{citationTitle(item)}</strong>
                  <EvidenceLocation evidence={item} source={source} />
                  <p>{item.text || '这条旧记录只保存了定位信息，没有原文片段。'}</p>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span>本轮没有保存可展示的引用。旧记录可能只有标题或段落索引。</span>}
          />
        )}
        {cards.length ? <FabricComparison cards={cards} title="引用面料" /> : null}
      </div>
    </section>
  )
}
