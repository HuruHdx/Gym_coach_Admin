import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  attachStudioDemo,
  confirmStudioPlan,
  continueStudioPipeline,
  fetchExercises,
  fetchStudioCookies,
  fetchStudioDeps,
  fetchStudioTask,
  fetchStudioTasks,
  ingestStudioBatch,
  mediaSrc,
  previewStudioClip,
  quickCreateStudioExercise,
  reparseStudioTask,
  replaceStudioSource,
  retranscribeStudioTask,
  retryStudioDownload,
  saveStudioCookies,
  saveStudioDraft,
  uploadExerciseMedia,
  uploadStudioFallback,
  uploadStudioTaskCover,
  type ExerciseListItem,
  type StudioDraft,
  type StudioEvidenceLine,
  type StudioExerciseDraft,
  type StudioTask,
} from '../lib/api'
import './StudioPage.css'

/* ───────────── 常量 / 类型 ───────────── */

const TARGET_MUSCLES = ['胸', '背', '肩', '腿', '臂', '核心'] as const
const IN_PROGRESS = ['queued', 'downloading', 'transcribing', 'parsing'] as const
const STEP_LABELS = ['已入库', '已下载', '转字幕', '拆计划', '发布'] as const

type IngestKind = 'share' | 'direct' | 'file'
type IngestMode = 'plan_single' | 'plan_merge' | 'exercise_only'
type Traffic = 'red' | 'amber' | 'green'
type Sel = { start: number; end: number } | null
type LiveInfo = { percent?: number; size?: string; speed?: string; eta?: string; stage?: string }
type Row = { ex: StudioExerciseDraft; block: number; n: number }

const SOURCE_CARDS: Array<{ id: IngestKind; title: string; desc: string }> = [
  {
    id: 'share',
    title: '贴链接',
    desc: 'B站 / YouTube 直接抓，速度快、有真进度；抖音成功率不稳，抓不动会告诉你原因',
  },
  {
    id: 'direct',
    title: '贴直链',
    desc: '浏览器 F12 拿到的 m3u8 / mp4 地址，抖音抓不动时的备用路，长视频也不怕',
  },
  {
    id: 'file',
    title: '本地文件 · 录屏',
    desc: '拖 MP4 进来，或者只录需要的那 10 秒——出库只用 540p 片段，不必留片高清',
  },
]

const MODE_CARDS: Array<{ id: IngestMode; title: string; desc: string }> = [
  { id: 'plan_single', title: '各自成一套', desc: '每条出一条单部位课' },
  { id: 'plan_merge', title: '合成一套分化', desc: '胸/背/腿拼成三分化' },
  { id: 'exercise_only', title: '只存动作素材', desc: '不建计划，只补动作库' },
]

/* ───────────── 纯函数 ───────────── */

function asDraft(raw: StudioTask['draft_json']): StudioDraft {
  const d = (raw || {}) as StudioDraft
  return {
    plan_title: d.plan_title || '',
    scene_tag: d.scene_tag || '博主同款',
    cover_url: d.cover_url || '',
    mode: d.mode,
    blocks: Array.isArray(d.blocks) ? d.blocks : [],
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    queued: '排队中',
    downloading: '下载中',
    awaiting_confirm: '待确认',
    transcribing: '转字幕',
    parsing: '拆计划',
    done: '待审核',
    needs_manual_upload: '需补传',
    failed: '失败',
  }
  return map[s] || s
}

/** 队列上的状态文案：没字幕 / 没拆出动作时不要谎称「已解析」 */
function taskHasLocalVideo(t: StudioTask) {
  return Boolean(t.play_url || t.stored_path)
}

function taskQueueLabel(t: StudioTask): { label: string; tone: 'ok' | 'amber' | 'red' | 'run' } {
  if (t.status === 'failed') {
    return {
      label: taskHasLocalVideo(t) ? '转字幕失败' : '抓不到',
      tone: 'red',
    }
  }
  if (t.status === 'needs_manual_upload') {
    return { label: statusLabel(t.status), tone: 'red' }
  }
  if (t.status === 'awaiting_confirm') return { label: '待确认', tone: 'amber' }
  if ((IN_PROGRESS as readonly string[]).includes(t.status)) {
    return { label: statusLabel(t.status), tone: 'run' }
  }
  if (t.status === 'done') {
    const segs = t.transcript_json?.segments || []
    const warn = Boolean(t.transcript_json?.warning)
    const n = Number(t.exercise_count ?? t.score?.total ?? 0)
    if (!segs.length || warn) return { label: '缺字幕', tone: 'amber' }
    if (n <= 0) return { label: '未拆出动作', tone: 'amber' }
    return { label: `待审核 · ${n}`, tone: 'ok' }
  }
  return { label: statusLabel(t.status), tone: 'run' }
}

function stageLabel(stage?: string) {
  const map: Record<string, string> = {
    downloading: '下载中',
    merging: '合流阶段',
    merge: '合流阶段',
    awaiting_confirm: '等你确认',
    transcribing: '转字幕',
    parsing: '拆计划',
  }
  return stage ? map[stage] || stage : ''
}

function fmtMmss(sec: number | undefined | null) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtAnchor(sec: number | undefined | null) {
  return `≈${fmtMmss(sec)}`
}

function fmtPrecise(sec: number) {
  const v = Math.max(0, sec)
  const m = Math.floor(v / 60)
  const s = v - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

function anchorOf(ex: StudioExerciseDraft): number | undefined {
  const v = ex.spoken_at ?? ex.snippet?.spoken_at
  return typeof v === 'number' ? v : undefined
}

function trafficOf(ex: StudioExerciseDraft): Traffic {
  if (!ex.exercise_id) return 'red'
  if (ex.traffic === 'red' || ex.traffic === 'amber' || ex.traffic === 'green') return ex.traffic
  return ex.sets_from_transcript === false ? 'amber' : 'green'
}

function trafficText(t: Traffic) {
  return t === 'red' ? '红点 · 库外' : t === 'amber' ? '黄点 · 候选待确认' : '绿点 · 绑定可信'
}

function mediaTag(ex: StudioExerciseDraft): { label: string; cls: string } {
  switch (ex.media_status) {
    case 'clipped':
      return { label: '已切 ✓', cls: 'ok' }
    case 'library':
      return { label: '用库里', cls: 'info' }
    case 'pending_sku':
      return { label: '库外待建', cls: 'red' }
    default:
      return ex.exercise_id ? { label: '未切', cls: 'mute' } : { label: '库外待建', cls: 'red' }
  }
}

function setsText(ex: StudioExerciseDraft) {
  const sets = ex.target_sets ?? '?'
  const reps = ex.target_reps || '?'
  return `${sets}×${reps}`
}

function roleLabel(role?: string) {
  const map: Record<string, string> = {
    warmup: '热身',
    compound: '复合动作',
    isolation: '孤立动作',
    main: '主项',
  }
  return role ? map[role] || role : '正式组'
}

function taskTitle(t: StudioTask) {
  const d = (t.draft_json || {}) as StudioDraft
  if (d.plan_title) return d.plan_title
  const text = (t.source_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (text) return text.length > 16 ? `${text.slice(0, 16)}…` : text
  const path = (t.stored_path || t.source_url || '').split(/[\\/]/).pop() || ''
  if (path) return path.length > 18 ? `${path.slice(0, 18)}…` : path
  return `任务 #${t.id}`
}

function liveOf(t: StudioTask | null): LiveInfo {
  const raw = t?.result_ref?.live
  return raw && typeof raw === 'object' ? (raw as LiveInfo) : {}
}

function percentOf(t: StudioTask) {
  const live = liveOf(t)
  const p = Number(live.percent ?? t.progress ?? 0)
  return Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0))
}

function isPlaceholderRow(ex: StudioExerciseDraft) {
  return ex.source_kind === 'missing' || ex.spoken_name === '待人工补充'
}

function flatRows(d: StudioDraft): Row[] {
  const rows: Row[] = []
  d.blocks.forEach((b, bi) => {
    for (const ex of b.exercises || []) {
      if (isPlaceholderRow(ex)) continue
      rows.push({ ex, block: bi, n: rows.length + 1 })
    }
  })
  return rows
}

function mapRows(d: StudioDraft, rowId: string, patch: Partial<StudioExerciseDraft>): StudioDraft {
  return {
    ...d,
    blocks: d.blocks.map((b) => ({
      ...b,
      exercises: (b.exercises || []).map((ex) => (ex.id === rowId ? { ...ex, ...patch } : ex)),
    })),
  }
}

/** 伪波形：仅作定位参考，不是真实音频解码 */
function fauxBars(seed: number, n = 120) {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.abs(Math.sin((i + 1) * 12.9898 + seed * 78.233))
    const env = 0.55 + 0.45 * Math.sin(i / 9 + seed)
    out.push(Math.max(0.12, Math.min(1, a * env + 0.1)))
  }
  return out
}

/* ───────────── 页面 ───────────── */

export function StudioPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: 'start' | 'end' | 'new'; anchor: number; moved: boolean } | null>(null)
  const playUntilRef = useRef<number | null>(null)
  const taskRef = useRef<StudioTask | null>(null)

  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [task, setTask] = useState<StudioTask | null>(null)
  const [draft, setDraft] = useState<StudioDraft>({ plan_title: '', blocks: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // 弹窗
  const [showIngest, setShowIngest] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showRelink, setShowRelink] = useState(false)
  const [relinkText, setRelinkText] = useState('')

  // 新建任务
  const [ingestKind, setIngestKind] = useState<IngestKind>('share')
  const [ingestMode, setIngestMode] = useState<IngestMode>('plan_single')
  const [ingestText, setIngestText] = useState('')
  const [ingestFiles, setIngestFiles] = useState<File[]>([])
  const [pauseConfirm, setPauseConfirm] = useState(false)
  const [planTitle, setPlanTitle] = useState('')

  // 设置
  const [defaultMode, setDefaultMode] = useState<IngestMode>('plan_single')
  const [deps, setDeps] = useState<{
    yt_dlp: boolean
    ffmpeg: boolean
    faster_whisper: boolean
    llm?: boolean
    llm_model?: string | null
  } | null>(null)
  const [cookies, setCookies] = useState({
    source: 'browser' as 'paste' | 'browser',
    browser: 'chrome',
    bilibili: '',
    douyin: '',
    youtube: '',
  })

  // 工作台
  const [sel, setSel] = useState<Sel>(null)
  const [duration, setDuration] = useState(0)
  const [curTime, setCurTime] = useState(0)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({})
  const [showTranscript, setShowTranscript] = useState(false)
  const [greenOpen, setGreenOpen] = useState(false)
  const [planInfoOpen, setPlanInfoOpen] = useState(false)
  const [activeBlockIdx, setActiveBlockIdx] = useState(-1)
  const [appendPlanId, setAppendPlanId] = useState('')
  const [skipSubtitle, setSkipSubtitle] = useState<Record<number, boolean>>({})
  const [showWhisperHelp, setShowWhisperHelp] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 绑定搜索
  const [pickerQ, setPickerQ] = useState('')
  const [pickerHits, setPickerHits] = useState<ExerciseListItem[]>([])
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)

  useEffect(() => {
    taskRef.current = task
  }, [task])

  /* ── 数据加载 ── */

  const reloadList = useCallback(async () => {
    const res = await fetchStudioTasks(80)
    setTasks(res.items)
    return res.items
  }, [])

  const selectTask = useCallback(async (id: number) => {
    const detail = await fetchStudioTask(id)
    setActiveId(id)
    setTask(detail)
    setDraft(asDraft(detail.draft_json))
    setActiveBlockIdx(-1)
    setSel(null)
    setDuration(0)
    setCurTime(0)
    setActiveRowId(null)
    setDetailId(null)
    setPreviewUrl(null)
    setClipUrls({})
    setPickerRowId(null)
  }, [])

  /** 轮询刷新：只在状态变化 / 仍在处理中时覆盖草稿，避免吞掉人工编辑 */
  const refreshActive = useCallback(async (id: number) => {
    const detail = await fetchStudioTask(id)
    const prev = taskRef.current
    setTask(detail)
    if (!prev || prev.id !== id || prev.status !== detail.status || prev.status !== 'done') {
      setDraft(asDraft(detail.draft_json))
    }
  }, [])

  useEffect(() => {
    let alive = true
    reloadList()
      .then((items) => {
        if (!alive || !items.length) return
        void selectTask(items[0].id)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败')
      })
    fetchStudioDeps()
      .then((d) => {
        if (alive) setDeps(d)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ticking = tasks.some((t) => (IN_PROGRESS as readonly string[]).includes(t.status))

  // 每 2 秒轮询进行中任务
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => {
      void reloadList()
        .then((items) => {
          if (activeId == null) return
          const hit = items.find((t) => t.id === activeId)
          const prev = taskRef.current
          if (!hit) return
          if (
            (IN_PROGRESS as readonly string[]).includes(hit.status) ||
            !prev ||
            prev.status !== hit.status
          ) {
            void refreshActive(activeId)
          }
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [ticking, activeId, reloadList, refreshActive])

  // 提示自动消失
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(t)
  }, [notice])

  // 搜库
  useEffect(() => {
    if (!pickerQ.trim()) {
      setPickerHits([])
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      fetchExercises({ q: pickerQ.trim(), page: 1, page_size: 8 })
        .then((res) => {
          if (alive) setPickerHits(res.items)
        })
        .catch(() => {
          if (alive) setPickerHits([])
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [pickerQ])

  /* ── 派生数据 ── */

  const rows = useMemo(() => flatRows(draft), [draft])
  const visibleRows = useMemo(
    () => (activeBlockIdx < 0 ? rows : rows.filter((r) => r.block === activeBlockIdx)),
    [rows, activeBlockIdx],
  )
  const pendingRows = useMemo(() => visibleRows.filter((r) => trafficOf(r.ex) !== 'green'), [visibleRows])
  const greenRows = useMemo(() => visibleRows.filter((r) => trafficOf(r.ex) === 'green'), [visibleRows])
  const pendingAll = useMemo(() => rows.filter((r) => trafficOf(r.ex) !== 'green').length, [rows])
  const clippedCount = useMemo(() => rows.filter((r) => r.ex.media_status === 'clipped').length, [rows])

  const isExerciseOnly = task?.mode === 'exercise_only' || draft.mode === 'exercise_only'
  const segments = task?.transcript_json?.segments || []
  const playSrc = mediaSrc(task?.play_url || task?.stored_path)
  const status = task?.status || ''
  const failedState = status === 'failed' || status === 'needs_manual_upload'
  const workbench = Boolean(task && playSrc && !failedState && status !== 'queued' && status !== 'downloading')
  const missingSub = Boolean(
    task && workbench && status === 'done' && segments.length === 0,
  )
  const showSubBanner = missingSub && !(task && skipSubtitle[task.id])
  const activeRow = rows.find((r) => r.ex.id === activeRowId) || null
  const detailRow = rows.find((r) => r.ex.id === detailId) || null
  const bars = useMemo(() => fauxBars(task?.id || 1), [task?.id])

  const anchors = useMemo(
    () =>
      rows
        .map((r) => ({ r, at: anchorOf(r.ex) }))
        .filter((a): a is { r: Row; at: number } => a.at !== undefined)
        .sort((a, b) => a.at - b.at),
    [rows],
  )

  /* ── 操作：草稿 ── */

  function patchExercise(rowId: string, patch: Partial<StudioExerciseDraft>) {
    setDraft((prev) => mapRows(prev, rowId, patch))
  }

  function removeExerciseRow(rowId: string) {
    const row = rows.find((r) => r.ex.id === rowId)?.ex
    const label = row?.spoken_name || row?.exercise_name || '这一项'
    if (!window.confirm(`从本任务清单删除「${label}」？只改工坊草稿，不会删除动作库 SKU。`)) return
    setDraft((prev) => ({
      ...prev,
      blocks: (prev.blocks || []).map((b) => ({
        ...b,
        exercises: (b.exercises || []).filter((ex) => ex.id !== rowId),
      })),
    }))
    if (activeRowId === rowId) setActiveRowId(null)
    if (detailId === rowId) setDetailId(null)
    if (pickerRowId === rowId) setPickerRowId(null)
    setNotice(`已从清单移除「${label}」。点「存草稿」固化；SKU 若还在库里，可到动作详情「从 H5 下架」。`)
  }

  function seekTo(sec: number) {
    const el = videoRef.current
    if (el) el.currentTime = Math.max(0, sec)
    setCurTime(Math.max(0, sec))
  }

  function activateRow(ex: StudioExerciseDraft, opts?: { toggle?: boolean }) {
    // 再点同一行 = 收起
    if (opts?.toggle && activeRowId === ex.id) {
      setActiveRowId(null)
      setPickerRowId(null)
      return
    }
    setActiveRowId(ex.id)
    const at = anchorOf(ex)
    if (ex.media_status === 'clipped' && ex.snippet?.start != null && ex.snippet?.end != null) {
      setSel({ start: Number(ex.snippet.start), end: Number(ex.snippet.end) })
      seekTo(Number(ex.snippet.start))
    } else if (at !== undefined) {
      seekTo(Math.max(0, at - 1))
    }
  }

  function addManualRow() {
    const ex: StudioExerciseDraft = {
      id: `manual-${Date.now()}`,
      spoken_name: '新动作',
      target_sets: 3,
      target_reps: '8-12',
      role: 'compound',
      traffic: 'red',
      media_status: 'pending_sku',
      source_kind: 'manual',
      cues: [],
      mistakes: [],
    }
    setDraft((prev) => {
      if (!prev.blocks.length) {
        return { ...prev, blocks: [{ title: '手动填写', muscles: [], exercises: [ex] }] }
      }
      const blocks = prev.blocks.slice()
      const last = blocks[blocks.length - 1]
      blocks[blocks.length - 1] = { ...last, exercises: [...(last.exercises || []), ex] }
      return { ...prev, blocks }
    })
    setDetailId(ex.id)
    setActiveRowId(ex.id)
  }

  /* ── 操作：任务 ── */

  async function onIngest() {
    setBusy(true)
    setError('')
    try {
      const merge = ingestMode === 'plan_merge'
      const res = await ingestStudioBatch({
        text: ingestKind === 'file' ? '' : ingestText,
        mode: ingestMode,
        merge_into_one_plan: merge,
        plan_title: planTitle || undefined,
        files: ingestKind === 'file' ? ingestFiles : [],
        pause_for_confirm: pauseConfirm,
        source_kind: ingestKind,
      })
      setShowIngest(false)
      setIngestText('')
      setPlanTitle('')
      setIngestFiles([])
      if (fileRef.current) fileRef.current.value = ''
      await reloadList()
      if (res.items[0]) await selectTask(res.items[0].id)
      setNotice(`已提交 ${res.items.length} 个任务`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '入库失败')
    } finally {
      setBusy(false)
    }
  }

  function openIngest() {
    setIngestMode(defaultMode)
    setShowIngest(true)
  }

  async function reloadActive(id: number) {
    await reloadList()
    await selectTask(id)
  }

  async function onFallback(file: File | null) {
    if (!file || activeId == null) return
    setBusy(true)
    setError('')
    try {
      await uploadStudioFallback(activeId, file)
      await reloadActive(activeId)
      setNotice('已补传，流水线继续')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '补传失败')
    } finally {
      setBusy(false)
      if (fallbackRef.current) fallbackRef.current.value = ''
    }
  }

  async function onRetryDownload() {
    if (activeId == null) return
    setBusy(true)
    setError('')
    try {
      await retryStudioDownload(activeId)
      await reloadActive(activeId)
      setNotice('已重新排队下载（请确认设置里的 Cookie）')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重新下载失败')
    } finally {
      setBusy(false)
    }
  }

  async function onReplaceSource() {
    if (activeId == null || !relinkText.trim()) return
    setBusy(true)
    setError('')
    try {
      await replaceStudioSource(activeId, relinkText.trim())
      setShowRelink(false)
      setRelinkText('')
      await reloadActive(activeId)
      setNotice('已更换链接并重新排队下载')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '更换链接失败')
    } finally {
      setBusy(false)
    }
  }

  function openRelink() {
    if (!task) return
    setRelinkText(task.source_url || task.source_text || '')
    setShowRelink(true)
  }

  async function onContinue() {
    if (activeId == null) return
    setBusy(true)
    setError('')
    try {
      await continueStudioPipeline(activeId)
      await reloadActive(activeId)
      setNotice('已继续：转字幕 → 拆计划')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '继续失败')
    } finally {
      setBusy(false)
    }
  }

  async function onRetranscribe() {
    if (activeId == null) return
    setBusy(true)
    setError('')
    try {
      await retranscribeStudioTask(activeId)
      setSkipSubtitle((prev) => ({ ...prev, [activeId]: false }))
      await reloadActive(activeId)
      setNotice('已重跑字幕')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重跑字幕失败')
    } finally {
      setBusy(false)
    }
  }

  async function onReparse() {
    if (activeId == null) return
    setBusy(true)
    setError('')
    try {
      const next = await reparseStudioTask(activeId)
      setTask(next)
      setDraft(asDraft(next.draft_json))
      const engine = (next.draft_json as StudioDraft | undefined)?.parse_engine
      setNotice(
        engine === 'llm'
          ? `DeepSeek 已重拆 · ${next.exercise_count ?? next.score?.total ?? 0} 个动作`
          : `启发式兜底重拆 · ${next.exercise_count ?? next.score?.total ?? 0} 个动作（检查 LLM 配置）`,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'LLM 重拆失败')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveDraft(next: StudioDraft = draft, quiet = false) {
    if (activeId == null) return
    setBusy(true)
    try {
      const saved = await saveStudioDraft(activeId, next)
      setTask(saved)
      if (!quiet) setNotice('草稿已保存')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function onUploadCover(file: File | null) {
    if (!file || activeId == null) return
    setBusy(true)
    try {
      const next = await uploadStudioTaskCover(activeId, file)
      setTask(next)
      setDraft(asDraft(next.draft_json))
      setNotice('封面已上传')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '封面上传失败')
    } finally {
      setBusy(false)
      if (coverRef.current) coverRef.current.value = ''
    }
  }

  /* ── 操作：选区 / 出库 ── */

  async function onClipOut() {
    if (activeId == null || !sel) return
    // 已选中动作行：出库 = 把选区做成示范写进 SKU（不是让你再上传 GIF）
    if (activeRow) {
      patchExercise(activeRow.ex.id, {
        snippet: { ...activeRow.ex.snippet, start: sel.start, end: sel.end },
        media_status: 'clipped',
        attach_demo: true,
      })
      await onAttachDemoNow({
        ...activeRow.ex,
        snippet: { ...activeRow.ex.snippet, start: sel.start, end: sel.end },
        media_status: 'clipped',
        attach_demo: true,
      })
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await previewStudioClip(activeId, sel.start, sel.end)
      setPreviewUrl(mediaSrc(res.demo_url))
      setNotice(`已预览 ${(sel.end - sel.start).toFixed(1)} 秒。先点右侧某个动作，再出库才会写入该 SKU。`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '切片失败（需 ffmpeg）')
    } finally {
      setBusy(false)
    }
  }

  async function onSetCover() {
    if (activeId == null || !sel) return
    setBusy(true)
    try {
      const res = await previewStudioClip(activeId, sel.start, sel.end)
      setDraft((prev) => ({ ...prev, cover_url: res.cover_url }))
      setPlanInfoOpen(true)
      setNotice('已设为计划背景图（H5 计划详情顶图）。记得存草稿 / 发布。')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '设置计划背景失败（需 ffmpeg）')
    } finally {
      setBusy(false)
    }
  }

  function playSelection(range?: { start: number; end: number } | null) {
    const el = videoRef.current
    const target = range ?? sel
    if (!el || !target) return
    playUntilRef.current = target.end
    el.currentTime = target.start
    setCurTime(target.start)
    void el.play().catch(() => undefined)
  }

  function setStartFromPlayhead() {
    const t = videoRef.current?.currentTime ?? curTime
    setSel((prev) => ({ start: t, end: Math.max(prev?.end ?? t + 3, t + 0.3) }))
  }

  function setEndFromPlayhead() {
    const t = videoRef.current?.currentTime ?? curTime
    setSel((prev) => ({ start: Math.min(prev?.start ?? Math.max(0, t - 3), t - 0.3), end: t }))
  }

  /* ── 波形拖拽 ── */

  function posToSec(clientX: number) {
    const el = waveRef.current
    if (!el || !duration) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function onWaveDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!duration || !waveRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    videoRef.current?.pause()
    const t = posToSec(e.clientX)
    const width = waveRef.current.getBoundingClientRect().width
    const near = (sec: number) => (Math.abs(t - sec) / duration) * width < 14
    if (sel && near(sel.start)) dragRef.current = { mode: 'start', anchor: t, moved: false }
    else if (sel && near(sel.end)) dragRef.current = { mode: 'end', anchor: t, moved: false }
    else dragRef.current = { mode: 'new', anchor: t, moved: false }
  }

  function onWaveMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || !duration) return
    const t = posToSec(e.clientX)
    if (Math.abs(t - d.anchor) / duration > 0.004) d.moved = true
    if (!d.moved) return
    // 拖选区时视频跟着 scrub，一眼看到这段是哪一帧
    seekTo(t)
    if (d.mode === 'new') {
      setSel({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) })
    } else if (d.mode === 'start') {
      setSel((prev) => (prev ? { start: Math.min(t, prev.end - 0.3), end: prev.end } : prev))
    } else {
      setSel((prev) => (prev ? { start: prev.start, end: Math.max(t, prev.start + 0.3) } : prev))
    }
  }

  function onWaveUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.moved) {
      // 单击 = 定位播放头
      seekTo(posToSec(e.clientX))
      return
    }
    if (d.mode === 'new') {
      setSel((prev) => {
        if (!prev || prev.end - prev.start < 0.5) return null
        // 松手直接播选区，不用再往下翻点「播这段」
        playSelection(prev)
        return prev
      })
      return
    }
    setSel((prev) => {
      if (prev) playSelection(prev)
      return prev
    })
  }

  /* ── 操作：动作库 ── */

  async function onQuickCreate(ex: StudioExerciseDraft) {
    if (activeId == null) return null
    setBusy(true)
    setError('')
    try {
      const clipped = ex.media_status === 'clipped'
      const res = await quickCreateStudioExercise({
        task_id: activeId,
        spoken_name: ex.spoken_name || ex.exercise_name || '新动作',
        muscle: ex.target_muscle || '胸',
        gear: ex.gear || undefined,
        role: ex.role || 'isolation',
        start: clipped ? ex.snippet?.start : undefined,
        end: clipped ? ex.snippet?.end : undefined,
        attach_demo: clipped,
      })
      const patch: Partial<StudioExerciseDraft> = {
        exercise_id: res.exercise.id,
        exercise_name: res.exercise.name_zh,
        traffic: 'green',
        match_confidence: 1,
        media_status: clipped ? 'clipped' : 'library',
      }
      patchExercise(ex.id, patch)
      setNotice(`已新建 SKU：${res.exercise.name_zh}`)
      return patch
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新建失败')
      return null
    } finally {
      setBusy(false)
    }
  }

  function clipRangeFor(ex: StudioExerciseDraft): { start: number; end: number } | null {
    if (sel && sel.end - sel.start >= 0.5) return sel
    if (ex.snippet?.start != null && ex.snippet?.end != null) {
      const start = Number(ex.snippet.start)
      const end = Number(ex.snippet.end)
      if (end > start) return { start, end }
    }
    return null
  }

  async function onAttachDemoNow(ex: StudioExerciseDraft) {
    if (activeId == null) return
    let exerciseId = ex.exercise_id
    if (!exerciseId) {
      const created = await onQuickCreate({ ...ex, media_status: 'uncut' })
      exerciseId = created?.exercise_id || null
      if (!exerciseId) return
    }
    const range = clipRangeFor(ex)
    if (!range) {
      setError('请先在时间轴拖出 3～15 秒选区，再做成示范')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await attachStudioDemo({
        task_id: activeId,
        exercise_id: exerciseId,
        start: range.start,
        end: range.end,
      })
      const demoUrl = mediaSrc(res.demo?.demo_url || null)
      patchExercise(ex.id, {
        exercise_id: exerciseId,
        attach_demo: true,
        replace_demo: true,
        media_status: 'clipped',
        snippet: { ...ex.snippet, start: range.start, end: range.end },
      })
      if (demoUrl) setClipUrls((p) => ({ ...p, [ex.id]: demoUrl }))
      const tipN = (ex.cues || []).length
      setNotice(
        tipN
          ? `已写入示范小视频+封面，并把 ${tipN} 条 LLM 要点同步进 SKU；不满意可在动作详情点「删除此素材」后重截`
          : '已写入示范小视频+封面；SKU 列表按「最新」可找到。不满意可到动作详情「删除此素材」后重截',
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '写入示范失败')
    } finally {
      setBusy(false)
    }
  }

  async function onUploadSkuMedia(ex: StudioExerciseDraft, file: File | null) {
    if (!file) return
    let exerciseId = ex.exercise_id
    if (!exerciseId) {
      const created = await onQuickCreate({ ...ex, media_status: 'uncut' })
      exerciseId = created?.exercise_id || null
      if (!exerciseId) return
    }
    const lower = file.name.toLowerCase()
    const isVideo = /\.(mp4|webm|mov)$/.test(lower)
    const role = isVideo ? 'demo' : 'start'
    setBusy(true)
    setError('')
    try {
      await uploadExerciseMedia(exerciseId, role, file, true)
      patchExercise(ex.id, {
        exercise_id: exerciseId,
        media_status: isVideo ? 'clipped' : ex.media_status === 'clipped' ? 'clipped' : 'library',
      })
      setNotice(isVideo ? '示范视频已上传到动作库' : '封面图/GIF 已上传到动作库')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  async function onWriteLibrary(ex: StudioExerciseDraft) {
    let patch: Partial<StudioExerciseDraft> | null = {}
    if (!ex.exercise_id) {
      patch = await onQuickCreate(ex)
      if (!patch) return
    }
    const merged = { ...ex, ...patch }
    if (clipRangeFor(merged) && (merged.attach_demo || merged.replace_demo || !ex.exercise_id)) {
      await onAttachDemoNow({ ...merged, exercise_id: merged.exercise_id || ex.exercise_id })
    } else {
      setNotice(ex.exercise_id ? '已绑定库内动作（未写示范：先拖选区再点「立刻写入示范」）' : '已建 SKU')
    }
    const next = mapRows(draft, ex.id, {
      ...patch,
      attach_demo: true,
      replace_demo: true,
    })
    setDraft(next)
    await onSaveDraft(next, true)
    setDetailId(null)
  }

  async function onSaveOnly(ex: StudioExerciseDraft) {
    const next = mapRows(draft, ex.id, { attach_demo: false, replace_demo: false })
    setDraft(next)
    await onSaveDraft(next, true)
    setNotice('已仅存本次（不写入动作库）')
    setDetailId(null)
  }

  async function onConfirm(publish: boolean) {
    if (activeId == null) return
    if (!isExerciseOnly && !draft.cover_url?.trim()) {
      setPlanInfoOpen(true)
      if (
        !window.confirm(
          '还没设计划背景图。可在时间轴选区点「设为计划背景」，或在下方「计划信息」上传。仍要继续吗？',
        )
      ) {
        return
      }
    }
    const msg = isExerciseOnly
      ? '确认把勾选的示范写入动作库？（不建计划）'
      : pendingAll
        ? `还有 ${pendingAll} 个黄/红点没处理，仍要${publish ? '发布' : '存为草稿计划'}吗？`
        : publish
          ? '确认发布计划上线？'
          : '确认存为草稿计划？'
    if (!window.confirm(msg)) return
    setBusy(true)
    setError('')
    try {
      const res = await confirmStudioPlan({
        task_id: activeId,
        draft: { ...draft, mode: isExerciseOnly ? 'exercise_only' : draft.mode },
        append_to_plan_id: isExerciseOnly ? null : appendPlanId.trim() || null,
        publish: isExerciseOnly ? false : publish,
      })
      if (isExerciseOnly) {
        setNotice(`已写入动作库示范 ${res.attached ?? 0} 条`)
      } else if (res.plan_id) {
        setNotice(`已写入计划 ${res.plan_id}`)
        navigate(`/plans/${encodeURIComponent(res.plan_id)}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发布失败')
    } finally {
      setBusy(false)
    }
  }

  /* ── 设置 ── */

  async function openSettings() {
    setShowSettings(true)
    try {
      const data = await fetchStudioCookies()
      setCookies({
        source: data.source === 'paste' ? 'paste' : 'browser',
        browser: data.browser || 'chrome',
        bilibili: data.bilibili || '',
        douyin: data.douyin || '',
        youtube: data.youtube || '',
      })
    } catch {
      /* ignore */
    }
    fetchStudioDeps()
      .then(setDeps)
      .catch(() => undefined)
  }

  async function onSaveCookies() {
    try {
      await saveStudioCookies(cookies)
      setNotice(
        cookies.source === 'browser'
          ? `已改为从 ${cookies.browser} 读 Cookie，请回到任务点「重试一次」`
          : 'Cookie 已保存，请回到任务点「重试一次」',
      )
      setShowSettings(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  /* ───────────── 渲染片段 ───────────── */

  function renderStepper() {
    let cur = -1
    let kind: 'ok' | 'warn' | 'err' = 'ok'
    let suffix = ''
    if (task) {
      if (failedState) {
        cur = 1
        kind = 'err'
      } else if (status === 'queued' || status === 'downloading') cur = 1
      else if (status === 'awaiting_confirm') {
        cur = 2
        suffix = '待确认'
      } else if (status === 'transcribing') cur = 2
      else if (status === 'parsing') cur = 3
      else if (status === 'done') {
        if (missingSub) {
          cur = 2
          kind = 'warn'
        } else if (rows.length > 0 && pendingAll === 0) cur = 4
        else {
          cur = 3
          suffix = `${rows.length} 个动作`
        }
      } else cur = 1
    }
    return (
      <ol className="stepper" aria-label="流水线进度">
        {STEP_LABELS.map((label, i) => {
          const state = cur < 0 ? 'todo' : i < cur ? 'done' : i === cur ? kind : 'todo'
          const cls = i === cur && state === 'ok' ? 'cur' : state
          return (
            <li key={label} className={`step ${cls}`}>
              <span className="step-dot">
                {state === 'done' ? '✓' : state === 'warn' || state === 'err' ? '!' : i + 1}
              </span>
              <span className="step-label">
                {label}
                {i === cur && suffix ? ` · ${suffix}` : ''}
              </span>
              {i < STEP_LABELS.length - 1 ? <i className="step-line" /> : null}
            </li>
          )
        })}
      </ol>
    )
  }

  function renderQueue() {
    return (
      <aside className="col queue">
        <div className="col-head">
          <span>任务队列</span>
          <span className="num">{tasks.length}</span>
        </div>
        <ul className="queue-list">
          {tasks.map((t) => {
            const running = (IN_PROGRESS as readonly string[]).includes(t.status)
            const bad = t.status === 'failed' || t.status === 'needs_manual_upload'
            const live = liveOf(t)
            const q = taskQueueLabel(t)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={`qcard${t.id === activeId ? ' on' : ''}${bad ? ' bad' : ''}`}
                  onClick={() => void selectTask(t.id)}
                >
                  <span className="qcard-title">
                    <strong>{taskTitle(t)}</strong>
                    <em className="num">#{t.id}</em>
                  </span>
                  <span className="qcard-meta">
                    <span className={`tag ${q.tone}`}>{q.label}</span>
                    <span className="qcard-sub num">
                      {bad
                        ? t.status === 'failed'
                          ? '抓取失败'
                          : '等你补传'
                        : running
                          ? `${percentOf(t)}%${live.speed ? ` · ${live.speed}` : ''}`
                          : t.status === 'done' && (t.transcript_json?.segments || []).length
                            ? `${t.exercise_count ?? t.score?.total ?? 0} 个动作`
                            : t.status === 'done'
                              ? '装 whisper 后重跑'
                              : ''}
                    </span>
                  </span>
                  {running ? (
                    <span className="mini-bar">
                      <i style={{ transform: `scaleX(${percentOf(t) / 100})` }} />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
          {!tasks.length ? <li className="empty-note">暂无任务，点右上「＋ 新建任务」</li> : null}
        </ul>
      </aside>
    )
  }

  function renderProgressCard(t: StudioTask) {
    const live = liveOf(t)
    const pct = percentOf(t)
    const stage = stageLabel(live.stage) || statusLabel(t.status)
    const meta = [
      live.size && `约 ${live.size}`,
      live.speed,
      live.eta && `剩余约 ${live.eta}`,
      stage,
    ].filter(Boolean)
    const hint =
      t.status === 'transcribing'
        ? '转字幕中（未装 faster-whisper 会跳过，可先手填）'
        : t.status === 'parsing'
          ? '拆计划 / 打分中…'
          : t.status === 'queued'
            ? '排队等待处理…'
            : '这是真实进度，来自下载器的实时输出。'
    return (
      <div className="card prog" aria-live="polite">
        <div className="card-title">
          <span className="icon-sq accent">↓</span>
          <strong>
            <span className="num">#{t.id}</span> {t.status === 'downloading' ? '正在下载' : statusLabel(t.status)}
            {stage ? ` · ${stage}` : ''}
          </strong>
        </div>
        <p className="muted">{hint}</p>
        <div className="prog-row">
          <div className="bar">
            <i style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
          </div>
          <span className="num prog-pct">{pct}%</span>
        </div>
        <p className="prog-meta num">{meta.length ? meta.join(' · ') : '正在连接并拉取视频…'}</p>
      </div>
    )
  }

  function renderFailedCard(t: StudioTask) {
    const hasVideo = taskHasLocalVideo(t)
    const subtitleFail = hasVideo && t.status === 'failed'
    return (
      <div className="card fail">
        <div className="card-title">
          <span className="icon-sq red">!</span>
          <strong>
            <span className="num">#{t.id}</span>{' '}
            {t.status === 'needs_manual_upload'
              ? '需要补传素材'
              : subtitleFail
                ? '转字幕失败（视频还在）'
                : '抓不到素材'}
          </strong>
        </div>
        <p className="fail-text">{t.error || (subtitleFail ? '转字幕出错' : '下载失败，原因未知。')}</p>
        <p className="muted">
          {subtitleFail
            ? '本地视频还在，刷新不会丢。修好后点「重跑字幕」即可，不用重新下载。'
            : '视频没下下来，但任务保留着，换一条路补上就能继续跑。'}
        </p>
        <div className="btn-row">
          {subtitleFail ? (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void onRetranscribe()}>
              重跑字幕
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy || !t.source_url} onClick={() => void onRetryDownload()}>
            重试下载
          </button>
          <button type="button" className="btn" disabled={busy} onClick={openRelink}>
            贴直链
          </button>
          <button
            type="button"
            className={`btn${subtitleFail ? '' : ' primary'}`}
            disabled={busy}
            onClick={() => fallbackRef.current?.click()}
          >
            传文件 / 录屏
          </button>
        </div>
      </div>
    )
  }

  function renderWave() {
    const selLeft = sel && duration ? (sel.start / duration) * 100 : 0
    const selWidth = sel && duration ? ((sel.end - sel.start) / duration) * 100 : 0
    const headLeft = duration ? (curTime / duration) * 100 : 0
    return (
      <div className="wave-wrap">
        <div className="wave-head">
          <span>
            {missingSub
              ? '视频能看，但还没有字幕，暂时无法按句定位'
              : '拖波形选片段（点一下 = 定位播放头）'}
          </span>
          <span className="num">{duration ? `${fmtMmss(duration)} 总长` : '加载中…'}</span>
        </div>
        <div
          ref={waveRef}
          className={`wave${duration ? '' : ' disabled'}`}
          onPointerDown={onWaveDown}
          onPointerMove={onWaveMove}
          onPointerUp={onWaveUp}
          onPointerCancel={onWaveUp}
        >
          <div className="bars" aria-hidden="true">
            {bars.map((h, i) => (
              <i key={i} style={{ transform: `scaleY(${h})` }} />
            ))}
          </div>
          {anchors.map(({ r, at }) =>
            duration ? (
              <i
                key={r.ex.id}
                className={`wave-anchor ${trafficOf(r.ex)}`}
                style={{ left: `${Math.min(100, (at / duration) * 100)}%` }}
              />
            ) : null,
          )}
          {sel && duration ? (
            <div className="sel" style={{ left: `${selLeft}%`, width: `${selWidth}%` }}>
              <b className="handle l" />
              <b className="handle r" />
            </div>
          ) : null}
          {duration ? <i className="playhead" style={{ left: `${headLeft}%` }} /> : null}
          {missingSub ? <div className="wave-note">有波形但无字幕段</div> : null}
        </div>

        <div className="track">
          <div className="track-label">
            <span className="dot green" />
            {draft.parse_engine === 'llm' ? '动作锚点 · DeepSeek 抽取' : '动作锚点'}
            <em>
              {draft.parse_engine === 'heuristic'
                ? '（当前是启发式，不是 LLM；可点「用 LLM 重拆」）'
                : '（≈ 讲到这句的位置，不是示范起点）'}
            </em>
          </div>
          {anchors.length ? (
            <div className="chips">
              {anchors.map(({ r, at }) => (
                <button
                  key={r.ex.id}
                  type="button"
                  className={`chip ${trafficOf(r.ex)}${r.ex.id === activeRowId ? ' on' : ''}`}
                  onClick={() => activateRow(r.ex)}
                >
                  <span className="num">{fmtAnchor(at)}</span> {r.ex.spoken_name || r.ex.exercise_name || '未命名'}
                  <span className="num"> {setsText(r.ex)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="track-empty">还没有动作锚点。有字幕后点「用 LLM 重拆」。 </p>
          )}
          {segments.length ? (
            <button type="button" className="link track-sublink" onClick={() => setShowTranscript(true)}>
              口播原文 {segments.length} 段 · 点开下方证据层核对（不再在这里铺一长串字幕 chip）
            </button>
          ) : null}
        </div>

        <div className="selbar">
          <div className="selbar-info num">
            {sel ? (
              <>
                {fmtPrecise(sel.start)} → {fmtPrecise(sel.end)}
                <span className="pill">{(sel.end - sel.start).toFixed(1)} 秒</span>
              </>
            ) : (
              <span className="muted">未选择区间</span>
            )}
            {activeRow ? (
              <span className="selbar-target">挂到「{activeRow.ex.spoken_name || activeRow.ex.exercise_name}」</span>
            ) : null}
          </div>
          <div className="selbar-actions">
            <button type="button" className="btn sm" onClick={setStartFromPlayhead} disabled={!duration}>
              起点=播放头
            </button>
            <button type="button" className="btn sm" onClick={setEndFromPlayhead} disabled={!duration}>
              终点=播放头
            </button>
            <button type="button" className="btn sm" disabled={!sel || busy} onClick={() => void onSetCover()}>
              设为计划背景
            </button>
            <button type="button" className="btn sm" disabled={!sel} onClick={() => playSelection()}>
              播这段
            </button>
            <button type="button" className="btn primary sm" disabled={!sel || busy} onClick={() => void onClipOut()}>
              {activeRow ? '出库到此动作' : '出库一段'}
            </button>
          </div>
        </div>
        {previewUrl ? (
          <video className="clip-preview" src={previewUrl} muted loop autoPlay playsInline />
        ) : null}
      </div>
    )
  }

  function renderTranscript() {
    return (
      <div className={`drawer${showTranscript ? ' open' : ''}`}>
        <button type="button" className="drawer-head" onClick={() => setShowTranscript((v) => !v)}>
          <span className="tag amber">原文 · 证据层</span>
          <span className="muted">
            {segments.length
              ? '核对用，不用一直盯稿；点句子可把选区对准这一段'
              : '没有字幕，这一块是空的'}
          </span>
          <span className="caret">{showTranscript ? '收起' : '展开'}</span>
        </button>
        {showTranscript ? (
          segments.length ? (
            <ul className="drawer-list">
              {segments.map((seg, i) => {
                const on = curTime >= seg.start && curTime < seg.end
                return (
                  <li key={`${seg.start}-${i}`}>
                    <button
                      type="button"
                      className={on ? 'on' : ''}
                      onClick={() => {
                        setSel({ start: seg.start, end: Math.max(seg.end, seg.start + 3) })
                        seekTo(seg.start)
                      }}
                    >
                      <span className="num">{fmtMmss(seg.start)}</span>
                      <span>{seg.text}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="drawer-empty">
              <strong>还没有字幕</strong>
              <span>{task?.transcript_json?.warning || '装 faster-whisper 后点「重跑字幕」，或者在右栏直接手填动作。'}</span>
            </div>
          )
        ) : null}
      </div>
    )
  }

  function renderCenter() {
    if (!task) {
      return <div className="empty-block">从左侧选择任务，或点右上「＋ 新建任务」</div>
    }
    if (!workbench) {
      return (
        <>
          {failedState ? renderFailedCard(task) : renderProgressCard(task)}
          <div className="placeholder-block">
            <strong>{failedState ? '等补传的素材' : '下载完成前，这里空着'}</strong>
            <span>不用在这里点，等素材进来会自动出视频。</span>
          </div>
        </>
      )
    }
    return (
      <>
        {status === 'transcribing' || status === 'parsing' ? renderProgressCard(task) : null}
        {status === 'awaiting_confirm' ? (
          <div className="card hold">
            <div className="card-title">
              <span className="icon-sq amber">⏸</span>
              <strong>素材已就绪，先停在这</strong>
            </div>
            <p className="muted">你选了「先停住等我确认」。看一眼画面没问题，再继续转字幕 → 拆计划。</p>
            <div className="btn-row">
              <button type="button" className="btn" disabled={busy} onClick={openRelink}>
                换链接
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => fallbackRef.current?.click()}>
                换文件
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void onContinue()}>
                确认并继续
              </button>
            </div>
          </div>
        ) : null}
        <div className="video-card">
          <div className="panel-head">
            <span>视频预览</span>
            <span className="panel-head-actions">
              <span className="num">{duration ? `${fmtMmss(duration)} · ` : ''}{task.source_type === 'upload' || !task.source_url ? '本地 MP4' : '已下载'}</span>
              <button type="button" className="link" onClick={openRelink}>换链接</button>
              <button type="button" className="link" onClick={() => fallbackRef.current?.click()}>补传文件</button>
            </span>
          </div>
          <div className="video-box">
            <video
              key={playSrc || 'none'}
              ref={videoRef}
              src={playSrc || undefined}
              controls
              playsInline
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime
                setCurTime(t)
                if (playUntilRef.current != null && t >= playUntilRef.current) {
                  e.currentTarget.pause()
                  playUntilRef.current = null
                }
              }}
            />
          </div>
        </div>
        {renderWave()}
        {renderTranscript()}
      </>
    )
  }

  function renderRowOps(ex: StudioExerciseDraft) {
    const t = trafficOf(ex)
    return (
      <div className="row-ops">
        <label className="field name-edit">
          动作名（可改错字）
          <input
            value={ex.spoken_name || ''}
            placeholder="例如：宽握高位下拉"
            onChange={(e) => {
              const name = e.target.value
              patchExercise(ex.id, {
                spoken_name: name,
                // 未绑库时展示名跟着改；已绑库只改口语名，换绑再用搜库
                ...(ex.exercise_id ? {} : { exercise_name: name }),
              })
            }}
          />
        </label>
        <div className="ops-line sets-edit">
          <label>
            组
            <input
              className="num"
              type="number"
              min={1}
              max={20}
              value={ex.target_sets ?? ''}
              onChange={(e) =>
                patchExercise(ex.id, {
                  target_sets: e.target.value === '' ? null : Number(e.target.value) || null,
                  sets_from_transcript: true,
                })
              }
            />
          </label>
          <label>
            次
            <input
              className="num"
              value={ex.target_reps || ''}
              placeholder="8-12"
              onChange={(e) =>
                patchExercise(ex.id, {
                  target_reps: e.target.value,
                  sets_from_transcript: true,
                })
              }
            />
          </label>
          <select
            value={ex.target_muscle || '全身'}
            onChange={(e) => patchExercise(ex.id, { target_muscle: e.target.value })}
            aria-label="部位"
          >
            {['全身', ...TARGET_MUSCLES].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="ops-line">
          <button type="button" className="btn sm" disabled={busy} onClick={() => void onQuickCreate(ex)}>
            ＋ 一键新建 SKU
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setPickerRowId(pickerRowId === ex.id ? null : ex.id)
              setPickerQ(ex.spoken_name || '')
            }}
          >
            搜库换绑
          </button>
        </div>
        {pickerRowId === ex.id ? (
          <div className="picker">
            <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="搜动作" autoFocus />
            <ul>
              {pickerHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      patchExercise(ex.id, {
                        exercise_id: hit.id,
                        exercise_name: hit.name_zh,
                        traffic: ex.sets_from_transcript === false ? 'amber' : 'green',
                        match_confidence: 1,
                        target_muscle: hit.muscle || ex.target_muscle,
                        media_status: ex.media_status === 'clipped' ? 'clipped' : 'library',
                      })
                      setPickerRowId(null)
                    }}
                  >
                    {hit.name_zh}
                    <span>{hit.muscle}</span>
                  </button>
                </li>
              ))}
              {pickerQ.trim() && !pickerHits.length ? <li className="muted pad">库里没搜到，可「一键新建 SKU」</li> : null}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          className="btn sm primary"
          disabled={busy}
          onClick={() => void onAttachDemoNow(ex)}
        >
          把选区做成示范
        </button>
        <p className="muted">
          用上面时间轴拖好的片段，自动压成静音小视频 + 封面图写进动作库。不用另传 GIF。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(ex.attach_demo || ex.replace_demo)}
            onChange={(e) => patchExercise(ex.id, { attach_demo: e.target.checked, replace_demo: e.target.checked })}
          />
          发布计划时也带上这段示范
        </label>
        <details className="local-upload">
          <summary>没有合适画面？用本地文件兜底</summary>
          <label className="btn sm upload-btn">
            选本地图片 / MP4
            <input
              type="file"
              hidden
              accept="image/*,.gif,video/mp4,video/webm"
              onChange={(e) => void onUploadSkuMedia(ex, e.target.files?.[0] || null)}
            />
          </label>
        </details>
        {t === 'amber' ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => patchExercise(ex.id, { traffic: 'green', sets_from_transcript: true })}
          >
            组次已核对 → 转绿点
          </button>
        ) : null}
        <button type="button" className="btn sm danger" onClick={() => removeExerciseRow(ex.id)}>
          从清单删除此项
        </button>
      </div>
    )
  }

  function renderListRow(r: Row, ops: boolean) {
    const t = trafficOf(r.ex)
    const tag = mediaTag(r.ex)
    const at = anchorOf(r.ex)
    const on = r.ex.id === activeRowId
    const cue0 = (r.ex.cues || [])[0]?.text
    return (
      <li key={r.ex.id} className={`arow${on ? ' on' : ''}`}>
        <div className="arow-main">
          <button type="button" className="arow-btn" onClick={() => activateRow(r.ex, { toggle: true })}>
            <span className="arow-n num">{r.n}</span>
            <span className={`dot ${t}`} title={trafficText(t)} />
            <span className="arow-body">
              <span className="arow-name">{r.ex.spoken_name || r.ex.exercise_name || '未命名'}</span>
              {cue0 ? <span className="arow-cue">{cue0}</span> : null}
            </span>
            <span className="arow-sets num">{setsText(r.ex)}</span>
            {at !== undefined ? <span className="arow-at num">{fmtAnchor(at)}</span> : null}
            <span className={`tag ${tag.cls}`}>{tag.label}</span>
            <span className="arow-fold muted">{on ? '收起' : '展开'}</span>
          </button>
          <button
            type="button"
            className="arow-open"
            onClick={() => {
              activateRow(r.ex)
              setDetailId(r.ex.id)
            }}
          >
            要点
          </button>
        </div>
        {on && ops ? renderRowOps(r.ex) : null}
      </li>
    )
  }

  function renderPlanInfo() {
    const coverSrc = mediaSrc(draft.cover_url)
    return (
      <div className={`plan-info${planInfoOpen ? ' open' : ''}${draft.cover_url ? ' has-cover' : ''}`}>
        <button type="button" className="plan-info-head" onClick={() => setPlanInfoOpen((v) => !v)}>
          {coverSrc ? <img className="plan-info-thumb" src={coverSrc} alt="" /> : <span className="plan-info-thumb empty">背景</span>}
          <span>计划信息</span>
          <span className="muted">
            {draft.plan_title || '未命名计划'} · {draft.scene_tag || '博主同款'}
            {draft.cover_url ? ' · 已设背景' : ' · 未设背景图'}
          </span>
          <span className="caret">{planInfoOpen ? '收起' : '展开'}</span>
        </button>
        {planInfoOpen ? (
          <div className="plan-info-body">
            <label className="field">
              计划名
              <input value={draft.plan_title || ''} onChange={(e) => setDraft({ ...draft, plan_title: e.target.value })} />
            </label>
            <label className="field">
              场景标签
              <select value={draft.scene_tag || ''} onChange={(e) => setDraft({ ...draft, scene_tag: e.target.value })}>
                <option value="博主同款">博主同款</option>
                <option value="三分化">三分化</option>
                <option value="四分化">四分化</option>
                <option value="单部位专项">单部位专项</option>
                <option value="新手入门">新手入门</option>
              </select>
            </label>
            <div className="field">
              计划背景图（H5 计划详情顶图）
              <p className="field-hint muted">时间轴拖选区 →「设为计划背景」，或直接上传本地图。</p>
              <div className="cover-row">
                <input
                  value={draft.cover_url || ''}
                  onChange={(e) => setDraft({ ...draft, cover_url: e.target.value })}
                  placeholder="https://… 或上传 / 时间轴「设为计划背景」"
                />
                <button type="button" className="btn sm" disabled={busy} onClick={() => coverRef.current?.click()}>
                  上传
                </button>
                <input ref={coverRef} type="file" hidden accept="image/*" onChange={(e) => void onUploadCover(e.target.files?.[0] || null)} />
              </div>
              {coverSrc ? <img className="cover-preview" src={coverSrc} alt="" /> : null}
            </div>
            <label className="field">
              并入已有计划 ID（可选）
              <input value={appendPlanId} placeholder="例如 three-split-classic" onChange={(e) => setAppendPlanId(e.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
    )
  }

  function renderRightPlaceholder() {
    const others = tasks.filter((t) => t.id !== activeId)
    const running = others.filter((t) => (IN_PROGRESS as readonly string[]).includes(t.status)).length
    const bad = others.filter((t) => t.status === 'failed' || t.status === 'needs_manual_upload').length
    return (
      <div className="right-body">
        <div className="dashed-note">
          <strong>等待素材</strong>
          <span>还没解析，先等素材进来。</span>
        </div>
        {failedState ? (
          <div className="side-note">
            <h4>其他任务不受影响</h4>
            <p>
              一条失败不会把队列卡住，后面的任务照常跑；失败的这条挂着等补传。
              {others.length ? ` 当前其余 ${others.length} 条：${running} 条处理中${bad ? `、${bad} 条同样待补传` : ''}。` : ''}
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  function renderRightTools() {
    const hasTranscript = segments.length > 0 || Boolean(task?.transcript_json?.text)
    return (
      <div className="right-tools">
        <button type="button" className="btn sm" disabled={busy || !task} onClick={() => void onSaveDraft()}>
          存草稿
        </button>
        {hasTranscript ? (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            title="不重转字幕，只用 DeepSeek 按现有口播重拆"
            onClick={() => void onReparse()}
          >
            LLM 重拆
          </button>
        ) : null}
      </div>
    )
  }

  function renderFooter() {
    const empty = rows.length === 0
    const primaryLabel = isExerciseOnly
      ? '写入动作库示范'
      : pendingAll
        ? `绑定 ${pendingAll} 个 → 发布`
        : '发布'
    return (
      <div className="right-foot">
        <button type="button" className="btn primary" disabled={busy || empty} onClick={() => void onConfirm(true)}>
          {primaryLabel}
        </button>
      </div>
    )
  }

  function renderRight() {
    if (!task) return <div className="right-body"><div className="dashed-note"><span>选择任务</span></div></div>
    if (!workbench || status === 'awaiting_confirm') {
      if (status !== 'awaiting_confirm') return renderRightPlaceholder()
      return (
        <div className="right-body">
          <div className="dashed-note">
            <strong>等你确认</strong>
            <span>点中栏「确认并继续」后才会转字幕、拆计划。</span>
          </div>
        </div>
      )
    }
    if (status !== 'done') {
      return (
        <div className="right-body">
          <div className="dashed-note">
            <strong>处理中</strong>
            <span>{statusLabel(status)}完成后，这里会出现动作清单。</span>
          </div>
        </div>
      )
    }

    // 缺字幕 / 没解析出动作
    if (!rows.length) {
      return (
        <>
          <div className="right-body">
            <div className="dashed-note">
              <strong>{missingSub ? '等字幕出来才会有动作清单' : '没有解析出动作'}</strong>
              <span>{missingSub ? '现在在这里不用点。' : '可以手动加行，填动作名 + 组次。'}</span>
            </div>
            <div className="side-note">
              <h4>可以直接手填</h4>
              <p>
                不想装 whisper 也行：在右栏手动加一行，填动作名 + 组次，一样能发布计划；
                只是没有时间锚点，切素材要自己找位置。
              </p>
              <button type="button" className="btn sm" onClick={addManualRow}>
                ＋ 手动加一行
              </button>
            </div>
          </div>
          {renderFooter()}
        </>
      )
    }

    if (isExerciseOnly) {
      return (
        <>
          <div className="right-body">
            <p className="muted">仅存动作素材：绑 SKU → 在时间轴选区「出库一段」→ 勾示范 → 写入动作库（不建计划）</p>
            <ul className="alist">{visibleRows.map((r) => renderListRow(r, true))}</ul>
            <button type="button" className="btn sm" onClick={addManualRow}>
              ＋ 手动加一行
            </button>
          </div>
          {renderFooter()}
        </>
      )
    }

    return (
      <>
        <div className="right-body">
          {renderPlanInfo()}
          {draft.blocks.length > 1 ? (
            <div className="block-tabs">
              <button type="button" className={activeBlockIdx < 0 ? 'on' : ''} onClick={() => setActiveBlockIdx(-1)}>
                全部
              </button>
              {draft.blocks.map((b, i) => (
                <button key={i} type="button" className={i === activeBlockIdx ? 'on' : ''} onClick={() => setActiveBlockIdx(i)}>
                  {i + 1}.{b.title}
                </button>
              ))}
            </div>
          ) : null}
          <div className="section-title">
            <strong>待你处理 · <span className="num">{pendingRows.length}</span></strong>
            <span className="muted">黄 / 红</span>
          </div>
          {pendingRows.length ? (
            <ul className="alist">{pendingRows.map((r) => renderListRow(r, true))}</ul>
          ) : (
            <div className="dashed-note ok">
              <span>黄/红点都处理完了，可以发布。</span>
            </div>
          )}
          <div className="green-fold">
            <button type="button" onClick={() => setGreenOpen((v) => !v)}>
              <span className="ok-mark">✓</span> 已自动通过 <span className="num">{greenRows.length}</span> 个
              <span className="caret">{greenOpen ? '收起' : '展开检查'}</span>
            </button>
            {greenOpen ? <ul className="alist">{greenRows.map((r) => renderListRow(r, true))}</ul> : null}
          </div>
          <div className="legend">
            <span><i className="dot green" /> 绿 · 绑定可信</span>
            <span><i className="dot amber" /> 黄 · 候选待确认</span>
            <span><i className="dot red" /> 红 · 库外</span>
          </div>
          <button type="button" className="btn sm" onClick={addManualRow}>
            ＋ 手动加一行
          </button>
        </div>
        {renderFooter()}
      </>
    )
  }

  /* ── 动作详情 (05) ── */

  function quoteFor(at?: number) {
    if (at === undefined || !segments.length) return null
    const hit =
      segments.find((s) => at >= s.start - 0.5 && at <= s.end + 0.5) ||
      segments.reduce<{ s: (typeof segments)[number] | null; d: number }>(
        (best, s) => {
          const d = Math.abs(s.start - at)
          return d < best.d ? { s, d } : best
        },
        { s: null, d: 3 },
      ).s
    return hit?.text || null
  }

  function renderEvidence(line: StudioEvidenceLine) {
    const quote = quoteFor(line.source_at)
    if (line.source_at === undefined) {
      return <span className="evi warn">未在原文中点名，需人工确认</span>
    }
    return (
      <span className="evi">
        依据原文 <span className="num">{fmtAnchor(line.source_at)}</span>
        {quote ? <> 「{quote}」</> : null}
      </span>
    )
  }

  function renderLines(ex: StudioExerciseDraft, key: 'cues' | 'mistakes') {
    const list = ex[key] || []
    const isCue = key === 'cues'
    if (!list.length) return <p className="muted">还没有内容（LLM 没抽到，可到原文里核对）。</p>
    return (
      <ul className="lines">
        {list.map((line, i) => (
          <li key={`${key}-${i}`}>
            <span className={`ico ${isCue ? 'ok' : 'amber'}`}>{isCue ? '✓' : '!'}</span>
            <div>
              <p>{line.text}</p>
              {renderEvidence(line)}
            </div>
            <button
              type="button"
              className="link"
              onClick={() => {
                const rest = list.filter((_, j) => j !== i)
                patchExercise(ex.id, isCue ? { cues: rest } : { mistakes: rest })
              }}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    )
  }

  function renderDetail(r: Row) {
    const ex = r.ex
    const t = trafficOf(ex)
    const at = anchorOf(ex)
    const clipped = ex.media_status === 'clipped'
    const s0 = Number(ex.snippet?.start ?? 0)
    const s1 = Number(ex.snippet?.end ?? s0)
    const demoSrc = clipUrls[ex.id] || (clipped && playSrc ? `${playSrc}#t=${s0},${s1}` : null)
    const tag = mediaTag(ex)
    return (
      <div className="detail-grid">
        <aside className="col detail-list">
          <div className="col-head">
            <span>动作清单</span>
            <span className="num">{rows.length} 个 · 已切 {clippedCount}</span>
          </div>
          <ul className="alist compact">
            {rows.map((x) => {
              const tt = trafficOf(x.ex)
              const xat = anchorOf(x.ex)
              return (
                <li key={x.ex.id} className={`arow${x.ex.id === ex.id ? ' on' : ''}`}>
                  <button type="button" className="arow-btn" onClick={() => setDetailId(x.ex.id)}>
                    <span className="arow-n num">{x.n}</span>
                    <span className={`dot ${tt}`} />
                    <span className="arow-name">{x.ex.spoken_name || x.ex.exercise_name || '未命名'}</span>
                    <span className="arow-sets num">{setsText(x.ex)}</span>
                    {xat !== undefined ? <span className="arow-at num">{fmtAnchor(xat)}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <section className="col detail-main">
          <div className="detail-scroll">
            <div className="detail-source">
              来源
              <span className="tag ok">
                <span className="num">#{task?.id}</span> {task ? taskTitle(task) : ''}
                {at !== undefined ? <> · <span className="num">{fmtAnchor(at)}</span></> : null}
              </span>
            </div>
            <input
              className="detail-title"
              value={ex.spoken_name || ex.exercise_name || ''}
              onChange={(e) => patchExercise(ex.id, { spoken_name: e.target.value })}
              aria-label="动作名"
            />
            <div className="detail-meta">
              <span className={`tag ${t === 'green' ? 'ok' : t === 'amber' ? 'amber' : 'red'}`}>{trafficText(t)}</span>
              {ex.exercise_id ? <span className="tag info">已绑定 {ex.exercise_id}</span> : null}
              <span className={`tag ${tag.cls}`}>{tag.label}</span>
            </div>
            <div className="detail-sets">
              <label>
                <input
                  className="num"
                  type="number"
                  min={1}
                  value={ex.target_sets ?? ''}
                  onChange={(e) => patchExercise(ex.id, { target_sets: e.target.value ? Number(e.target.value) : null })}
                />
                组
              </label>
              <label>
                <input
                  className="num"
                  value={ex.target_reps || ''}
                  onChange={(e) => patchExercise(ex.id, { target_reps: e.target.value })}
                />
                次
              </label>
              <span className="muted">
                {roleLabel(ex.role)} · 部位：{ex.target_muscle || '未定'}
                {ex.gear ? ` · 器械：${ex.gear}` : ''}
              </span>
            </div>

            <div className="card">
              <div className="card-title spread">
                <strong>要领 · 教练强调</strong>
                <span className="muted num">{(ex.cues || []).length} 条 · LLM 提炼自原话</span>
              </div>
              {renderLines(ex, 'cues')}
            </div>
            <div className="card">
              <div className="card-title spread">
                <strong>易错 · 常见问题</strong>
                <span className="muted num">{(ex.mistakes || []).length} 条</span>
              </div>
              {renderLines(ex, 'mistakes')}
            </div>

            <div className="two">
              <label className="card field">
                节奏 / 离心
                <textarea rows={3} value={ex.tempo || ''} placeholder="例：下放约 3 秒，推起不要甩" onChange={(e) => patchExercise(ex.id, { tempo: e.target.value })} />
              </label>
              <label className="card field">
                强度提示
                <textarea rows={3} value={ex.intensity || ''} placeholder="例：最后两组接近力竭，留 1-2 次余力" onChange={(e) => patchExercise(ex.id, { intensity: e.target.value })} />
              </label>
            </div>

            <div className="side-note">
              <p>
                <b>打分为何还要审：</b>
                {t === 'red'
                  ? '红点 = 还没绑上动作库 SKU（名字对了也不算入库）。用下方「搜库换绑」或「一键新建 SKU」。'
                  : t === 'amber'
                    ? '黄点 = 已绑库，但组次是默认建议或匹配置信度不够，瞄一眼组次即可转绿。'
                    : '绿点 = 已高置信绑库且组次来自口播，发布时可免检。'}
              </p>
              <p className="muted" style={{ marginTop: 6 }}>
                要领 / 易错是 LLM 从口播提炼的候选，不是照抄字幕；写入动作库前建议对一下原文证据。
              </p>
            </div>

            {renderRowOps(ex)}
          </div>
          <div className="detail-foot">
            <span className="muted">个人习惯或通用标准，决定入库范围</span>
            <div className="btn-row">
              <button type="button" className="btn" disabled={busy} onClick={() => void onSaveOnly(ex)}>
                仅存本次
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void onWriteLibrary(ex)}>
                写入动作库
              </button>
              <button type="button" className="btn danger" onClick={() => removeExerciseRow(ex.id)}>
                从清单删除
              </button>
            </div>
          </div>
        </section>

        <aside className="col detail-demo">
          <div className="col-head">
            <span>示范素材</span>
          </div>
          <div className="demo-body">
            {demoSrc ? (
              <video className="demo-video" src={demoSrc} muted loop autoPlay playsInline controls />
            ) : (
              <div className="placeholder-block small">
                <strong>还没示范素材</strong>
                <span>回时间轴拖选区，点「把选区做成示范」——会自动生成静音小视频和封面，不用另传 GIF。</span>
              </div>
            )}
            <dl className="kv">
              <div>
                <dt>时长</dt>
                <dd className="num">{clipped ? `${(s1 - s0).toFixed(1)} 秒（可调）` : '—'}</dd>
              </div>
              {clipped ? (
                <div>
                  <dt>区间</dt>
                  <dd className="num">
                    {fmtPrecise(s0)} – {fmtPrecise(s1)}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>当前状态</dt>
                <dd>
                  <span className={`tag ${tag.cls}`}>{tag.label}</span>
                </dd>
              </div>
            </dl>
            <div className="btn-row wrap">
              <button type="button" className="btn sm primary" disabled={busy} onClick={() => void onAttachDemoNow(ex)}>
                把选区做成示范
              </button>
              <button type="button" className="btn sm" onClick={() => setDetailId(null)}>
                回时间轴
              </button>
            </div>
            <details className="local-upload">
              <summary>本地文件兜底</summary>
              <label className="btn sm upload-btn">
                选图片 / MP4
                <input
                  type="file"
                  hidden
                  accept="image/*,.gif,video/mp4,video/webm"
                  onChange={(e) => void onUploadSkuMedia(ex, e.target.files?.[0] || null)}
                />
              </label>
            </details>
          </div>
        </aside>
      </div>
    )
  }

  /* ── 弹窗 ── */

  function renderIngestModal() {
    const canStart =
      ingestKind === 'file' ? ingestFiles.length > 0 : ingestText.trim().length > 0
    return (
      <div className="modal-mask" role="dialog" aria-modal="true">
        <div className="modal wide">
          <h2>新建任务</h2>
          <p className="muted">三个入口，按你手上有什么选一个就行</p>
          <div className="sub-label">素材从哪来</div>
          <div className="choice-grid">
            {SOURCE_CARDS.map((c, i) => (
              <button key={c.id} type="button" className={`choice${ingestKind === c.id ? ' on' : ''}`} onClick={() => setIngestKind(c.id)}>
                <strong>
                  <span className="num-badge num">{i + 1}</span> {c.title}
                </strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>

          {ingestKind !== 'file' ? (
            <>
              <textarea
                rows={4}
                placeholder={
                  ingestKind === 'direct'
                    ? '粘贴视频直链（m3u8 / mp4 / 抖音 /video/ID），一行一条'
                    : '粘贴链接或分享口令，一行一条（带文字也行）：\n【某博主】练胸完整跟练 https://www.bilibili.com/video/BV1xx…'
                }
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
              />
              <p className="muted">支持 B站 / YouTube / 抖音口令。抓取失败时会自动转成「需补传」任务，不用重新建。</p>
            </>
          ) : (
            <label className="drop">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => setIngestFiles(e.target.files ? Array.from(e.target.files) : [])}
              />
              <strong>{ingestFiles.length ? `已选 ${ingestFiles.length} 个文件` : '选择本地 MP4 / 录屏'}</strong>
              <span>{ingestFiles.length ? ingestFiles.map((f) => f.name).join('、') : '可多选；录屏只录需要的那一段也行'}</span>
            </label>
          )}

          <div className="sub-label">这批怎么处理</div>
          <div className="choice-grid">
            {MODE_CARDS.map((c) => (
              <button key={c.id} type="button" className={`choice sm${ingestMode === c.id ? ' on' : ''}`} onClick={() => setIngestMode(c.id)}>
                <strong>{c.title}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>
          {ingestMode === 'plan_merge' ? (
            <label className="field">
              计划名（合成时填写更清晰）
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
            </label>
          ) : null}

          <label className="check">
            <input type="checkbox" checked={pauseConfirm} onChange={(e) => setPauseConfirm(e.target.checked)} />
            先停住等我确认，不要自动往下跑
          </label>

          <div className="btn-row end">
            <button type="button" className="btn ghost" onClick={() => setShowIngest(false)}>
              取消
            </button>
            <button type="button" className="btn primary" disabled={busy || !canStart} onClick={() => void onIngest()}>
              开始处理
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderRelinkModal() {
    return (
      <div className="modal-mask" role="dialog" aria-modal="true">
        <div className="modal">
          <h2>更换源链接 / 贴直链</h2>
          <p className="muted">
            可贴抖音分享口令、短链、m3u8 / mp4 直链，或网页地址栏（含 modal_id 的用户页弹窗链会自动转成 /video/ID）。
          </p>
          <textarea rows={5} placeholder="粘贴新链接或分享口令…" value={relinkText} onChange={(e) => setRelinkText(e.target.value)} />
          <div className="btn-row end">
            <button type="button" className="btn ghost" onClick={() => setShowRelink(false)}>
              取消
            </button>
            <button type="button" className="btn primary" disabled={busy || !relinkText.trim()} onClick={() => void onReplaceSource()}>
              确认更换并下载
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderSettingsModal() {
    const depRow = (label: string, ok: boolean | undefined) => (
      <span className={`tag ${ok === undefined ? 'mute' : ok ? 'ok' : 'amber'}`}>
        {label} {ok === undefined ? '检测中' : ok ? '可用' : '未装'}
      </span>
    )
    return (
      <div className="modal-mask" role="dialog" aria-modal="true">
        <div className="modal wide">
          <h2>设置</h2>

          <div className="sub-label">默认处理方式</div>
          <div className="choice-grid">
            {MODE_CARDS.map((c) => (
              <button key={c.id} type="button" className={`choice sm${defaultMode === c.id ? ' on' : ''}`} onClick={() => setDefaultMode(c.id)}>
                <strong>{c.title}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>
          <p className="muted">新建任务时会以此为初始选项，仍可逐次修改。</p>

          <div className="sub-label">环境</div>
          <div className="deps">
            {depRow('DeepSeek LLM', deps?.llm)}
            {deps?.llm && deps.llm_model ? <span className="tag info">{deps.llm_model}</span> : null}
            {depRow('yt-dlp', deps?.yt_dlp)}
            {depRow('ffmpeg', deps?.ffmpeg)}
            {depRow('faster-whisper', deps?.faster_whisper)}
          </div>

          <div className="sub-label">平台 Cookie</div>
          <p className="muted">
            抖音常拒纯 Cookie 头（403）。本机优先用浏览器直读；远程机用扩展导出 Netscape cookies.txt 粘贴。配置存 api/data/studio_cookies.json，不进 Git。
          </p>
          <div className="radio-row">
            <label>
              <input type="radio" name="cookie-source" checked={cookies.source === 'browser'} onChange={() => setCookies({ ...cookies, source: 'browser' })} />
              从本机浏览器读取（推荐）
            </label>
            <label>
              <input type="radio" name="cookie-source" checked={cookies.source === 'paste'} onChange={() => setCookies({ ...cookies, source: 'paste' })} />
              粘贴 Cookie / cookies.txt
            </label>
          </div>
          {cookies.source === 'browser' ? (
            <label className="field">
              浏览器
              <select value={cookies.browser} onChange={(e) => setCookies({ ...cookies, browser: e.target.value })}>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
                <option value="chromium">Chromium</option>
              </select>
              <span className="muted">先在该浏览器打开并登录 www.douyin.com；若报无法复制 Cookie 库，请先完全退出浏览器再点「重试一次」。</span>
            </label>
          ) : (
            <>
              <p className="muted">推荐扩展「Get cookies.txt LOCALLY」在抖音页导出后整段粘贴（Netscape 七列）。仅贴 a=1; b=2 头在抖音上经常仍会 403。</p>
              {(['douyin', 'bilibili', 'youtube'] as const).map((k) => (
                <label key={k} className="field">
                  {k}
                  <textarea rows={3} value={cookies[k]} onChange={(e) => setCookies({ ...cookies, [k]: e.target.value })} />
                </label>
              ))}
            </>
          )}
          <div className="btn-row end">
            <button type="button" className="btn ghost" onClick={() => setShowSettings(false)}>
              关闭
            </button>
            <button type="button" className="btn primary" onClick={() => void onSaveCookies()}>
              保存
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ───────────── 主渲染 ───────────── */

  const inDetail = Boolean(detailRow)
  let banner: ReactNode = null
  if (showSubBanner && task) {
    const noWhisper = deps ? !deps.faster_whisper : true
    const why = noWhisper
      ? '本机 API 没装 faster-whisper，自动字幕被跳过'
      : task.transcript_json?.warning || '没有识别出字幕段'
    banner = (
      <div className="warn-banner">
        <span className="icon-sq amber">!</span>
        <div className="warn-text">
          <strong>字幕没有生成：{why}</strong>
          <span>
            视频已经在本地。没装 whisper 时点「重跑」也不会出字幕——先按安装说明装好并重启 API，
            或者直接跳过、在右栏手填动作。
          </span>
          {showWhisperHelp ? (
            <code className="whisper-help">
              cd api && .\.venv\Scripts\python.exe -m pip install faster-whisper
              {'\n'}
              然后重启 uvicorn；首次转写会下载模型，要几分钟。
            </code>
          ) : null}
        </div>
        <div className="btn-row">
          <button type="button" className="btn sm" onClick={() => setShowWhisperHelp((v) => !v)}>
            {showWhisperHelp ? '收起说明' : '安装说明'}
          </button>
          <button type="button" className="btn sm" onClick={() => task && setSkipSubtitle((p) => ({ ...p, [task.id]: true }))}>
            跳过，手动填
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || noWhisper}
            title={noWhisper ? '请先安装 faster-whisper 再重跑' : undefined}
            onClick={() => void onRetranscribe()}
          >
            {noWhisper ? '先安装再重跑' : '重跑字幕'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="studio">
      <header className="studio-top">
        <div className="top-title">
          <h1>
            <span className="eyebrow">CONTENT STUDIO</span>
            <span className="title-sep" aria-hidden="true">
              /
            </span>
            <span className="title-zh">{inDetail ? '内容工坊 · 动作详情' : '内容工坊'}</span>
          </h1>
        </div>
        <div className="top-actions">
          {inDetail ? (
            <button type="button" className="btn ghost" onClick={() => setDetailId(null)}>
              返回清单
            </button>
          ) : null}
          <button type="button" className="btn primary new-task" onClick={openIngest}>
            ＋ 新建任务
          </button>
          <button type="button" className="btn settings" onClick={() => void openSettings()} title="设置" aria-label="设置">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.3 2h-4.6a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.31 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.43 14.6a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.05.24.25.42.49.42h4.6c.24 0 .44-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.24.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
            <span>设置</span>
          </button>
        </div>
      </header>

      {inDetail ? null : renderStepper()}
      {inDetail ? null : banner}

      {error ? (
        <div className="toast err" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError('')}>关闭</button>
        </div>
      ) : null}
      {notice ? <div className="toast ok">{notice}</div> : null}

      {detailRow ? (
        renderDetail(detailRow)
      ) : (
        <div className={`studio-grid${drawerOpen ? ' drawer-open' : ''}`}>
          {renderQueue()}
          <section className="col mid">{renderCenter()}</section>
          <section className="col right">
            <div className="col-head">
              <span>动作清单</span>
              <span className="num">
                {task && workbench && status === 'done' ? `${rows.length} 个 · 已切 ${clippedCount}` : '—'}
              </span>
              {renderRightTools()}
              <button type="button" className="drawer-close link" onClick={() => setDrawerOpen(false)}>
                收起
              </button>
            </div>
            {renderRight()}
          </section>
          <button type="button" className="drawer-toggle btn sm" onClick={() => setDrawerOpen(true)}>
            动作清单{rows.length ? ` (${rows.length})` : ''}
          </button>
        </div>
      )}

      <input
        ref={fallbackRef}
        type="file"
        hidden
        accept="video/*"
        onChange={(e) => void onFallback(e.target.files?.[0] || null)}
      />

      {showIngest ? renderIngestModal() : null}
      {showRelink ? renderRelinkModal() : null}
      {showSettings ? renderSettingsModal() : null}
    </div>
  )
}
