import { CircleCheck, Clock, Hand } from 'lucide-react'
import type { CSSProperties } from 'react'
import { CARE_LABELS } from './evidenceFacts'
import type { CareStatus, FabricCardData } from './evidenceFacts'
import './fabricCard.css'

const SWATCHES: Record<string, string> = {
  '乳白色': '#F1ECE0',
  '米白色': '#EFE9DB',
  '白色': '#FFFFFF',
  '本白色': '#F7F4EA',
  '浅灰色': '#D6DADB',
  '灰色': '#B9C0C2',
  '黑色': '#2A3138',
  '藏青色': '#25384A',
  '墨蓝色': '#203342',
  '嫩绿色': '#C9D9B4',
  '暖黄色': '#EBD08A',
  '浅蓝色': '#C7D9E4',
}

const CARE_ICON: Record<CareStatus, typeof CircleCheck> = {
  machine: CircleCheck,
  hand: Hand,
  pending: Clock,
}

function careDetail(care?: string) {
  if (!care) return '资料未给出洗护条件'
  return care.replace(/^[。；;,\s]+/, '').trim()
}

function LocationLine({ card }: { card: FabricCardData }) {
  const parts = [
    card.filename ?? card.sourceTitle,
    card.sourceVersion !== undefined ? `版本 ${card.sourceVersion}` : undefined,
    card.lineStart !== undefined
      ? `第 ${card.lineStart}${card.lineEnd !== undefined && card.lineEnd !== card.lineStart ? `–${card.lineEnd}` : ''} 行`
      : undefined,
  ].filter(Boolean)
  return <small className="fabric-source">{parts.join(' · ')}</small>
}

export function FabricCard({ card }: { card: FabricCardData }) {
  const swatch = card.color ? SWATCHES[card.color] : undefined
  const CareIcon = CARE_ICON[card.careStatus]
  return (
    <article className="fabric-card" aria-label={`面料 ${card.code}`}>
      <div className={`fabric-swatch${swatch ? '' : ' is-placeholder'}`}
        style={swatch ? { '--fabric-swatch': swatch } as CSSProperties : undefined}>
        <div className="fabric-swatch-badges">
          {card.simulated ? <span className="fabric-simulated">模拟数据</span> : null}
          <span className="fabric-code">{card.code}</span>
        </div>
        {card.color ? <span className="fabric-swatch-label">{card.color}</span> : null}
      </div>

      <div className="fabric-details">
        <strong className="fabric-name">{card.name}</strong>
        <dl className="fabric-specs">
          <div className="fabric-composition"><dt>成分</dt><dd>{card.composition ?? '未记录'}</dd></div>
          <div><dt>克重</dt><dd>{card.weight ?? '未记录'}</dd></div>
          <div><dt>门幅</dt><dd>{card.width ?? '未记录'}</dd></div>
        </dl>

        {card.handfeel || card.sheerness ? (
          <p className="fabric-extra">
            {card.handfeel ? `手感 ${card.handfeel}` : ''}
            {card.handfeel && card.sheerness ? ' · ' : ''}
            {card.sheerness ? `透感 ${card.sheerness}` : ''}
          </p>
        ) : null}
        <div className={`fabric-care is-${card.careStatus}`}>
          <strong><CareIcon aria-hidden="true" size={15} />{card.careStatus === 'pending' ? '待向供应商核实' : CARE_LABELS[card.careStatus]}</strong>
          <span>{careDetail(card.care)}</span>
        </div>
        <LocationLine card={card} />
      </div>
    </article>
  )
}

export default function FabricComparison({ cards, title = '面料对比' }: {
  cards: FabricCardData[]
  title?: string
}) {
  if (!cards.length) return null
  return (
    <section className="fabric-comparison" aria-label={title}>
      <header className="fabric-comparison-head">
        <strong>{title}</strong>
        <span>{cards.length} 张 · 摘自资料原文</span>
      </header>
      <div className="fabric-grid" data-count={Math.min(cards.length, 3)}>
        {cards.map((card) => <FabricCard card={card} key={card.key} />)}
      </div>
    </section>
  )
}
