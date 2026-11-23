import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert, Button, Drawer, Dropdown, Input, Modal, Select, Skeleton, Tag } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { DeleteOutlined, EditOutlined, EllipsisOutlined, PlusOutlined } from '@ant-design/icons'
import { ArrowUp, ArrowUpRight, BookOpen, FileText, Layers, PanelLeft, Square } from 'lucide-react'
import AnswerContent from './AnswerContent'
import CitationPanel, { citationPanelId } from './CitationPanel'
import FabricComparison from './FabricCard'
import { collectFabricCards, documentKind } from './evidenceFacts'
import { cancelBackgroundRun, followBackgroundRun, getManagedSystems, getRunDetail } from './api'
import { RunDetailPanel } from './HistoryView'
import { ChatApiError, clearPendingChat, createConversation, deleteConversation, getChatMessages, getConversation, listConversations,
  readPendingChat, renameConversation, savePendingChat, sendChatMessage } from './chatApi'
import type { ChatMessage, Conversation, PendingChat, ChatSelection } from './chatApi'
import type { ManagedSystem, StoredRunDetail, SystemDocument } from './types'
import './chat.css'

const statusLabel = { running: '执行中', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '执行中断' }
const draftKey = (id?: string) => `maqa.chat.composer.${id || 'new'}`
const errorText = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。'
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'
const refLabel = (ref: Conversation['system_ref']) => `${ref.name} · ${ref.kind === 'draft' ? `草稿 r${ref.draft_revision}` : ref.system_version}`

const EXAMPLES = [
  {
    key: 'trend',
    scene: '趋势研判',
    title: '查本季趋势',
    hint: '通勤方向的风格与配色依据',
    question: '2027 春夏通勤女装的趋势方向是什么？有哪些风格和配色依据？',
  },
  {
    key: 'fabric',
    scene: '选料比对',
    title: '比较衬衫面料',
    hint: '成分、克重与手感的取舍',
    question: '从资料里的面料卡中挑两款适合做通勤衬衫的，比较成分、克重和手感。',
  },
  {
    key: 'care',
    scene: '供应链核实',
    title: '核对洗护条件',
    hint: '可机洗、仅手洗还是待确认',
    question: '资料里的面料，哪些可以机洗？哪些只能手洗，或者仍需供应商确认？',
  },
]
const CARE_FOLLOW_UP = '刚才比较的面料中，哪些可以机洗？哪些只能手洗，或者仍需供应商确认？'
const SUPPLIER_FOLLOW_UP = { title: '整理供应商核实清单', question: '把刚才仍待确认的洗护条件整理成一份供应商核实清单，并标出对应面料。' }

function runnableVersions(system: ManagedSystem) {
  return system.versions.filter((doc) => Boolean(doc.version) && !!doc.snapshot.workflow_spec && !doc.snapshot.configuration_errors?.length)
}

function latestVersion(system?: ManagedSystem) {
  if (!system) return undefined
  const runnable = runnableVersions(system)
  if (runnable.length) return runnable[0].version
  return system.versions[0]?.version ?? `draft:${system.draft_revision}`
}

function snapshotSources(snapshot?: SystemDocument['snapshot']) {
  if (!snapshot) return [] as string[]
  if (snapshot.sources) {
    return [...new Set(Object.values(snapshot.sources).map((source) => `${source.name}${source.version ? ` · v${source.version}` : ''}`))]
  }
  return snapshot.source ? [`${snapshot.source.name}${snapshot.source.version ? ` · v${snapshot.source.version}` : ''}`] : []
}

function useDesktopColumn(query: string) {
  const [visible, setVisible] = useState(() => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches))
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia(query)
    const update = () => setVisible(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return visible
}

function demoFollowUps(messages: ChatMessage[], answer: ChatMessage | undefined) {
  if (answer?.role !== 'assistant' || answer.status !== 'completed' || !answer.content || answer.context.intent === 'clarification') return []
  const asked = new Set(messages.filter(message => message.role === 'user').map(message => message.content))
  if (asked.has(SUPPLIER_FOLLOW_UP.question)) return []
  const [, fabric, care] = EXAMPLES
  if (asked.has(care.question) || asked.has(CARE_FOLLOW_UP)) return [SUPPLIER_FOLLOW_UP]
  const kinds = answer.result.supporting_evidence?.map(item => documentKind(item.filename, item.text)) ?? []
  if (asked.has(fabric.question) || kinds.includes('fabric')) return [{ ...care, question: CARE_FOLLOW_UP }]
  if (asked.has(EXAMPLES[0].question) || kinds.includes('trend')) return [fabric, care]
  return []
}

function MessageBody({ message, onDetail, onCitations, citationsOpen, activeCitation, followUps, onFollowUp }: {
  message: ChatMessage
  onDetail: (id: string) => void
  onCitations: (message: ChatMessage, trigger: HTMLElement, index?: number) => void
  citationsOpen: boolean
  activeCitation?: number
  followUps: { title: string; question: string }[]
  onFollowUp: (text: string) => void
}) {
  const cards = message.result?.verified === true ? collectFabricCards(message.result.supporting_evidence) : []
  const citationCount = message.result?.supporting_evidence?.length ?? 0
  return <article className={`chat-message chat-message--${message.role}`} aria-label={`${message.role === 'user' ? '你' : '助手'}第 ${message.turn_index} 轮`}>
    <div className="chat-message-label">{message.role === 'user' ? '你' : '服装企划助手'}</div>
    <div className="chat-message-content">
      {message.role === 'user' ? <p className="chat-user-text">{message.content}</p> : <>
        {message.content || citationCount > 0 ? <AnswerContent result={message.result} content={message.content} intent={message.context.intent}
            showStatus={message.status === 'completed' || !!message.result.response_parts?.length}
            onCitationSelect={(index, trigger) => onCitations(message, trigger, index)} activeCitation={activeCitation} />
          : <p className="chat-muted">{message.status === 'running' ? '正在拆解问题并核对资料…' : message.error || '本轮未生成回答。'}</p>}
        {message.status === 'completed' && cards.length ? <FabricComparison cards={cards} /> : null}
        {message.error && message.content ? <Alert type="error" title={message.error} /> : null}
        <div className="chat-answer-actions">
          {message.status !== 'completed' ? <Tag>{statusLabel[message.status]}</Tag> : null}
          <Button type="text" size="small" className="chat-answer-action" onClick={event => onCitations(message, event.currentTarget)}
            aria-expanded={citationsOpen} aria-controls={citationsOpen ? citationPanelId : undefined} disabled={!citationCount}>
            <span>查看引用</span>{citationCount ? <span className="chat-action-count">{citationCount}</span> : null}
          </Button>
          <Button type="text" size="small" className="chat-answer-action" onClick={() => onDetail(message.run_id)}>
            本轮运行
          </Button>
        </div>
        {followUps.length ? <section className="chat-followups" aria-label="下一步追问">
          <h3>下一步追问</h3>
          <ul>{followUps.map(example => <li key={example.question}>
            <button type="button" onClick={() => onFollowUp(example.question)}>{example.title}<ArrowUpRight size={13} aria-hidden="true" /></button>
          </li>)}</ul>
        </section> : null}
      </>}
    </div>
  </article>
}

export default function ChatView() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const routeRef = useRef(conversationId)
  const chatLoadGeneration = useRef(0)
  routeRef.current = conversationId
  const [list, setList] = useState<Conversation[]>([])
  const [systems, setSystems] = useState<ManagedSystem[]>([])
  const [systemId, setSystemId] = useState<string>()
  const [version, setVersion] = useState<string>()
  const [conversation, setConversation] = useState<Conversation>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [systemsError, setSystemsError] = useState('')
  const [busyRun, setBusyRun] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const submissionRef = useRef(false)
  const [pending, setPending] = useState<PendingChat>()
  const [progress, setProgress] = useState('正在启动')
  const [connection, setConnection] = useState('')
  const [stopping, setStopping] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [citationSelection, setCitationSelection] = useState<{ messageId: string; index?: number }>()
  const [editing, setEditing] = useState<Conversation>()
  const [title, setTitle] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [deleting, setDeleting] = useState<Conversation>()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [detailId, setDetailId] = useState<string>()
  const [detail, setDetail] = useState<StoredRunDetail>()
  const [detailError, setDetailError] = useState('')
  const [reload, setReload] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<TextAreaRef>(null)
  const followBottom = useRef(true)
  const readingPosition = useRef(0)
  const citationTrigger = useRef<HTMLElement>(null)
  const desktopSidebar = useDesktopColumn('(min-width: 1025px)')
  const inlineCitations = useDesktopColumn('(min-width: 1280px)')
  const citationMessage = messages.find(message => message.message_id === citationSelection?.messageId)

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    try { setList((await listConversations(signal)).items); setListError('') }
    catch (e) { if (!isAbort(e)) setListError(errorText(e)) }
  }, [])
  const refreshSystems = useCallback(async (signal?: AbortSignal) => {
    try { const data = await getManagedSystems(signal); if (!signal?.aborted) { setSystems(data.items); setSystemsError('') } }
    catch (e) { if (!isAbort(e)) setSystemsError(errorText(e)) }
  }, [])
  const loadChat = useCallback(async (id: string, signal?: AbortSignal) => {
    const generation = ++chatLoadGeneration.current
    const [doc, history] = await Promise.all([getConversation(id, signal), getChatMessages(id, signal)])
    if (routeRef.current === id && generation === chatLoadGeneration.current && !signal?.aborted) {
      setConversation(doc); setMessages(history.items)
    }
  }, [])

  const performSubmit = useCallback(async (saved: PendingChat, origin?: string) => {
    if (submissionRef.current) return
    submissionRef.current = true
    setSubmitting(true); setError(''); setBusyRun(undefined)
    let request = { ...saved }
    savePendingChat(request, origin)
    try {
      if (!request.conversationId) {
        const created = await createConversation(request.selection, request.createId)
        request = { ...request, conversationId: created.conversation_id }
        savePendingChat(request, origin)
      }
      await sendChatMessage(request.conversationId!, request.question, request.requestId)
      clearPendingChat(request, origin)
      localStorage.removeItem(draftKey(origin))
      void refreshList()
      if (routeRef.current === origin) {
        setPending(undefined); setQuestion(''); followBottom.current = true
        if (origin && origin === request.conversationId) { await loadChat(origin); setReload(n => n + 1) }
        else navigate(`/chat/${request.conversationId}`)
      }
    } catch (e) {
      if (routeRef.current === origin) {
        if (e instanceof ChatApiError && e.status < 500) {
          clearPendingChat(request, origin); setPending(undefined); setBusyRun(e.activeRunId)
        } else { setPending(request) }
        setError(errorText(e))
      }
    } finally { submissionRef.current = false; setSubmitting(false) }
  }, [loadChat, navigate, refreshList])

  useEffect(() => {
    const ctrl = new AbortController()
    void refreshList(ctrl.signal)
    void refreshSystems(ctrl.signal)
    const onFocus = () => {
      void refreshList()
      if (routeRef.current) void loadChat(routeRef.current).catch(e => setError(errorText(e)))
    }
    window.addEventListener('focus', onFocus)
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith('maqa.chat.pending.')) onFocus() }
    window.addEventListener('storage', onStorage)
    return () => { ctrl.abort(); window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage) }
  }, [loadChat, refreshList, refreshSystems])

  useEffect(() => {
    const ctrl = new AbortController()
    setConversation(undefined); setMessages([]); setError(''); setBusyRun(undefined); setConnection(''); setStopping(false)
    setCitationSelection(undefined)
    setQuestion(localStorage.getItem(draftKey(conversationId)) || '')
    followBottom.current = true
    const saved = readPendingChat(conversationId)
    setPending(saved)
    if (saved) { setQuestion(saved.question); void performSubmit(saved, conversationId) }
    void refreshList(ctrl.signal)
    if (conversationId) {
      setLoading(true)
      loadChat(conversationId, ctrl.signal).catch(e => { if (!isAbort(e) && routeRef.current === conversationId) setError(errorText(e)) })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    } else { setLoading(false) }
    return () => ctrl.abort()
  }, [conversationId, loadChat, performSubmit, refreshList, reload])

  const activeRun = conversation?.active_run_id
  useEffect(() => {
    if (!activeRun || !conversationId) return
    const ctrl = new AbortController()
    setProgress('正在启动'); setConnection('')
    void followBackgroundRun(activeRun, event => {
      if (ctrl.signal.aborted || routeRef.current !== conversationId || event.run_id !== activeRun) return
      if (event.type === 'run_connection') setConnection('连接中断，正在重新连接；后台任务继续执行。')
      else setConnection('')
      if (event.type === 'node_started') setProgress(`正在执行：${String(event.payload.agent_name || event.payload.node || '智能体')}`)
      if (['run_completed', 'run_failed', 'run_cancelled'].includes(event.type)) {
        void loadChat(conversationId, ctrl.signal).catch(e => { if (!isAbort(e)) setError(errorText(e)) })
        void refreshList(ctrl.signal); setStopping(false)
      }
    }, ctrl.signal).catch(e => { if (!isAbort(e)) setError(errorText(e)) })
    return () => ctrl.abort()
  }, [activeRun, conversationId, loadChat, refreshList])

  useEffect(() => {
    if (scroller.current && !messages.length) scroller.current.scrollTop = 0
    else if (followBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages, progress])

  useEffect(() => {
    if (!detailId) return
    const ctrl = new AbortController()
    setDetail(undefined); setDetailError('')
    getRunDetail(detailId, ctrl.signal).then(value => { if (!ctrl.signal.aborted) setDetail(value) }).catch(e => { if (!isAbort(e)) setDetailError(errorText(e)) })
    return () => ctrl.abort()
  }, [detailId])

  const runnableSystems = useMemo(() => systems.filter((item) => runnableVersions(item).length), [systems])
  const activeSystemId = systemId ?? (runnableSystems.length === 1 ? runnableSystems[0].system_id : undefined)
  const system = systems.find((item) => item.system_id === activeSystemId)
  const activeVersion = version ?? latestVersion(system)
  const versionOptions: { value: string; label: string; disabled?: boolean }[] = system ? [
    ...system.versions.map(doc => ({ value: doc.version!, label: `发布版本 ${doc.version}${runnableVersions(system)[0]?.version === doc.version ? '（最新）' : ''}` })),
    { value: `draft:${system.draft_revision}`, label: `已保存草稿 r${system.draft_revision}`, disabled: !system.draft.snapshot.workflow_spec || !!system.draft.snapshot.configuration_errors?.length },
  ] : []
  const selectedDoc = system && (activeVersion?.startsWith('draft:') ? system.draft : system.versions.find(doc => doc.version === activeVersion))
  const activeDocRunnable = !!selectedDoc && !!selectedDoc.snapshot.workflow_spec && !selectedDoc.snapshot.configuration_errors?.length
  const selection: ChatSelection | undefined = activeSystemId && activeVersion && activeDocRunnable ? { system_id: activeSystemId,
    ...(activeVersion.startsWith('draft:') ? { draft_revision: Number(activeVersion.slice(6)) } : { system_version: activeVersion }) } : undefined
  const snapshot = conversationId ? conversation?.config_snapshot : selectedDoc?.snapshot
  const sourceNames = snapshotSources(snapshot)
  const sourceStatus = sourceNames.length ? `已绑定 ${sourceNames.length} 个知识源` : '尚未绑定知识源'
  const composerDisabled = submitting || !!pending || loading || (!!conversationId && !conversation)
  const latestMessage = messages.at(-1)
  const followUps = composerDisabled ? [] : demoFollowUps(messages, latestMessage)
  const noRunnableConfig = !!systems.length && !runnableSystems.length
  const shownSystemName = conversation ? refLabel(conversation.system_ref) : system
    ? `${system.draft.name} · ${activeVersion?.startsWith('draft:') ? `草稿 r${activeVersion.slice(6)}` : activeVersion ?? '未选择版本'}`
    : '未选择系统'

  function pickSystem(id: string) {
    setSystemId(id)
    setVersion(latestVersion(systems.find(item => item.system_id === id)))
    setError('')
  }

  function updateQuestion(text: string) {
    setQuestion(text)
    localStorage.setItem(draftKey(conversationId), text)
  }

  function fillExample(text: string) {
    updateQuestion(text)
    composer.current?.focus()
  }

  function openCitations(message: ChatMessage, trigger: HTMLElement, index?: number) {
    readingPosition.current = scroller.current?.scrollTop ?? 0
    citationTrigger.current = trigger
    setCitationSelection({ messageId: message.message_id, index })
  }

  function closeCitations() {
    setCitationSelection(undefined)
    const top = readingPosition.current
    requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = top
      citationTrigger.current?.focus({ preventScroll: true })
    })
  }

  function submit(text = question) {
    if (!text.trim() || activeRun || composerDisabled || submissionRef.current) return
    const frozenSelection = conversation ? { system_id: conversation.system_ref.system_id,
      ...(conversation.system_ref.kind === 'draft' ? { draft_revision: conversation.system_ref.draft_revision } : { system_version: conversation.system_ref.system_version }) } : selection
    if (!frozenSelection) { setError('请先选择一个可运行的系统与版本。'); return }
    const request: PendingChat = { createId: crypto.randomUUID(), requestId: crypto.randomUUID(), conversationId,
      question: text.trim(), selection: frozenSelection }
    setPending(request); void performSubmit(request, conversationId)
  }

  const sidebar = <div className="chat-sidebar-content">
    <Button icon={<PlusOutlined />} className="chat-new" disabled={!conversationId && (submitting || !!pending)} onClick={() => {
      localStorage.removeItem(draftKey()); setQuestion(''); setSidebarOpen(false)
      if (conversationId) navigate('/chat'); else { setSystemId(undefined); setVersion(undefined); setError('') }
    }}>新问答</Button>
    <section className="chat-bound-sources" aria-label="当前知识源">
      <div className="chat-rail-heading">
        <h2><BookOpen size={15} aria-hidden="true" />当前知识源</h2>
        {sourceNames.length ? <span>{sourceNames.length}</span> : null}
      </div>
      {sourceNames.length ? <ul>
        {sourceNames.map(name => <li key={name}><FileText size={15} aria-hidden="true" /><span>{name}</span></li>)}
      </ul> : <p className="chat-muted">{conversationId || activeSystemId ? '暂无已绑定的资料。' : '选择问答系统后查看绑定资料。'}</p>}
    </section>
    <h2>最近会话</h2>
    {listError ? <Alert type="error" title={listError} action={<Button size="small" onClick={() => void refreshList()}>重试</Button>} /> : null}
    <nav className="chat-conversations" aria-label="聊天会话">
      {!list.length ? <p className="chat-muted">发送第一个问题后，会话会保存在这里。</p> : list.map(item => <div className={`chat-conversation ${item.conversation_id === conversationId ? 'is-selected' : ''}`} key={item.conversation_id}>
        <Link to={`/chat/${item.conversation_id}`} onClick={() => setSidebarOpen(false)} aria-current={item.conversation_id === conversationId ? 'page' : undefined}>
          <strong>{item.title}</strong><small>{item.active_run_id ? '运行中 · ' : ''}{item.preview || '尚未发送消息'}</small>
          <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString('zh-CN')}</time>
        </Link>
        <Dropdown menu={{ items: [{ key: 'rename', label: '重命名', icon: <EditOutlined /> }, { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }], onClick: ({ key }) => {
          if (key === 'rename') { setEditing(item); setTitle(item.title) } else setDeleting(item)
        } }} trigger={['click']}><Button type="text" size="small" icon={<EllipsisOutlined />} aria-label={`管理会话 ${item.title}`} /></Dropdown>
      </div>)}
    </nav>
  </div>

  return <main className="chat-workspace" aria-label="服装企划问答">
    <aside className="chat-sidebar">{sidebar}</aside>
    <section className="chat-main">
      <header className="chat-header">
        <Button className="chat-mobile-menu" type="text" icon={<PanelLeft size={18} aria-hidden="true" />} aria-label="打开会话列表"
          aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)} />
        <div className="chat-header-copy">
          <h1>{conversation?.title || '新的问答'}</h1>
          <p>{conversation ? refLabel(conversation.system_ref) : shownSystemName}</p>
        </div>
        <div className="chat-header-scope">
          <details>
            <summary>资料范围{sourceNames.length ? ` · ${sourceNames.length} 项` : ''}</summary>
            <div>
              <p><span>系统</span><strong>{conversation ? refLabel(conversation.system_ref) : shownSystemName}</strong></p>
              <p><span>资料</span><strong>{sourceNames.join('、') || '尚未绑定资料'}</strong></p>
              <p><span>协议</span><strong>{snapshot?.protocol?.protocol_name || snapshot?.workflow_spec?.protocol_id || '按所选系统版本'}</strong></p>
              {conversation ? <p><span>策略</span><strong>{conversation.chat_policy_version || '原有策略'}</strong></p> : null}
            </div>
          </details>
        </div>
      </header>

      <div className="chat-messages" ref={scroller} onScroll={() => {
        const el = scroller.current; if (el) followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
      }}>
        {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : !messages.length ? <div className="chat-welcome">
          <div className="chat-welcome-copy">
            <span className="chat-welcome-season">2027 春夏 · 通勤女装</span>
            <h2>从趋势到面料，<br />让企划有据可查。</h2>
            <p>查风格与配色、比较衬衫面料，或核对洗护条件。</p>
          </div>

          {!conversationId ? <section className="chat-scope" aria-label="本次问答范围">
            <header><strong>本次问答范围</strong><Tag>创建后版本固定</Tag></header>
            {systemsError ? <Alert type="error" title={systemsError} action={<Button size="small" onClick={() => void refreshSystems()}>重试加载系统</Button>} /> : null}
            {systems.length ? <>
              <div className="chat-scope-fields">
                <label>问答系统
                  <Select aria-label="问答系统" placeholder={runnableSystems.length > 1 ? '有多套系统，请选择一套' : '选择我的系统'}
                    value={activeSystemId} disabled={submitting || !!pending}
                    options={systems.map(item => ({ value: item.system_id, label: runnableVersions(item).length ? item.draft.name : `${item.draft.name}（无可用发布版本）`, disabled: !runnableVersions(item).length }))}
                    onChange={pickSystem} />
                </label>
                <label>系统版本
                  <Select aria-label="系统版本" placeholder="选择版本" value={activeVersion} disabled={!activeSystemId || submitting || !!pending}
                    options={versionOptions} onChange={setVersion} />
                </label>
              </div>
              {selectedDoc?.snapshot.configuration_errors?.length ? <p className="chat-scope-note">这个版本尚不可运行，请到<Link to="/systems">我的系统</Link>完成配置后重新选择。</p> : null}
              {noRunnableConfig ? <p className="chat-scope-note">没有可运行的已发布版本。<Link to="/systems">去我的系统配置</Link></p> : null}
              {runnableSystems.length > 1 && !activeSystemId ? <p className="chat-scope-note">有多套可运行系统，请先选择一套再提问。</p> : null}
            </> : !systemsError ? <p className="chat-scope-note">还没有可选择的系统。<Link to="/systems">去我的系统配置</Link></p> : null}
          </section> : null}

          <div className="chat-examples" aria-label="示例问题">
            <h3>从这里开始</h3>
            <div>
              {EXAMPLES.map((example, index) => <button type="button" key={example.key} disabled={composerDisabled || !!activeRun || (!conversation && !selection)}
                onClick={() => { updateQuestion(example.question); submit(example.question) }}>
                <span className="chat-example-meta"><span>{String(index + 1).padStart(2, '0')}</span><small>{example.scene}</small></span>
                <span className="chat-example-title"><strong>{example.title}</strong><ArrowUpRight size={17} aria-hidden="true" /></span>
                <span className="chat-example-hint">{example.hint}</span>
              </button>)}
            </div>
          </div>
        </div> : <div className="chat-message-list">{messages.map(message => <MessageBody message={message} key={message.message_id}
          onDetail={setDetailId} onCitations={openCitations} citationsOpen={citationMessage?.message_id === message.message_id}
          activeCitation={citationMessage?.message_id === message.message_id ? citationSelection?.index : undefined}
          followUps={message === latestMessage ? followUps : []} onFollowUp={fillExample} />)}</div>}
      </div>

      <div className="chat-composer-area">
        {error ? <Alert type="error" title={error} closable onClose={() => setError('')} action={busyRun ? <Button size="small" onClick={() => setDetailId(busyRun)}>查看正在运行的任务</Button> : undefined} /> : null}
        {pending && !submitting ? <Alert type="warning" title="上次提交尚未确认，重试会沿用原提交编号。" action={<Button onClick={() => void performSubmit(pending, conversationId)}>重试提交</Button>} /> : null}
        {connection ? <p className="chat-runtime-note" role="status">{connection}</p> : activeRun ? <p className="chat-runtime-note" role="status">{stopping ? '正在停止…' : progress}</p> : null}
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); submit() }}>
          <Input.TextArea ref={composer} variant="borderless" aria-label="聊天消息"
            placeholder="提问趋势、面料或洗护条件…"
            value={question} maxLength={2000} autoSize={{ minRows: 1, maxRows: 7 }}
            disabled={composerDisabled}
            onChange={e => updateQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); submit() }
            }} />
          {activeRun ? <Button type="text" className="chat-composer-send" aria-label="停止回答" icon={<Square size={13} strokeWidth={0} fill="currentColor" />} loading={stopping} onClick={() => {
            setStopping(true); cancelBackgroundRun(activeRun).catch(e => { setError(errorText(e)); setStopping(false) })
          }} /> : <Button type="text" className="chat-composer-send" htmlType="submit" aria-label="发送消息" icon={<ArrowUp size={19} aria-hidden="true" />} loading={submitting}
            disabled={!question.trim() || composerDisabled || (!conversationId && !selection)} />}
        </form>
        <div className="chat-composer-meta">
          <span><Layers size={13} aria-hidden="true" />{sourceStatus}</span>
          <span className="chat-keyboard-hint">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </section>

    {inlineCitations ? <aside className="chat-citations" aria-label="引用侧栏">
      {citationMessage ? <CitationPanel message={citationMessage} onClose={closeCitations} selection={citationSelection} />
        : <div className="chat-citations-placeholder">
          <h2>证据原文</h2>
          <div>
            <BookOpen size={24} strokeWidth={1.5} aria-hidden="true" />
            <p>点击回答中的来源卡片或引用编号，查看对应的原文片段与行号。</p>
          </div>
        </div>}
    </aside> : null}

    <Drawer rootClassName="chat-rail-drawer" title="聊天会话" placement="left" open={sidebarOpen && !desktopSidebar} onClose={() => setSidebarOpen(false)} size="min(320px, 90vw)">{sidebar}</Drawer>
    {!inlineCitations ? <Drawer rootClassName="chat-citation-drawer" title="证据原文" placement="right" open={!!citationMessage} size="min(420px, 100vw)"
      onClose={closeCitations}>
      {citationMessage ? <CitationPanel message={citationMessage} selection={citationSelection} /> : null}
    </Drawer> : null}
    <Drawer title="本轮运行" open={!!detailId} onClose={() => setDetailId(undefined)} size="min(960px, 100vw)">
      {detailError ? <Alert type="error" title={detailError} /> : detail ? <RunDetailPanel detail={detail} /> : <Skeleton active />}
    </Drawer>
    <Modal title="重命名会话" open={!!editing} confirmLoading={renameBusy} onCancel={() => setEditing(undefined)} okButtonProps={{ disabled: !title.trim() }} onOk={async () => {
      if (!editing) return
      setRenameBusy(true)
      try { await renameConversation(editing.conversation_id, title.trim()); setEditing(undefined); await refreshList(); if (editing.conversation_id === conversationId) await loadChat(conversationId) }
      catch (e) { setError(errorText(e)) } finally { setRenameBusy(false) }
    }}><Input aria-label="会话标题" value={title} maxLength={100} onChange={e => setTitle(e.target.value)} /></Modal>
    <Modal title="删除这个会话？" open={!!deleting} confirmLoading={deleteBusy} okText="删除" okButtonProps={{ danger: true }} onCancel={() => setDeleting(undefined)} onOk={async () => {
      if (!deleting) return
      setDeleteBusy(true)
      try { await deleteConversation(deleting.conversation_id); setDeleting(undefined); await refreshList(); if (deleting.conversation_id === conversationId) navigate('/chat') }
      catch (e) { setError(errorText(e)); setDeleting(undefined) } finally { setDeleteBusy(false) }
    }}><p>会话和消息将被删除，关联的运行记录仍保留在运行历史中。</p>{deleting?.active_run_id ? <Alert type="warning" title="这个会话仍在运行，请先停止再删除。" /> : null}</Modal>
  </main>
}
