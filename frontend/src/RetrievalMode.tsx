import { useEffect, useState } from 'react'
import { Button, Select } from 'antd'
import { buildEmbeddingIndex, getEmbeddingIndex, type EmbeddingIndexStatus } from './api'
import type { RetrievalMode as Mode } from './types'

export const retrievalOptions: { value: Mode; label: string }[] = [
  { value: 'bm25', label: 'BM25（关键词）' },
  { value: 'embedding', label: 'Embedding（语义）' },
  { value: 'hybrid', label: 'Hybrid（关键词 + 语义）' },
]

export function RetrievalMode({ value, onChange, disabled }: {
  value: Mode; onChange: (value: Mode) => void; disabled?: boolean
}) {
  return <label><span>检索模式</span>
    <Select<Mode> aria-label="检索模式" value={value} onChange={onChange} disabled={disabled} options={retrievalOptions} />
  </label>
}

export function EmbeddingIndexControl({ sourceId, version, label, disabled }: {
  sourceId: string; version?: number; label?: string; disabled?: boolean
}) {
  const [index, setIndex] = useState<EmbeddingIndexStatus>()
  const [starting, setStarting] = useState(false)
  const building = index?.status === 'building'
  useEffect(() => {
    let active = true
    const cancel = new AbortController()
    async function refresh() {
      try {
        const status = await getEmbeddingIndex(sourceId, version, cancel.signal)
        if (active) setIndex(status)
      } catch (error) {
        if (active) setIndex({ status: 'failed', error: error instanceof Error ? error.message : '索引状态读取失败。' })
      }
    }
    void refresh()
    const timer = building ? window.setInterval(refresh, 1500) : undefined
    return () => { active = false; cancel.abort(); window.clearInterval(timer) }
  }, [sourceId, version, building])
  async function start() {
    setStarting(true)
    try { setIndex(await buildEmbeddingIndex(sourceId, version)) }
    catch (error) { setIndex({ status: 'failed', error: error instanceof Error ? error.message : '构建索引失败。' }) }
    finally { setStarting(false) }
  }
  return <div className="embedding-index" aria-live="polite">
    {label && <strong>{label} </strong>}
    {index?.status === 'ready' ? <span>向量索引已就绪</span> : <>
      {building ? <span>正在构建向量索引</span> : <>
        <Button size="small" disabled={disabled} loading={starting} onClick={() => void start()}>构建向量索引</Button>
        <small> 构建会将当前材料的片段发送至百炼。</small>
      </>}
      {index?.error && <p role="alert">{index.error}</p>}
    </>}
  </div>
}
