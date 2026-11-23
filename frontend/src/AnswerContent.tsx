import { Tag } from 'antd'
import { ArrowUpRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Element, Parent, Root, RootContent } from 'hast'
import remarkGfm from 'remark-gfm'
import EvidenceLocation from './EvidenceLocation'
import type { RunResult, SupportingEvidence } from './types'
import './answerContent.css'

type SelectCitation = (index: number, trigger: HTMLButtonElement) => void

export function citationTitle(evidence: SupportingEvidence) {
  return evidence.filename || evidence.source_title || '未标注来源'
}

function citationMarker(index: number): Element {
  return { type: 'element', tagName: 'sup', properties: { dataChatCitation: index }, children: [] }
}

function withCitationMarkers(count: number) {
  return () => (tree: Root) => {
    let linked = false
    function annotate(parent: Parent) {
      parent.children = parent.children.flatMap<RootContent>(child => {
        if (child.type === 'element' && !['a', 'code', 'pre', 'script', 'style'].includes(child.tagName)) annotate(child)
        if (child.type !== 'text') return [child]

        const nodes: (typeof child | Element)[] = []
        let cursor = 0
        for (const match of child.value.matchAll(/\[([1-9]\d*)\]|【([1-9]\d*)】/g)) {
          const index = Number(match[1] ?? match[2]) - 1
          if (index >= count) continue
          if (cursor < match.index) nodes.push({ type: 'text', value: child.value.slice(cursor, match.index) })
          nodes.push(citationMarker(index))
          cursor = match.index + match[0].length
          linked = true
        }
        if (!cursor) return [child]
        if (cursor < child.value.length) nodes.push({ type: 'text', value: child.value.slice(cursor) })
        return nodes
      })
    }
    annotate(tree)
    if (!linked) {
      tree.children.push({
        type: 'element', tagName: 'p', properties: { className: ['answer-citation-index'] },
        children: [{ type: 'text', value: '本轮依据 ' }, ...Array.from({ length: count }, (_, index) => citationMarker(index))],
      })
    }
  }
}

function AnswerMarkdown({ text, evidence, onCitationSelect }: {
  text: string; evidence: SupportingEvidence[]; onCitationSelect?: SelectCitation
}) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}
    rehypePlugins={onCitationSelect && evidence.length ? [withCitationMarkers(evidence.length)] : undefined}
    components={onCitationSelect ? {
      sup: ({ node, children, ...props }) => {
        const index = node?.properties.dataChatCitation
        if (typeof index !== 'number') return <sup {...props}>{children}</sup>
        return <sup className="answer-citation-marker"><button type="button" onClick={event => onCitationSelect(index, event.currentTarget)}
          aria-label={`引用 ${index + 1}：${citationTitle(evidence[index])}`}>{index + 1}</button></sup>
      },
    } : undefined}>{text}</ReactMarkdown>
}

export function answerStatus(result: RunResult, intent = result.chat_context?.intent) {
  if (intent === 'clarification') return { color: 'blue', label: '等待补充信息' }
  if (result.verification_applicable === false) return { color: 'default', label: '通用回答' }
  if (result.verified) return { color: 'success', label: '验证通过' }
  if (result.failure_type === 'conflict') return { color: 'warning', label: '资料存在冲突' }
  if (result.failure_type === 'insufficient') return { color: 'warning', label: '资料不足' }
  return { color: 'warning', label: '验证未通过' }
}

export default function AnswerContent({ result, content, intent, showStatus = true, showReferences = false,
  onCitationSelect, activeCitation }: {
  result: RunResult; content?: string; intent?: string; showStatus?: boolean; showReferences?: boolean
  onCitationSelect?: SelectCitation
  activeCitation?: number
}) {
  const status = answerStatus(result, intent)
  const parts = result.response_parts?.length ? result.response_parts : undefined
  const mixed = (parts?.length ?? 0) > 1
  const references = showReferences && (result.supporting_evidence?.length ?? 0) > 0
    ? <details className="answer-references"><summary>查看引用 · {result.supporting_evidence!.length} 条</summary>
      {result.supporting_evidence!.map((evidence, index) => <div key={index} className="answer-reference-item">
        <strong>{evidence.source_title}</strong><EvidenceLocation evidence={evidence} /><p>{evidence.text}</p>
      </div>)}
    </details> : null
  const evidence = result.supporting_evidence ?? []
  return <div className="answer-content">
    {onCitationSelect && evidence.length > 0 ? <section className="answer-sources" aria-label="本轮来源">
      <div className="answer-sources-label">本轮来源 <span>{evidence.length} 条</span></div>
      <ol className="answer-sources-strip">
        {evidence.map((item, index) => <li key={index}>
          <button type="button" title={citationTitle(item)} aria-current={activeCitation === index ? 'true' : undefined}
            aria-label={`跳转到来源 ${index + 1}：${citationTitle(item)}`} onClick={event => onCitationSelect(index, event.currentTarget)}>
            <span className="answer-source-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="answer-source-title">{citationTitle(item)}</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </li>)}
      </ol>
    </section> : null}
    {parts ? parts.map((part, index) => <section className="answer-part" key={`${part.kind}-${index}`} aria-label={part.kind === 'knowledge' ? '知识库部分' : '通用部分'}>
      {showStatus || mixed ? <div className="answer-part-heading">
        {mixed ? <strong>{part.kind === 'knowledge' ? '知识库部分' : '通用部分'}</strong> : null}
        {showStatus ? <Tag color={part.kind === 'general' ? 'default' : status.color}>{part.kind === 'general' ? '通用回答' : status.label}</Tag> : null}
      </div> : null}
      <AnswerMarkdown text={part.content} evidence={evidence} onCitationSelect={part.kind === 'knowledge' ? onCitationSelect : undefined} />
      {part.kind === 'knowledge' ? references : null}
    </section>) : <>
      {showStatus ? <Tag color={status.color}>{status.label}</Tag> : null}
      <AnswerMarkdown text={content ?? result.answer ?? ''} evidence={evidence}
        onCitationSelect={result.verification_applicable !== false ? onCitationSelect : undefined} />
      {result.verification_applicable !== false ? references : null}
    </>}
  </div>
}
