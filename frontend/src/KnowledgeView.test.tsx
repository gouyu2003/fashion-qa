import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeView from './KnowledgeView'
import { deleteKnowledgeSource, getKnowledgeChunks, getKnowledgeSource, getKnowledgeSources, importKnowledge, KnowledgeImportError } from './api'
import type { KnowledgeSource } from './types'

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  getKnowledgeChunks: vi.fn(), getKnowledgeSource: vi.fn(), getKnowledgeSources: vi.fn(), importKnowledge: vi.fn(), deleteKnowledgeSource: vi.fn(),
}))

const source: KnowledgeSource = {
  source_id: 'user_notes', name: 'English notes', status: 'ready', current_version: 2, file_count: 1, chunk_count: 1,
  versions: [2, 1].map((version) => ({ version, status: 'ready', created_at: 'now', file_count: 1, chunk_count: 1,
    files: [{ filename: 'notes.md', size_bytes: 100, sha256: 'hash' }], error: null })),
}
const chunks = { items: [{ text: 'Mara Vale founded Cedar Institute.', document_id: 'd1', chunk_id: 'c1',
  filename: 'notes.md', heading_path: ['People'], line_start: 3, line_end: 3, char_start: 10, char_end: 42 }],
  total: 1, limit: 10, offset: 0 }

async function openImport() {
  const button = await screen.findByRole('button', { name: '导入资料' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await screen.findByRole('textbox', { name: '知识源名称' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getKnowledgeSources).mockResolvedValue({ items: [source] })
  vi.mocked(getKnowledgeSource).mockResolvedValue(source)
  vi.mocked(getKnowledgeChunks).mockResolvedValue(chunks)
  vi.mocked(importKnowledge).mockResolvedValue(source)
  vi.mocked(deleteKnowledgeSource).mockResolvedValue({ source_id: source.source_id, deleted: true })
})
afterEach(cleanup)

describe('KnowledgeView', () => {
  it('loads stored materials and allows using an older ready version', async () => {
    const onUse = vi.fn()
    render(<KnowledgeView disabled={false} onChanged={vi.fn()} onUse={onUse} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    expect(await screen.findByText('Mara Vale founded Cedar Institute.')).toBeInTheDocument()
    expect(screen.getAllByText('notes.md').length).toBeGreaterThan(0)
    expect(screen.getByText(/第 3–3 行/)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '材料版本' }))
    fireEvent.click(await screen.findByText('版本 1 · 可用', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(getKnowledgeChunks).toHaveBeenLastCalledWith('user_notes', 1, 0, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('button', { name: /用于实时运行/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /用于实时运行/ }))
    expect(onUse).toHaveBeenCalledWith('user_notes', 1)
  })

  it('filters the file list by name and type', async () => {
    const mixed: KnowledgeSource = { ...source, versions: [{
      version: 2, status: 'ready', created_at: 'now', file_count: 2, chunk_count: 2, error: null,
      files: [{ filename: 'notes.md', size_bytes: 100, sha256: 'a' }, { filename: '趋势摘要.md', size_bytes: 200, sha256: 'b' }],
    }] }
    vi.mocked(getKnowledgeSources).mockResolvedValue({ items: [mixed] })
    vi.mocked(getKnowledgeSource).mockResolvedValue(mixed)
    render(<KnowledgeView disabled={false} onChanged={vi.fn()} onUse={vi.fn()} />)
    const files = await screen.findByLabelText('文件清单')
    expect(await within(files).findByText('notes.md')).toBeInTheDocument()
    expect(within(files).getByText('趋势摘要.md')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '按名称筛选文件' }), { target: { value: 'notes' } })
    expect(within(files).queryByText('趋势摘要.md')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '按名称筛选文件' }), { target: { value: '' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '按类型筛选文件' }))
    fireEvent.click(await screen.findByText('趋势资料', { selector: '.ant-select-item-option-content' }))
    expect(within(files).getByText('趋势摘要.md')).toBeInTheDocument()
    expect(within(files).queryByText('notes.md')).not.toBeInTheDocument()
  })

  it('uploads chosen files from the import drawer and refreshes runtime options', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    render(<KnowledgeView disabled={false} onChanged={onChanged} onUse={vi.fn()} />)
    await openImport()
    fireEvent.change(screen.getByRole('textbox', { name: '知识源名称' }), { target: { value: 'English notes' } })
    const file = new File(['English text'], 'notes.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('材料文件'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /导入材料/ }))
    expect(await screen.findByText('已导入「English notes」版本 2。')).toBeInTheDocument()
    expect(importKnowledge).toHaveBeenCalledWith('English notes', [file], undefined)
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('shows import failure and prevents use of a failed version', async () => {
    const failed: KnowledgeSource = { ...source, status: 'failed', current_version: null,
      versions: [{ version: 1, status: 'failed', created_at: 'now', error: { code: 'invalid_encoding', message: '请使用 UTF-8 编码' } }] }
    vi.mocked(getKnowledgeSources).mockResolvedValue({ items: [failed] })
    vi.mocked(getKnowledgeSource).mockResolvedValue(failed)
    render(<KnowledgeView disabled={false} onChanged={vi.fn()} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    expect(screen.getByText('请使用 UTF-8 编码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /用于实时运行/ })).toBeDisabled()
    expect(getKnowledgeChunks).not.toHaveBeenCalled()
  })

  it('locks material uploads inside the drawer during an active run', async () => {
    render(<KnowledgeView disabled onChanged={vi.fn()} onUse={vi.fn()} />)
    await openImport()
    expect(screen.getByLabelText('材料文件')).toBeDisabled()
    expect(screen.getByRole('button', { name: /导入材料/ })).toBeDisabled()
  })

  it('explains a rejected upload and reloads its failed source record', async () => {
    vi.mocked(importKnowledge).mockRejectedValue(new KnowledgeImportError('请使用 UTF-8 编码', 'user_notes', 3))
    const onChanged = vi.fn()
    render(<KnowledgeView disabled={false} onChanged={onChanged} onUse={vi.fn()} />)
    await openImport()
    fireEvent.change(screen.getByRole('textbox', { name: '知识源名称' }), { target: { value: 'Bad notes' } })
    fireEvent.change(screen.getByLabelText('材料文件'), { target: { files: [new File(['bad'], 'notes.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: /导入材料/ }))
    expect(await screen.findByText('请使用 UTF-8 编码')).toBeInTheDocument()
    await waitFor(() => expect(getKnowledgeSource).toHaveBeenCalledWith('user_notes'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('confirms deletion, clears the preview and resets the import target', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    render(<KnowledgeView disabled={false} onChanged={onChanged} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    await screen.findByText('Mara Vale founded Cedar Institute.')
    await openImport()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '导入目标' }))
    fireEvent.click(await screen.findByText('English notes：导入新版本', { selector: '.ant-select-item-option-content' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: '删除资料' }))
    expect(deleteKnowledgeSource).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }))
    expect(deleteKnowledgeSource).not.toHaveBeenCalled()
    expect(screen.getByText('Mara Vale founded Cedar Institute.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除资料' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('还没有用户资料，请先导入材料。')
    expect(deleteKnowledgeSource).toHaveBeenCalledExactlyOnceWith('user_notes')
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.queryByText('Mara Vale founded Cedar Institute.')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '材料版本' })).not.toBeInTheDocument()
    await openImport()
    expect(screen.getByRole('combobox', { name: '导入目标' }).closest('.ant-select')).toHaveTextContent('创建新资料')
    expect(screen.getByRole('textbox', { name: '知识源名称' })).toBeInTheDocument()
  })

  it('keeps the source and shows the server explanation when deletion is rejected', async () => {
    vi.mocked(deleteKnowledgeSource).mockRejectedValue(new Error('知识源正在导入，请等待完成后再删除。'))
    const onChanged = vi.fn()
    render(<KnowledgeView disabled={false} onChanged={onChanged} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除资料' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('知识源正在导入，请等待完成后再删除。')
    expect(screen.getByRole('button', { name: /English notes/ })).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('disables deletion during a run or while a version is importing', async () => {
    const view = render(<KnowledgeView disabled onChanged={vi.fn()} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    expect(screen.getByRole('button', { name: '删除资料' })).toBeDisabled()
    view.unmount()
    const importing: KnowledgeSource = { ...source,
      versions: [{ version: 3, status: 'importing', created_at: 'now', error: null }, ...source.versions] }
    vi.mocked(getKnowledgeSources).mockResolvedValue({ items: [importing] })
    vi.mocked(getKnowledgeSource).mockResolvedValue(importing)
    render(<KnowledgeView disabled={false} onChanged={vi.fn()} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    expect(screen.getByRole('button', { name: '删除资料' })).toBeDisabled()
    expect(deleteKnowledgeSource).not.toHaveBeenCalled()
  })

  it('allows deleting a failed import and reports refresh failure without undoing deletion', async () => {
    vi.mocked(getKnowledgeSources).mockResolvedValue({ items: [{ ...source, status: 'failed', current_version: null,
      versions: [{ version: 1, status: 'failed', created_at: 'now', error: null }] }] })
    const onChanged = vi.fn().mockRejectedValue(new Error('offline'))
    render(<KnowledgeView disabled={false} onChanged={onChanged} onUse={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /English notes/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除资料' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('资料来源已删除，但更新问答选项失败，请刷新页面。')
    expect(screen.getByText('还没有用户资料，请先导入材料。')).toBeInTheDocument()
    expect(deleteKnowledgeSource).toHaveBeenCalledOnce()
  })
})
