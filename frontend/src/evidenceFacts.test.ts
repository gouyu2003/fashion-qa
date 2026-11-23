import { describe, expect, it } from 'vitest'
import { careStatusOf, collectFabricCards, documentKind, parseFabric, parseTrend } from './evidenceFacts'
import type { SupportingEvidence } from './types'

const fab001 = `# 模拟面料卡 FAB-001

- **数据性质** 以下规格和洗护条件均为 Demo 模拟数据
- **卡号** FAB-001
- **资料版本** v1
- **面料名称** 棉混纺府绸
- **颜色** 乳白色
- **成分** 65% 棉、35% 聚酯纤维
- **克重** 125 g/m²
- **手感与透感** 微挺，透感低
- **洗护条件** 可机洗，最高 30°C，轻柔程序`

const fab003 = `# 模拟面料卡 FAB-003

- **卡号** FAB-003
- **面料** 轻薄棉平纹
- **成分** 100% 棉
- **颜色** 白色
- **克重** 110 g/m²
- **洗护条件** 是否可机洗、洗涤温度和洗涤程序均待供应商确认。`

const evidence = (text: string, filename: string, line_start = 1, line_end = 10): SupportingEvidence => ({
  sq_id: 'sq_1', text, source_title: filename, source_id: 'fashion', source_version: 1,
  filename, chunk_id: filename, line_start, line_end,
})

describe('document facts', () => {
  it('reads fabric fields only when the excerpt names both the card and the fabric', () => {
    const card = parseFabric(fab001, { sourceTitle: '02-模拟面料卡-FAB-001.md', sourceId: 'fashion', sourceVersion: 1,
      filename: '02-模拟面料卡-FAB-001.md', lineStart: 1, lineEnd: 11 })
    expect(card).toMatchObject({ code: 'FAB-001', name: '棉混纺府绸', color: '乳白色',
      composition: '65% 棉、35% 聚酯纤维', weight: '125 g/m²', careStatus: 'machine', simulated: true })
    expect(parseFabric('- **面料** 未编号的面料', { sourceTitle: 'x', filename: 'x.md' })).toBeUndefined()
  })

  it('separates machine wash, hand wash and pending care', () => {
    expect(careStatusOf('可机洗，最高 30°C，轻柔程序')).toBe('machine')
    expect(careStatusOf('仅手洗，最高 30°C。')).toBe('hand')
    expect(careStatusOf('是否可机洗、洗涤温度和洗涤程序均待供应商确认。')).toBe('pending')
    expect(careStatusOf(undefined)).toBe('pending')
  })

  it('merges excerpts from the same source, version and file into one card', () => {
    const cards = collectFabricCards([
      evidence(fab001, '02-模拟面料卡-FAB-001.md', 1, 11),
      evidence('- **克重** 125 g/m²\n- **洗护条件** 可机洗，最高 30°C', '02-模拟面料卡-FAB-001.md', 8, 9),
      evidence(fab003, '05-模拟面料卡-FAB-003.md', 1, 9),
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ code: 'FAB-001', weight: '125 g/m²', careStatus: 'machine' })
    expect(cards[1]).toMatchObject({ code: 'FAB-003', name: '轻薄棉平纹', careStatus: 'pending' })
    expect(cards[1].simulated).toBe(true)
  })

  it('reads trend publisher, season and palette', () => {
    const trend = parseTrend(`# Intertextile 上海面辅料展 2027 春夏趋势摘要

- **发布方** Intertextile 上海面辅料展官网
- **发布日期** 2025-12-19
- **适用季节** 2027 春夏
- **风格摘要** 简洁、舒适的都市着装。
- **配色摘要** 白色和乳白色作为底色，浅灰色用于过渡。
- **原文链接** [趋势稿](https://example.com/trend)`)
    expect(trend).toMatchObject({ publisher: 'Intertextile 上海面辅料展官网', publishedAt: '2025-12-19',
      season: '2027 春夏', palette: '白色和乳白色作为底色，浅灰色用于过渡。' })
    expect(trend.link).toBe('https://example.com/trend')
  })

  it('classifies files by name and content', () => {
    expect(documentKind('02-模拟面料卡-FAB-001.md')).toBe('fabric')
    expect(documentKind('01-上海面辅料展2027春夏趋势.md')).toBe('trend')
    expect(documentKind('notes.md', fab001)).toBe('fabric')
    expect(documentKind('notes.md', 'ordinary notes')).toBe('other')
  })
})
