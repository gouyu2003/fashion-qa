import { Tag } from 'antd'
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

const CARE_TONE: Record<CareStatus, { color: string; tone: string }> = {
  machine: { color: 'success', tone: 'ok' },
  hand: { color: 'warning', tone: 'warn' },
  pending: { color: 'default', tone: 'pending' },
}

function careDetail(care?: string) {
  if (!care) return '资料未给出洗护条件'
  return care.replace(/^[。；;,\s]+/, '').trim()
}

function LocationLine({ card }: { card: FabricCardData }) {
  const parts = [
    card.filename ?? card.sourceTitle,
    card.sourceVersion !== undefined ? `版本 ${card.sourceVersion}` : undefined,
    card.lineStart !== undefined ? `第 ${card.lineStart}–${card.lineEnd ?? card.lineStart} 行` : undefined,
  ].filter(Boolean)
  return <small className="fabric-source">{parts.join(' · ')}</small>
}

export function FabricCard({ card }: { card: FabricCardData }) {
  const swatch = card.color ? SWATCHES[card.color] : undefined
  return (
    <article className="fabric-card" aria-label={`面料 ${card.code}`}>
      <header className="fabric-card-head">
        <div>
          <span className="fabric-code">{card.code}</span>
          <strong>{card.name}</strong>
        </div>
        {card.simulated ? <Tag className="fabric-simulated">模拟数据</Tag> : null}
      </header>

      <dl className="fabric-specs">
        <div className="fabric-color">
          <dt>颜色</dt>
          <dd>
            {card.color ? (
              <>
                <span
                  className={`fabric-swatch${swatch ? '' : ' is-placeholder'}`}
                  style={swatch ? { background: swatch } : undefined}
                  aria-hidden="true"
                />
                {card.color}
              </>
            ) : '未记录'}
          </dd>
        </div>
        <div>
          <dt>成分</dt>
          <dd>{card.composition ?? '未记录'}</dd>
        </div>
        <div>
          <dt>克重</dt>
          <dd>{card.weight ?? '未记录'}</dd>
        </div>
        <div className="fabric-care">
          <dt>洗护</dt>
          <dd>
            <Tag color={CARE_TONE[card.careStatus].color} className={`fabric-care-tag is-${CARE_TONE[card.careStatus].tone}`}>
              {CARE_LABELS[card.careStatus]}
            </Tag>
            <span>{careDetail(card.care)}</span>
          </dd>
        </div>
      </dl>

      {card.handfeel || card.sheerness ? (
        <p className="fabric-extra">
          {card.handfeel ? `手感 ${card.handfeel}` : ''}
          {card.handfeel && card.sheerness ? ' · ' : ''}
          {card.sheerness ? `透感 ${card.sheerness}` : ''}
        </p>
      ) : null}
      <LocationLine card={card} />
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
