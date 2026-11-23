import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Empty, Input, Modal, Pagination, Select, Skeleton, Tag } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getKnowledgeChunks, getKnowledgeSource, getKnowledgeSources,
  importKnowledge, deleteKnowledgeSource, KnowledgeImportError,
} from './api'
import type { ChunkPage, KnowledgeChunk, KnowledgeSource } from './types'
import KnowledgeSearch from './KnowledgeSearch'
import { FabricCard } from './FabricCard'
import { documentKind, hasTrendFacts, parseFabric, parseTrend } from './evidenceFacts'
import type { DocumentKind } from './evidenceFacts'

const STATUS = { importing: '处理中', ready: '可用', failed: '导入失败' }
const STATUS_COLOR = { importing: 'processing', ready: 'success', failed: 'error' } as const
const KIND_LABEL: Record<DocumentKind, string> = { trend: '趋势资料', fabric: '面料卡', other: '其他资料' }
const KIND_COLOR: Record<DocumentKind, string> = { trend: 'blue', fabric: 'green', other: 'default' }

function formatSize(bytes?: number) {
  if (!bytes) return undefined
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`
}

export default function KnowledgeView({ disabled, onChanged, onUse }: {
  disabled: boolean
  onChanged: () => Promise<void>
  onUse: (sourceId: string, version: number) => void
}) {
  const [items, setItems] = useState<KnowledgeSource[]>([])
  const [detail, setDetail] = useState<KnowledgeSource>()
  const [version, setVersion] = useState<number>()
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [inputKey, setInputKey] = useState(0)
  const [targetId, setTargetId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeSource>()
  const [importOpen, setImportOpen] = useState(false)
  const [fileTerm, setFileTerm] = useState('')
  const [fileKind, setFileKind] = useState<'all' | DocumentKind>('all')
  const locked = busy || deleting || disabled
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [chunks, setChunks] = useState<ChunkPage>()
  const [chunksLoading, setChunksLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [page, setPage] = useState(1)

  const openSource = useCallback(async (sourceId: string) => {
    try {
      const selected = await getKnowledgeSource(sourceId)
      setDetail(selected)
      setVersion(selected.current_version ?? selected.versions[0]?.version)
      setPage(1)
      setFileTerm('')
      setFileKind('all')
      setPreviewError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料加载失败')
    }
  }, [])

  const refresh = useCallback(async (sourceId?: string) => {
    setLoading(true)
    try {
      const listing = await getKnowledgeSources()
      setItems(listing.items)
      const target = sourceId ?? listing.items[0]?.source_id
      if (target) await openSource(target)
    } finally {
      setLoading(false)
    }
  }, [openSource])

  useEffect(() => {
    const controller = new AbortController()
    getKnowledgeSources(controller.signal).then(async (result) => {
      if (controller.signal.aborted) return
      setItems(result.items)
      const first = result.items[0]
      if (first) {
        const selected = await getKnowledgeSource(first.source_id).catch(() => undefined)
        if (!controller.signal.aborted && selected) {
          setDetail(selected)
          setVersion(selected.current_version ?? selected.versions[0]?.version)
        }
      }
    })
      .catch((reason: Error) => { if (reason.name !== 'AbortError') setError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const selectedVersion = detail?.versions.find((entry) => entry.version === version)
  const selectedReady = selectedVersion?.status === 'ready'
  useEffect(() => {
    setChunks(undefined)
    setPreviewError('')
    setChunksLoading(false)
    if (!detail || version === undefined || !selectedReady) return
    const controller = new AbortController()
    setChunksLoading(true)
    getKnowledgeChunks(detail.source_id, version, (page - 1) * 10, controller.signal)
      .then(result => { if (!controller.signal.aborted) setChunks(result) })
      .catch((reason: Error) => { if (reason.name !== 'AbortError') setPreviewError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setChunksLoading(false) })
    return () => controller.abort()
  }, [detail, version, page, selectedReady])

  const chunkItems = chunks?.items ?? []

  const docFacts = useMemo(() => {
    const map = new Map<string, { kind: DocumentKind; publisher?: string; season?: string }>()
    for (const chunk of chunkItems) {
      const kind = documentKind(chunk.filename, chunk.text)
      const trend = kind === 'trend' ? parseTrend(chunk.text) : undefined
      const current = map.get(chunk.filename)
      if (!current || current.kind === 'other') {
        map.set(chunk.filename, { kind, publisher: trend?.publisher, season: trend?.season })
      }
    }
    return map
  }, [chunkItems])

  const fileEntries = useMemo(() => {
    const declared = selectedVersion?.files ?? []
    const fromChunks = chunkItems.map((chunk) => chunk.filename)
    const names = declared.length ? declared.map(file => file.filename) : [...new Set(fromChunks)]
    return names.map((filename) => {
      const file = declared.find(item => item.filename === filename)
      const facts = docFacts.get(filename)
      return {
        filename,
        size: formatSize(file?.size_bytes),
        kind: facts?.kind ?? documentKind(filename),
        publisher: facts?.publisher,
        season: facts?.season,
        indexed: fromChunks.includes(filename),
      }
    })
  }, [selectedVersion, chunkItems, docFacts])

  const visibleFiles = fileEntries.filter(file =>
    (!fileTerm.trim() || file.filename.toLowerCase().includes(fileTerm.trim().toLowerCase()))
    && (fileKind === 'all' || file.kind === fileKind))

  const resetImport = () => { setFiles([]); setInputKey(value => value + 1) }

  async function handleImport() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const imported = await importKnowledge(name.trim(), files, targetId)
      await refresh(imported.source_id)
      await onChanged()
      setNotice(`已导入「${imported.name}」版本 ${imported.current_version}。`)
      resetImport()
      setImportOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败')
      if (reason instanceof KnowledgeImportError && reason.sourceId) {
        await refresh(reason.sourceId).catch(() => {})
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || locked) return
    const target = deleteTarget
    setDeleting(true); setError(''); setNotice('')
    try {
      await deleteKnowledgeSource(target.source_id)
      setItems(current => current.filter(item => item.source_id !== target.source_id))
      if (detail?.source_id === target.source_id) {
        setDetail(undefined); setVersion(undefined); setChunks(undefined); setPreviewError(''); setPage(1)
      }
      setTargetId(current => current === target.source_id ? undefined : current)
      setDeleteTarget(undefined)
      setNotice(`已删除「${target.name}」。已有系统快照和历史记录所需的材料仍保留。`)
      try { await onChanged() }
      catch { setError('资料来源已删除，但更新问答选项失败，请刷新页面。') }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败，请重试。')
      setDeleteTarget(undefined)
    } finally { setDeleting(false) }
  }

  function renderChunk(chunk: KnowledgeChunk) {
    const kind = documentKind(chunk.filename, chunk.text)
    const location = {
      sourceTitle: chunk.filename, sourceId: detail?.source_id, sourceVersion: version,
      filename: chunk.filename, lineStart: chunk.line_start, lineEnd: chunk.line_end, headingPath: chunk.heading_path,
    }
    if (kind === 'fabric') {
      const card = parseFabric(chunk.text, location)
      if (card) return <article className="knowledge-chunk" key={chunk.chunk_id}>
        <div className="knowledge-chunk-head">
          <div><strong>{chunk.filename}</strong>
            <small>第 {chunk.line_start}–{chunk.line_end} 行{chunk.heading_path.length ? ` · ${chunk.heading_path.join(' / ')}` : ''}</small>
          </div>
          <Tag color={KIND_COLOR.fabric} variant="filled">面料卡</Tag>
        </div>
        <FabricCard card={card} />
        <details><summary>查看资料原文</summary><p>{chunk.text}</p></details>
      </article>
    }
    const trend = kind === 'trend' ? parseTrend(chunk.text) : undefined
    return <article className="knowledge-chunk" key={chunk.chunk_id}>
      <div className="knowledge-chunk-head">
        <div><strong>{chunk.filename}</strong>
          <small>第 {chunk.line_start}–{chunk.line_end} 行{chunk.heading_path.length ? ` · ${chunk.heading_path.join(' / ')}` : ''}</small>
        </div>
        <Tag color={KIND_COLOR[kind]} variant="filled">{KIND_LABEL[kind]}</Tag>
      </div>
      {trend && hasTrendFacts(trend) ? <div className="knowledge-trend">
        <dl>
          {trend.season ? <div><dt>适用季节</dt><dd>{trend.season}</dd></div> : null}
          {trend.publisher ? <div><dt>发布方</dt><dd>{trend.publisher}</dd></div> : null}
          {trend.publishedAt ? <div><dt>发布日期</dt><dd>{trend.publishedAt}</dd></div> : null}
        </dl>
      </div> : null}
      {kind === 'trend'
        ? <div className="knowledge-chunk-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.text}</ReactMarkdown></div>
        : <p>{chunk.text}</p>}
    </article>
  }

  return (
    <main className="knowledge-workspace">
      <header className="knowledge-head">
        <div>
          <span className="section-kicker">MATERIAL LIBRARY</span>
          <h1>资料库</h1>
          <p>先选资料来源与版本，再核对文件清单、分页片段和索引状态。</p>
        </div>
        <div className="knowledge-head-actions">
          <Button type="primary" disabled={busy || loading} onClick={() => { setImportOpen(true); setError(''); setNotice('') }}>导入资料</Button>
          <Button disabled={busy || loading} onClick={() => void refresh(detail?.source_id).catch((reason: Error) => setError(reason.message))}>刷新</Button>
        </div>
      </header>

      {error && !importOpen ? <Alert type="error" showIcon message="资料库操作失败" description={error} closable onClose={() => setError('')} /> : null}
      {notice ? <Alert type="success" showIcon message={notice} closable onClose={() => setNotice('')} /> : null}
      {disabled ? <Alert type="info" message="问答正在运行，完成后可导入、删除或切换资料。" /> : null}

      <div className="knowledge-layout">
        <aside className="knowledge-rail" aria-label="资料来源与版本">
          <div className="knowledge-rail-head"><h2>资料来源</h2><span>{items.length}</span></div>
          {loading && !items.length ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
          {items.length ? <div className="knowledge-source-list">
            {items.map((item) => (
              <button type="button" key={item.source_id} disabled={busy || deleting}
                className={detail?.source_id === item.source_id ? 'active' : ''}
                aria-pressed={detail?.source_id === item.source_id}
                onClick={() => { void openSource(item.source_id) }}>
                <strong>{item.name}</strong>
                <span>{STATUS[item.status]} · 可用版本 {item.current_version ?? '无'} · {item.file_count} 个文件 · {item.chunk_count} 个片段</span>
              </button>
            ))}
          </div> : !loading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有用户资料，请先导入材料。" /> : null}

        </aside>

        <section className="knowledge-browser" aria-label="资料详情">
          {!detail ? <div className="knowledge-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一份资料来源，查看版本、文件与片段。" />
          </div> : <>
            <div className="knowledge-detail-head">
              <div>
                <h2>{detail.name}</h2>
                <p>来源 {detail.source_id} · 当前版本 {detail.current_version ?? '无'}</p>
              </div>
              <div className="knowledge-detail-actions">
                <Tag color={STATUS_COLOR[detail.status]}>{STATUS[detail.status]}</Tag>
                <Button type="primary" disabled={locked || !selectedReady || Boolean(previewError) || chunksLoading}
                  onClick={() => { if (version !== undefined) onUse(detail.source_id, version) }}>用于实时运行</Button>
                <Button danger disabled={locked || loading || detail.versions.some(entry => entry.status === 'importing')}
                  onClick={() => setDeleteTarget(detail)}>删除资料</Button>
              </div>
            </div>

            <div className="knowledge-version">
              <label>材料版本
                <Select aria-label="材料版本" disabled={busy || deleting} value={version}
                  options={detail.versions.map((entry) => ({ value: entry.version, label: `版本 ${entry.version} · ${STATUS[entry.status]}` }))}
                  onChange={(value) => { setVersion(value); setPage(1) }} />
              </label>
              <p>索引：{selectedVersion?.index_version ?? '未记录'} · 分词：{selectedVersion?.tokenizer ?? '未记录'}。旧索引保留，如需中文支持请导入新版本。</p>
            </div>

            {selectedVersion?.error ? <Alert type="error" message={selectedVersion.error.code} description={selectedVersion.error.message} /> : null}
            {detail.versions.some(entry => entry.status === 'importing') ? <p className="knowledge-detail-note">正在导入，完成后可删除此资料。</p> : null}

            <div className="knowledge-facts" aria-label="版本索引状态">
              <div><span>版本</span><strong>{version ?? '—'}</strong></div>
              <div><span>文件</span><strong>{selectedVersion?.file_count ?? detail.file_count}</strong></div>
              <div><span>片段</span><strong>{selectedVersion?.chunk_count ?? detail.chunk_count}</strong></div>
              <div><span>索引状态</span><strong>{selectedReady ? (selectedVersion?.index_version ? '已建立' : '待建立') : '未就绪'}</strong></div>
              <div><span>分词</span><strong>{selectedVersion?.tokenizer ?? '未记录'}</strong></div>
            </div>

            <section className="knowledge-section" aria-label="文件清单">
              <div className="knowledge-section-head">
                <h3>文件清单 <small>{visibleFiles.length} / {fileEntries.length}</small></h3>
                <div className="knowledge-file-tools">
                  <Input aria-label="按名称筛选文件" placeholder="按名称筛选" allowClear value={fileTerm}
                    onChange={(event) => setFileTerm(event.target.value)} />
                  <Select aria-label="按类型筛选文件" value={fileKind}
                    onChange={(value) => setFileKind(value)}
                    options={[{ value: 'all', label: '全部类型' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} />
                </div>
              </div>
              {visibleFiles.length ? <ul className="knowledge-file-list">
                {visibleFiles.map(file => <li key={file.filename} className={file.indexed ? 'is-indexed' : ''}>
                  <div className="knowledge-file-main">
                    <strong>{file.filename}</strong>
                    <small>
                      {[file.season ? `季节 ${file.season}` : undefined, file.publisher ? `发布方 ${file.publisher}` : undefined, file.size].filter(Boolean).join(' · ') || '未记录季节与发布方'}
                    </small>
                  </div>
                  <div className="knowledge-file-side">
                    <Tag color={KIND_COLOR[file.kind]} variant="filled">{KIND_LABEL[file.kind]}</Tag>
                    {file.indexed ? <Tag>已索引</Tag> : null}
                  </div>
                </li>)}
              </ul> : <p className="knowledge-empty-note">没有符合筛选条件的文件。</p>}
            </section>

            <section className="knowledge-section" aria-label="分页片段">
              <div className="knowledge-section-head">
                <h3>片段预览</h3>
                <small>{chunks ? `共 ${chunks.total} 段${chunks.total ? ` · 当前第 ${(page - 1) * 10 + 1}–${Math.min(page * 10, chunks.total)} 段` : ''}` : '等待索引'}</small>
              </div>
              {previewError ? <Alert type="error" message={previewError} /> : null}
              {chunksLoading && selectedReady ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
              {!chunksLoading && chunks && !chunks.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个版本没有可预览的片段。" /> : null}
              <div className="knowledge-chunks">
                {!chunksLoading ? chunkItems.map(renderChunk) : null}
              </div>
              {chunks && chunks.total > 10 ? <Pagination current={page} total={chunks.total} pageSize={10} showSizeChanger={false} onChange={setPage} /> : null}
            </section>

            {selectedReady && version !== undefined && <KnowledgeSearch key={`${detail.source_id}-${version}`} sourceId={detail.source_id} version={version} />}
          </>}
        </section>
      </div>

      <Drawer title="导入资料" open={importOpen} size="min(460px, 100vw)" onClose={() => setImportOpen(false)} destroyOnHidden>
        <div className="knowledge-import-form">
          <p>导入中文、英文或混合的 UTF-8 TXT/MD 文件。每份资料可包含多个文件，用同一组材料进行问答。</p>
          <label>导入目标
            <Select aria-label="导入目标" value={targetId ?? 'new'} disabled={locked}
              options={[{ value: 'new', label: '创建新资料' }, ...items.map((item) => ({ value: item.source_id, label: `${item.name}：导入新版本` }))]}
              onChange={(value) => setTargetId(value === 'new' ? undefined : value)} />
          </label>
          {!targetId ? <label>资料名称<Input aria-label="知识源名称" maxLength={100} value={name}
            onChange={(event) => setName(event.target.value)} disabled={locked} /></label> : <p>新版本需上传整套文件；已有版本继续保留。</p>}
          <label>材料文件<input key={inputKey} type="file" aria-label="材料文件" accept=".txt,.md" multiple disabled={locked}
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
          <small>最多 10 个文件；单文件 2 MiB；总计 10 MiB。</small>
          {files.length > 0 ? <ul>{files.map((file, i) => <li key={i}>{file.name} · {(file.size / 1024).toFixed(1)} KiB</li>)}</ul> : null}
          {error && importOpen ? <Alert type="error" showIcon message="导入失败" description={error} /> : null}
          <Button type="primary" block loading={busy} disabled={locked || !files.length || (!targetId && !name.trim())} onClick={handleImport}>
            {busy ? '正在解析并建索引' : '导入材料'}
          </Button>
        </div>
      </Drawer>

      <Modal title="删除资料" open={Boolean(deleteTarget)} okText="确认删除" cancelText="取消"
        okButtonProps={{ danger: true, disabled: locked }} confirmLoading={deleting}
        cancelButtonProps={{ disabled: deleting }} closable={!deleting} keyboard={!deleting}
        mask={{ closable: !deleting }} onCancel={() => { if (!deleting) setDeleteTarget(undefined) }}
        onOk={() => void handleDelete()}>
        <p>确定删除「{deleteTarget?.name}」及其全部版本的可选入口吗？删除后，它将从资料列表及新配置选项中移除，也不能再导入新版本。</p>
        <p>已有系统快照及历史记录所需的固定版本材料仍会保留在本地，不会清除。这项操作不会修改已有系统配置。</p>
      </Modal>
    </main>
  )
}
