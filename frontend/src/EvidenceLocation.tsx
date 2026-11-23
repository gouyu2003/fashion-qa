import type { EvidenceLocation as Location, SourceOption } from './types'

export default function EvidenceLocation({ evidence, source }: {
  evidence: Location & { source_id?: string; source_paragraph?: number }
  source?: Pick<SourceOption, 'source_id' | 'name'>
}) {
  if (!evidence.filename) {
    return evidence.source_paragraph !== undefined
      ? <small className="evidence-location">句子索引 {evidence.source_paragraph}</small>
      : null
  }
  const sourceName = source?.source_id === evidence.source_id ? source?.name.trim() : undefined
  const lines = evidence.line_start !== undefined
    ? `第 ${evidence.line_start}${evidence.line_end !== undefined && evidence.line_end !== evidence.line_start ? `–${evidence.line_end}` : ''} 行`
    : undefined
  return (
    <small className="evidence-location">
      {evidence.source_id ? <><span title={`资料 ID：${evidence.source_id}`}>{sourceName || evidence.source_id}</span>{' · '}</> : null}
      {evidence.source_version !== undefined ? `版本 ${evidence.source_version} · ` : ''}
      {evidence.filename}
      {lines ? ` · ${lines}` : ''}
      {evidence.heading_path?.length ? ` · ${evidence.heading_path.join(' / ')}` : ''}
    </small>
  )
}
