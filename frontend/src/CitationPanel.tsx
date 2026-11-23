import { Button, Empty } from 'antd'
import { CloseCircleFilled } from './Icons'
import EvidenceLocation from './EvidenceLocation'
import FabricComparison from './FabricCard'
import { collectFabricCards } from './evidenceFacts'
import type { ChatMessage } from './chatApi'
import type { SourceOption } from './types'

export default function CitationPanel({ message, source, onClose, headingId = 'citation-heading' }: {
  message: ChatMessage
  source?: Pick<SourceOption, 'source_id' | 'name'>
  onClose?: () => void
  headingId?: string
}) {
  const evidence = message.result?.supporting_evidence ?? []
  const cards = collectFabricCards(evidence)
  return (
    <section className="citation-panel" aria-labelledby={headingId}>
      <header className="citation-head">
        <div>
          <span className="section-kicker">CITATIONS</span>
          <h2 id={headingId}>引用 · {evidence.length} 条</h2>
          <small>来自本轮保存的支撑证据，按回答原顺序排列。</small>
        </div>
        {onClose ? <Button type="text" aria-label="关闭引用" icon={<CloseCircleFilled />} onClick={onClose} /> : null}
      </header>

      {cards.length ? <FabricComparison cards={cards} title="引用面料" /> : null}

      {evidence.length ? (
        <ol className="citation-list">
          {evidence.map((item, index) => (
            <li className="citation-item" key={`${item.sq_id}-${item.chunk_id ?? index}`}>
              <span className="citation-index">{String(index + 1).padStart(2, '0')}</span>
              <article>
                <strong>{item.source_title || item.filename || '未标注来源'}</strong>
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
    </section>
  )
}
