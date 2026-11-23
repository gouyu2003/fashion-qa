import type { SupportingEvidence } from './types'

export type DocumentKind = 'trend' | 'fabric' | 'other'
export type CareStatus = 'machine' | 'hand' | 'pending'

export interface DocumentLocation {
  sourceTitle: string
  sourceId?: string
  sourceVersion?: number
  filename?: string
  lineStart?: number
  lineEnd?: number
  headingPath?: string[]
}

export interface FabricCardData extends DocumentLocation {
  key: string
  code: string
  name: string
  color?: string
  composition?: string
  weight?: string
  handfeel?: string
  sheerness?: string
  care?: string
  careStatus: CareStatus
  simulated: boolean
  text: string
}

export interface TrendFacts {
  publisher?: string
  publishedAt?: string
  season?: string
  style?: string
  palette?: string
  keyColors?: string
  link?: string
}

export const CARE_LABELS: Record<CareStatus, string> = {
  machine: '可机洗',
  hand: '仅手洗',
  pending: '待确认',
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function field(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(
      `^\\s*[-*]?\\s*\\*\\*\\s*${escape(label)}\\s*\\*\\*\\s*[:：]?\\s*(.+)$`,
      'm',
    )
    const match = text.match(pattern)
    if (!match) continue
    const value = match[1].replace(/^[-–—]\s*/, '').trim()
    if (value) return value
  }
  return undefined
}

function plain(value?: string): string | undefined {
  if (!value) return undefined
  const stripped = value.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
  return stripped || undefined
}

export function documentKind(filename?: string, text = ''): DocumentKind {
  const hint = `${filename ?? ''}`
  if (/面料|FAB[-_ ]?\d{3}/i.test(hint)) return 'fabric'
  if (/趋势|关键色|trend|color|colour/i.test(hint)) return 'trend'
  if (/\*\*\s*卡号\s*\*\*/i.test(text) && /\*\*\s*(?:面料名称|面料)\s*\*\*/i.test(text)) return 'fabric'
  if (field(text, ['发布方']) || field(text, ['适用季节'])) return 'trend'
  return 'other'
}

export function careStatusOf(care?: string): CareStatus {
  if (!care) return 'pending'
  if (/待[^。；\n]{0,24}确认|待确认/.test(care)) return 'pending'
  if (/可机洗/.test(care)) return 'machine'
  if (/手洗/.test(care)) return 'hand'
  return 'pending'
}

export function parseFabric(text: string, location: DocumentLocation): FabricCardData | undefined {
  const code = plain(field(text, ['卡号', '款号', '料号']))
  const name = plain(field(text, ['面料名称', '面料', '品名']))
  if (!code || !name) return undefined
  const care = plain(field(text, ['洗护条件', '洗护', '护理方式']))
  const simulated = /模拟数据|模拟面料卡|Demo\s*模拟|示例数据/i.test(`${text} ${location.filename ?? ''}`)
  return {
    ...location,
    key: `${location.sourceId ?? location.sourceTitle}:${location.sourceVersion ?? ''}:${location.filename ?? ''}:${code}`,
    code,
    name,
    color: plain(field(text, ['颜色', '色号'])),
    composition: plain(field(text, ['成分', '纤维成分'])),
    weight: plain(field(text, ['克重', '平方米克重'])),
    handfeel: plain(field(text, ['手感与透感', '手感'])),
    sheerness: plain(field(text, ['透感'])),
    care,
    careStatus: careStatusOf(care),
    simulated,
    text,
  }
}

export function parseTrend(text: string): TrendFacts {
  const link = text.match(/https?:\/\/[^\s)）]+/)?.[0]
  return {
    publisher: plain(field(text, ['发布方', '发布机构', '来源机构'])),
    publishedAt: plain(field(text, ['发布日期', '发布时间'])),
    season: plain(field(text, ['适用季节', '季节'])),
    style: plain(field(text, ['风格摘要', '风格'])),
    palette: plain(field(text, ['配色摘要', '配色'])),
    keyColors: plain(field(text, ['关键色'])),
    link,
  }
}

export function hasTrendFacts(facts: TrendFacts): boolean {
  return Boolean(facts.publisher || facts.season || facts.publishedAt)
}

function mergeFabric(target: FabricCardData, next: FabricCardData): FabricCardData {
  return {
    ...target,
    color: target.color ?? next.color,
    composition: target.composition ?? next.composition,
    weight: target.weight ?? next.weight,
    handfeel: target.handfeel ?? next.handfeel,
    sheerness: target.sheerness ?? next.sheerness,
    care: target.care ?? next.care,
    careStatus: target.care ? target.careStatus : next.careStatus,
    lineStart: target.lineStart === undefined || (next.lineStart !== undefined && next.lineStart < target.lineStart)
      ? next.lineStart ?? target.lineStart
      : target.lineStart,
    lineEnd: Math.max(target.lineEnd ?? 0, next.lineEnd ?? 0) || undefined,
    headingPath: target.headingPath?.length ? target.headingPath : next.headingPath,
    text: target.text.includes(next.text) ? target.text : `${target.text}\n${next.text}`,
  }
}

/**
 * Only cited excerpts can produce a fabric card. Chunks sharing the same source,
 * version and file are treated as one card so weight and care can be filled in
 * from another excerpt of the same material.
 */
export function collectFabricCards(evidence: Array<Partial<SupportingEvidence>> | undefined): FabricCardData[] {
  if (!evidence?.length) return []
  const cards = new Map<string, FabricCardData>()
  for (const item of evidence) {
    const text = item.text ?? ''
    const location: DocumentLocation = {
      sourceTitle: item.source_title ?? item.filename ?? '未标注来源',
      sourceId: item.source_id,
      sourceVersion: item.source_version,
      filename: item.filename,
      lineStart: item.line_start,
      lineEnd: item.line_end,
      headingPath: item.heading_path,
    }
    const parsed = parseFabric(text, location)
    if (!parsed) continue
    const existing = cards.get(parsed.key)
    cards.set(parsed.key, existing ? mergeFabric(existing, parsed) : parsed)
  }
  return [...cards.values()]
}
