import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  bindMediaPoolItem,
  fetchMediaPool,
  ignoreMediaPoolItem,
  mediaSrc,
  searchMediaPoolBind,
  uploadMediaBatch,
  type MediaBatchResult,
  type MediaPoolCandidate,
  type MediaPoolItem,
} from '../lib/api'
import './MediaPoolPage.css'

const ROLE_OPTIONS = [
  { value: 'start', label: '起始' },
  { value: 'end', label: '结束' },
  { value: 'demo', label: '动图' },
  { value: 'highlight_video', label: '高光' },
  { value: 'tip', label: '纠错' },
]

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
)

const STATUS_TABS = [
  { value: 'pending', label: '待关联' },
  { value: 'bound', label: '已绑定' },
  { value: 'ignored', label: '已忽略' },
  { value: '', label: '全部' },
]

const ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function collectFiles(list: FileList | File[]): Array<{ file: File; relativePath: string }> {
  return Array.from(list).map((file) => {
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    return { file, relativePath: rel.replace(/\\/g, '/') }
  })
}

export function MediaPoolPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [publishOnMatch, setPublishOnMatch] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [batchResult, setBatchResult] = useState<MediaBatchResult | null>(null)
  const [status, setStatus] = useState('pending')
  const [items, setItems] = useState<MediaPoolItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [roleEdits, setRoleEdits] = useState<Record<number, string>>({})
  const [searchQ, setSearchQ] = useState<Record<number, string>>({})
  const [searchHits, setSearchHits] = useState<Record<number, MediaPoolCandidate[]>>({})

  const loadPool = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchMediaPool({
        status: status || undefined,
        page: 1,
        page_size: 80,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void loadPool()
  }, [loadPool])

  const pendingHint = useMemo(() => {
    if (!batchResult) return null
    const s = batchResult.summary
    return `本次：匹配 ${s.matched} · 入池 ${s.unmatched} · 失败 ${s.errors}`
  }, [batchResult])

  async function runUpload(picked: Array<{ file: File; relativePath: string }>) {
    if (!picked.length) return
    setUploading(true)
    setError('')
    setBatchResult(null)
    try {
      const res = await uploadMediaBatch(
        picked.map((p) => p.file),
        picked.map((p) => p.relativePath),
        publishOnMatch,
      )
      setBatchResult(res)
      if (status === 'pending' || status === '') {
        await loadPool()
      } else {
        setStatus('pending')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  function onFilesSelected(list: FileList | null) {
    if (!list?.length) return
    void runUpload(collectFiles(list))
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dt = e.dataTransfer
    if (dt.items && [...dt.items].some((it) => it.webkitGetAsEntry()?.isDirectory)) {
      setError('请用「选择文件夹」上传目录；拖拽仅支持文件。')
      const files = collectFiles(dt.files)
      if (files.length) void runUpload(files)
      return
    }
    void runUpload(collectFiles(dt.files))
  }

  async function onBind(item: MediaPoolItem, exerciseId: string) {
    setBusyId(item.id)
    setError('')
    try {
      await bindMediaPoolItem(item.id, {
        exercise_id: exerciseId,
        role: roleEdits[item.id] || item.guessed_role || 'start',
        publish: publishOnMatch,
      })
      await loadPool()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '绑定失败')
    } finally {
      setBusyId(null)
    }
  }

  async function onIgnore(item: MediaPoolItem) {
    setBusyId(item.id)
    setError('')
    try {
      await ignoreMediaPoolItem(item.id)
      await loadPool()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '忽略失败')
    } finally {
      setBusyId(null)
    }
  }

  async function onSearch(poolId: number, q: string) {
    setSearchQ((prev) => ({ ...prev, [poolId]: q }))
    if (!q.trim()) {
      setSearchHits((prev) => ({ ...prev, [poolId]: [] }))
      return
    }
    try {
      const res = await searchMediaPoolBind(q.trim())
      setSearchHits((prev) => ({ ...prev, [poolId]: res.items }))
    } catch {
      setSearchHits((prev) => ({ ...prev, [poolId]: [] }))
    }
  }

  return (
    <div className="media-pool">
      <div className="head">
        <div>
          <div className="eyebrow">Media Intake</div>
          <h1>批量素材池</h1>
          <div className="sub">
            拖入文件或选文件夹；按路径/文件名自动挂到动作槽位，匹配不上的进待关联池。
          </div>
        </div>
        <label className="publish-toggle">
          <input
            type="checkbox"
            checked={publishOnMatch}
            onChange={(e) => setPublishOnMatch(e.target.checked)}
          />
          匹配后直接发布
        </label>
      </div>

      <section
        className={`dropzone${dragOver ? ' over' : ''}${uploading ? ' busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="drop-title">{uploading ? '上传匹配中…' : '拖拽素材到此处'}</div>
        <div className="drop-sub">
          支持 jpg / png / webp / gif / mp4；文件夹名含动作英文名或 ID 时优先自动匹配
        </div>
        <div className="drop-actions">
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            选择文件
          </button>
          <button
            type="button"
            className="ghost"
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            选择文件夹
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            onFilesSelected(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            onFilesSelected(e.target.files)
            e.target.value = ''
          }}
        />
      </section>

      {pendingHint ? <div className="batch-banner">{pendingHint}</div> : null}
      {batchResult?.matched.length ? (
        <div className="batch-matched">
          {batchResult.matched.slice(0, 8).map((m) => (
            <div key={`${m.relative_path}-${m.exercise_id}`} className="match-row">
              <span className="path">{m.relative_path}</span>
              <span className="arrow">→</span>
              <Link to={`/exercises/${m.exercise_id}`}>
                {m.name_zh} · {ROLE_LABEL[m.role] || m.role}
              </Link>
              <span className="meta">{m.media_status}</span>
            </div>
          ))}
          {batchResult.matched.length > 8 ? (
            <div className="more">…另有 {batchResult.matched.length - 8} 条已匹配</div>
          ) : null}
        </div>
      ) : null}
      {batchResult?.errors.length ? (
        <div className="batch-errors">
          {batchResult.errors.map((err) => (
            <div key={`${err.relative_path}-${err.error}`}>
              {err.relative_path}: {err.error}
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="state error">{error}</div> : null}

      <div className="pool-toolbar">
        <div className="tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className={status === tab.value ? 'active' : ''}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
              {tab.value === status ? ` · ${total}` : ''}
            </button>
          ))}
        </div>
        <button type="button" className="ghost refresh" onClick={() => void loadPool()}>
          刷新
        </button>
      </div>

      {loading ? <div className="state">加载素材池…</div> : null}

      {!loading && !items.length ? (
        <div className="state empty">当前筛选下没有条目</div>
      ) : null}

      <div className="pool-list">
        {items.map((item) => {
          const src = mediaSrc(item.url)
          const role = roleEdits[item.id] || item.guessed_role || 'start'
          const candidates = item.candidates || []
          const hits = searchHits[item.id] || []
          const isPending = item.status === 'pending'
          return (
            <article key={item.id} className="pool-card">
              <div className="thumb">
                {item.file_type === 'video' && src ? (
                  <video src={src} muted playsInline />
                ) : src ? (
                  <img src={src} alt={item.filename} />
                ) : (
                  <div className="thumb-fallback">无预览</div>
                )}
              </div>
              <div className="body">
                <div className="title-row">
                  <div className="filename" title={item.relative_path || item.filename}>
                    {item.relative_path || item.filename}
                  </div>
                  <span className={`status-pill ${item.status}`}>{item.status}</span>
                </div>
                <div className="meta-row">
                  <span>{formatBytes(item.size_bytes)}</span>
                  <span>{item.file_type}</span>
                  {item.bound_exercise_id ? (
                    <Link to={`/exercises/${item.bound_exercise_id}`}>
                      已绑 {item.bound_exercise_id}
                    </Link>
                  ) : null}
                </div>

                {isPending ? (
                  <>
                    <div className="role-row">
                      <label>槽位</label>
                      <select
                        value={role}
                        onChange={(e) =>
                          setRoleEdits((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {candidates.length ? (
                      <div className="cand-row">
                        <div className="cand-label">建议匹配</div>
                        <div className="cand-list">
                          {candidates.slice(0, 4).map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void onBind(item, c.id)}
                            >
                              <span className="name">{c.name_zh}</span>
                              <span className="score">
                                {c.score} · {c.reason}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="cand-empty">无自动候选，请搜索绑定</div>
                    )}

                    <div className="search-row">
                      <input
                        value={searchQ[item.id] || ''}
                        placeholder="搜索动作名 / ID / 别名"
                        onChange={(e) => void onSearch(item.id, e.target.value)}
                      />
                      {hits.length ? (
                        <div className="search-hits">
                          {hits.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void onBind(item, h.id)}
                            >
                              {h.name_zh}
                              <span>{h.id}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="actions">
                      <button
                        type="button"
                        className="ghost danger"
                        disabled={busyId === item.id}
                        onClick={() => void onIgnore(item)}
                      >
                        忽略
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
