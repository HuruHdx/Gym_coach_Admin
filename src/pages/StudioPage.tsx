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
  pairStudioCues,
  quickCreateStudioExercise,
  reparseStudioTask,
  replaceStudioSource,
  retranscribeStudioTask,
  retryStudioDownload,
  saveStudioCookies,
  saveStudioDraft,
  updateExercise,
  uploadStudioFallback,
  uploadStudioTaskCover,
  writeStudioCues,
  type ExerciseListItem,
  type StudioCuePair,
  type StudioDraft,
  type StudioExerciseDraft,
  type StudioMatchCandidate,
  type StudioTask,
} from '../lib/api'
import { loading, toast } from '../feedback'
import './StudioPage.css'

/* ───────────── 常量 / 类型 ───────────── */

const TARGET_MUSCLES = ['胸', '背', '肩', '腿', '臂', '核心'] as const
const IN_PROGRESS = ['queued', 'downloading', 'transcribing', 'parsing'] as const
const STEP_LABELS = ['已入库', '已下载', '字幕', '切动作', '发布'] as const

type IngestKind = 'share' | 'direct' | 'file'
type IngestMode = 'plan_single' | 'plan_merge' | 'exercise_only'
type ProcessDegree = 'standard' | 'transcript' | 'assets'
type Traffic = 'red' | 'amber' | 'green'
type Sel = { start: number; end: number } | null
type LiveInfo = { percent?: number; size?: string; speed?: string; eta?: string; stage?: string }
type Row = { ex: StudioExerciseDraft; block: number; n: number }
type ProducedItem = {
  id: string
  kind: 'demo' | 'gif' | 'cover'
  label: string
  start?: number
  end?: number
  url?: string
}
type CookieState = {
  source: 'paste' | 'browser'
  browser: string
  bilibili: string
  douyin: string
  youtube: string
  bilibili_set?: boolean
  douyin_set?: boolean
  youtube_set?: boolean
}
type PlatformHit = { platform: 'bilibili' | 'douyin' | 'youtube' | 'direct'; label: string; id?: string }

const PROCESS_LS_KEY = 'studio.processDegree'
const BROWSER_LS_KEY = 'studio.cookieBrowser'

const SOURCE_CARDS: Array<{ id: IngestKind; title: string; desc: string }> = [
  {
    id: 'share',
    title: '贴链接',
    desc: 'B站 / 抖音 / YouTube 视频页地址，或分享口令',
  },
  {
    id: 'direct',
    title: '贴直链',
    desc: 'm3u8 / mp4 直链，绕开平台风控',
  },
  {
    id: 'file',
    title: '本地文件',
    desc: '已下载好的 MP4，或网页录屏',
  },
]

const DEGREE_CARDS: Array<{ id: ProcessDegree; title: string; desc: string }> = [
  {
    id: 'standard',
    title: '标准',
    desc: '转字幕 + 切动作 + 抽要点，不自动切素材',
  },
  {
    id: 'transcript',
    title: '只转字幕',
    desc: '先看文字，动作我自己填',
  },
  {
    id: 'assets',
    title: '连素材一起',
    desc: '每个动作按锚点附近自动切一段（会费时间）',
  },
]

const DEGREE_LABEL: Record<ProcessDegree, string> = {
  standard: '标准',
  transcript: '只转字幕',
  assets: '连素材一起',
}

function readStoredDegree(): ProcessDegree {
  try {
    const v = localStorage.getItem(PROCESS_LS_KEY)
    if (v === 'standard' || v === 'transcript' || v === 'assets') return v
  } catch {
    /* ignore */
  }
  return 'standard'
}

function readStoredBrowser(): string {
  try {
    return localStorage.getItem(BROWSER_LS_KEY) || 'chrome'
  } catch {
    return 'chrome'
  }
}

function degreeToMode(degree: ProcessDegree, merge: boolean): IngestMode {
  if (degree === 'assets') return 'exercise_only'
  if (merge) return 'plan_merge'
  return 'plan_single'
}

function detectPlatform(text: string, kind: IngestKind): PlatformHit | null {
  const raw = text.trim()
  if (!raw) return null
  if (kind === 'direct') return { platform: 'direct', label: '直链' }
  if (kind === 'file') return null
  const bv = raw.match(/BV[\w]+/i)?.[0]
  if (/bilibili\.com|b23\.tv/i.test(raw) || bv) {
    return { platform: 'bilibili', label: bv ? `B站 · ${bv}` : 'B站', id: bv }
  }
  if (/douyin\.com|iesdouyin\.com|v\.douyin/i.test(raw) || /复制此链接|抖音/i.test(raw)) {
    return { platform: 'douyin', label: '抖音' }
  }
  if (/youtube\.com|youtu\.be/i.test(raw)) {
    const id = raw.match(/(?:v=|youtu\.be\/)([\w-]{6,})/)?.[1]
    return { platform: 'youtube', label: id ? `YouTube · ${id}` : 'YouTube', id }
  }
  if (/^https?:\/\//i.test(raw) && /\.(m3u8|mp4)(\?|$)/i.test(raw)) {
    return { platform: 'direct', label: '直链' }
  }
  return null
}

function cookieReadyFor(
  platform: PlatformHit | null,
  cookies: CookieState,
  browserReady: boolean,
): boolean {
  if (browserReady && cookies.source === 'browser') return true
  if (!platform || platform.platform === 'direct') {
    return Boolean(cookies.bilibili_set || cookies.douyin_set || cookies.youtube_set)
  }
  if (platform.platform === 'bilibili') return Boolean(cookies.bilibili_set || cookies.bilibili.trim())
  if (platform.platform === 'douyin') return Boolean(cookies.douyin_set || cookies.douyin.trim())
  if (platform.platform === 'youtube') return Boolean(cookies.youtube_set || cookies.youtube.trim())
  return false
}

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
  // 12 §3.1：有 exercise_id 即绿；有候选未绑=黄；否则红
  if (ex.exercise_id) return 'green'
  if (ex.traffic === 'amber' || (ex.candidates && ex.candidates.length)) return 'amber'
  if (ex.traffic === 'red' || ex.traffic === 'amber' || ex.traffic === 'green') return ex.traffic
  return 'red'
}

function matchScoreOf(ex: StudioExerciseDraft): number {
  if (ex.match_score != null && Number.isFinite(Number(ex.match_score))) return Math.round(Number(ex.match_score))
  if (ex.match_confidence != null && Number.isFinite(Number(ex.match_confidence))) {
    const c = Number(ex.match_confidence)
    return Math.round(c <= 1 ? c * 100 : c)
  }
  return 0
}

function trafficText(t: Traffic) {
  return t === 'red' ? '红点 · 库外/新建' : t === 'amber' ? '黄点 · 点选候选即可' : '绿点 · 已绑定'
}

function cueModeLabel(mode: string | undefined) {
  if (mode === 'append') return '只加不换'
  if (mode === 'none') return '不入库'
  return '按上面的换（默认）'
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
  const [busy, setBusy] = useState(false)

  // 弹窗
  const [showIngest, setShowIngest] = useState(false)
  const [showRelink, setShowRelink] = useState(false)
  const [relinkText, setRelinkText] = useState('')

  // 新建任务
  const [ingestKind, setIngestKind] = useState<IngestKind>('share')
  const [processDegree, setProcessDegree] = useState<ProcessDegree>(() => readStoredDegree())
  const [mergePlans, setMergePlans] = useState(false)
  const [ingestText, setIngestText] = useState('')
  const [ingestFiles, setIngestFiles] = useState<File[]>([])
  const [planTitle, setPlanTitle] = useState('')
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieBrowserReady, setCookieBrowserReady] = useState(false)
  const [showDepsHelp, setShowDepsHelp] = useState(false)
  const [showSelMore, setShowSelMore] = useState(false)

  // Cookie / 环境（只读展示 + 就地读浏览器）
  const [deps, setDeps] = useState<{
    yt_dlp: boolean
    ffmpeg: boolean
    faster_whisper: boolean
    llm?: boolean
    llm_model?: string | null
  } | null>(null)
  const [cookies, setCookies] = useState<CookieState>({
    source: 'browser',
    browser: readStoredBrowser(),
    bilibili: '',
    douyin: '',
    youtube: '',
  })

  // 工作台
  const [sel, setSel] = useState<Sel>(null)
  const [duration, setDuration] = useState(0)
  const [curTime, setCurTime] = useState(0)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({})
  const [gifItems, setGifItems] = useState<ProducedItem[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [planInfoOpen, setPlanInfoOpen] = useState(false)
  const [activeBlockIdx, setActiveBlockIdx] = useState(-1)
  const [appendPlanId, setAppendPlanId] = useState('')
  const [skipSubtitle, setSkipSubtitle] = useState<Record<number, boolean>>({})
  const [showWhisperHelp, setShowWhisperHelp] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** 方案 A：要领对比抽屉（与左侧队列 drawer 分开） */
  const [cueDrawerRowId, setCueDrawerRowId] = useState<string | null>(null)
  const [cuePairs, setCuePairs] = useState<StudioCuePair[]>([])
  const [cuePairSummary, setCuePairSummary] = useState<{
    replace: number
    add: number
    keep?: number
    result_total: number
  } | null>(null)
  const [cuePairDegraded, setCuePairDegraded] = useState(false)
  const [cueDrawerMode, setCueDrawerMode] = useState<'replace' | 'append' | 'none'>('replace')
  const [renameBusy, setRenameBusy] = useState(false)

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
    setPreviewUrl(null)
    setClipUrls({})
    setGifItems([])
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
        if (alive) toast.err(err instanceof Error ? err.message : '加载失败')
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
  const amberCount = useMemo(() => rows.filter((r) => trafficOf(r.ex) === 'amber').length, [rows])
  const redCount = useMemo(() => rows.filter((r) => trafficOf(r.ex) === 'red').length, [rows])
  const bars = useMemo(() => fauxBars(task?.id || 1), [task?.id])
  const platformHit = useMemo(
    () => (ingestKind === 'file' ? null : detectPlatform(ingestText, ingestKind)),
    [ingestText, ingestKind],
  )
  const cookieOk = cookieReadyFor(platformHit, cookies, cookieBrowserReady)
  const producedItems = useMemo(() => {
    const items: ProducedItem[] = []
    if (draft.cover_url) {
      items.push({
        id: 'cover',
        kind: 'cover',
        label: '计划封面',
        url: mediaSrc(draft.cover_url) || undefined,
      })
    }
    for (const r of rows) {
      if (r.ex.media_status !== 'clipped') continue
      const start = Number(r.ex.snippet?.start ?? 0)
      const end = Number(r.ex.snippet?.end ?? start)
      items.push({
        id: `demo-${r.ex.id}`,
        kind: 'demo',
        label: r.ex.spoken_name || r.ex.exercise_name || `示范 ${r.n}`,
        start,
        end,
        url: clipUrls[r.ex.id],
      })
    }
    return [...items, ...gifItems]
  }, [draft.cover_url, rows, clipUrls, gifItems])

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
    if (pickerRowId === rowId) setPickerRowId(null)
    toast.ok(`已从清单移除「${label}」。点「存草稿」固化；SKU 若还在库里，可到动作库页下架。`)
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
    setActiveRowId(ex.id)
  }

  /* ── 操作：任务 ── */

  async function onIngest() {
    setBusy(true)
    try {
      await loading.wrap('提交任务…', async () => {
        const mode = degreeToMode(processDegree, mergePlans)
        try {
          localStorage.setItem(PROCESS_LS_KEY, processDegree)
        } catch {
          /* ignore */
        }
        const res = await ingestStudioBatch({
          text: ingestKind === 'file' ? '' : ingestText,
          mode,
          merge_into_one_plan: mode === 'plan_merge',
          plan_title: planTitle || undefined,
          files: ingestKind === 'file' ? ingestFiles : [],
          pause_for_confirm: false,
          source_kind: ingestKind,
        })
        setShowIngest(false)
        setIngestText('')
        setPlanTitle('')
        setIngestFiles([])
        setMergePlans(false)
        if (fileRef.current) fileRef.current.value = ''
        await reloadList()
        if (res.items[0]) await selectTask(res.items[0].id)
        toast.ok(`已提交 ${res.items.length} 个任务 · ${DEGREE_LABEL[processDegree]}`)
      })
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '入库失败')
    } finally {
      setBusy(false)
    }
  }

  async function openIngest() {
    setProcessDegree(readStoredDegree())
    setShowDepsHelp(false)
    setShowIngest(true)
    try {
      const data = await fetchStudioCookies()
      setCookies({
        source: data.source === 'paste' ? 'paste' : 'browser',
        browser: data.browser || readStoredBrowser(),
        bilibili: data.bilibili || '',
        douyin: data.douyin || '',
        youtube: data.youtube || '',
        bilibili_set: data.bilibili_set,
        douyin_set: data.douyin_set,
        youtube_set: data.youtube_set,
      })
      setCookieBrowserReady(data.source === 'browser' && Boolean(data.updated_at))
    } catch {
      setCookieBrowserReady(false)
    }
    fetchStudioDeps()
      .then(setDeps)
      .catch(() => undefined)
  }

  async function onReadCookiesFromBrowser() {
    setCookieBusy(true)
    try {
      const browser = cookies.browser || 'chrome'
      await saveStudioCookies({ source: 'browser', browser })
      try {
        localStorage.setItem(BROWSER_LS_KEY, browser)
      } catch {
        /* ignore */
      }
      const data = await fetchStudioCookies()
      setCookies({
        source: data.source === 'paste' ? 'paste' : 'browser',
        browser: data.browser || browser,
        bilibili: data.bilibili || '',
        douyin: data.douyin || '',
        youtube: data.youtube || '',
        bilibili_set: data.bilibili_set,
        douyin_set: data.douyin_set,
        youtube_set: data.youtube_set,
      })
      setCookieBrowserReady(true)
      toast.ok(`已改为从 ${browser} 读 Cookie（请完全退出浏览器后再下载）`)
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '读取 Cookie 失败')
    } finally {
      setCookieBusy(false)
    }
  }

  async function reloadActive(id: number) {
    await reloadList()
    await selectTask(id)
  }

  async function onFallback(file: File | null) {
    if (!file || activeId == null) return
    setBusy(true)
    try {
      await uploadStudioFallback(activeId, file)
      await reloadActive(activeId)
      toast.ok('已补传，流水线继续')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '补传失败')
    } finally {
      setBusy(false)
      if (fallbackRef.current) fallbackRef.current.value = ''
    }
  }

  async function onRetryDownload() {
    if (activeId == null) return
    setBusy(true)
    try {
      await retryStudioDownload(activeId)
      await reloadActive(activeId)
      toast.ok('已重新排队下载（Cookie 可在「新建任务」里从浏览器读取）')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '重新下载失败')
    } finally {
      setBusy(false)
    }
  }

  async function onReplaceSource() {
    if (activeId == null || !relinkText.trim()) return
    setBusy(true)
    try {
      await replaceStudioSource(activeId, relinkText.trim())
      setShowRelink(false)
      setRelinkText('')
      await reloadActive(activeId)
      toast.ok('已更换链接并重新排队下载')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '更换链接失败')
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
    try {
      await continueStudioPipeline(activeId)
      await reloadActive(activeId)
      toast.ok('已继续：转字幕 → 拆计划')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '继续失败')
    } finally {
      setBusy(false)
    }
  }

  async function onRetranscribe() {
    if (activeId == null) return
    setBusy(true)
    try {
      await retranscribeStudioTask(activeId)
      setSkipSubtitle((prev) => ({ ...prev, [activeId]: false }))
      await reloadActive(activeId)
      toast.ok('已重跑字幕')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '重跑字幕失败')
    } finally {
      setBusy(false)
    }
  }

  async function onReparse() {
    if (activeId == null) return
    setBusy(true)
    try {
      await loading.wrap('解析中…', async () => {
        const next = await reparseStudioTask(activeId)
        setTask(next)
        setDraft(asDraft(next.draft_json))
        const engine = (next.draft_json as StudioDraft | undefined)?.parse_engine
        toast.ok(
          engine === 'llm'
            ? `DeepSeek 已重拆 · ${next.exercise_count ?? next.score?.total ?? 0} 个动作`
            : `启发式兜底重拆 · ${next.exercise_count ?? next.score?.total ?? 0} 个动作（检查 LLM 配置）`,
        )
      })
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : 'LLM 重拆失败')
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
      if (!quiet) toast.ok('草稿已保存')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '保存失败')
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
      toast.ok('封面已上传')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '封面上传失败')
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
    try {
      const res = await previewStudioClip(activeId, sel.start, sel.end)
      setPreviewUrl(mediaSrc(res.demo_url))
      toast.ok(`已预览 ${(sel.end - sel.start).toFixed(1)} 秒。先点右侧某个动作，再出库才会写入该 SKU。`)
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '切片失败（需 ffmpeg）')
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
      toast.ok('已设为计划背景图（H5 计划详情顶图）。记得存草稿 / 发布。')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '设置计划背景失败（需 ffmpeg）')
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
      toast.ok(`已新建 SKU：${res.exercise.name_zh}`)
      return patch
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '新建失败')
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
      toast.err('请先在时间轴拖出 3～15 秒选区，再做成示范')
      return
    }
    setBusy(true)
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
      toast.ok(
        '已写入示范小视频+封面（要领默认仅本次；若要进库，在动作卡选「发布时追加/替换」，点底部发布时一并确认）',
      )
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '写入示范失败')
    } finally {
      setBusy(false)
    }
  }

  function adoptCandidate(ex: StudioExerciseDraft, hit: StudioMatchCandidate | ExerciseListItem) {
    const score = 'score' in hit && hit.score != null ? Number(hit.score) : 100
    patchExercise(ex.id, {
      exercise_id: hit.id,
      exercise_name: hit.name_zh,
      gear: hit.gear || ex.gear,
      target_muscle: hit.muscle || ex.target_muscle,
      match_score: score,
      match_confidence: score / 100,
      traffic: 'green',
      media_status: ex.media_status === 'clipped' ? 'clipped' : 'library',
    })
    setPickerRowId(null)
    toast.ok(`已选：${hit.name_zh}`)
  }

  async function openCueDrawer(ex: StudioExerciseDraft) {
    if (!ex.exercise_id) {
      toast.err('请先点选候选绑定动作，再写要领')
      return
    }
    if (activeId == null) return
    setCueDrawerRowId(ex.id)
    setCueDrawerMode((ex.cue_mode as 'replace' | 'append' | 'none') || 'replace')
    setBusy(true)
    try {
      const res = await pairStudioCues({
        task_id: activeId,
        row_id: ex.id,
        exercise_id: ex.exercise_id,
      })
      setCuePairs(res.pairs || [])
      setCuePairSummary(res.summary || null)
      setCuePairDegraded(Boolean(res.degraded))
      if (res.degraded) toast.err('自动配对超时，请人工点选每条「处理」')
    } catch (err: unknown) {
      setCuePairs([])
      setCuePairSummary(null)
      setCuePairDegraded(true)
      toast.err(err instanceof Error ? err.message : '配对失败，可人工填写')
    } finally {
      setBusy(false)
    }
  }

  function closeCueDrawer() {
    setCueDrawerRowId(null)
    setCuePairs([])
    setCuePairSummary(null)
    setCuePairDegraded(false)
  }

  async function onExportGif() {
    if (activeId == null || !sel) return
    setBusy(true)
    try {
      const res = await previewStudioClip(activeId, sel.start, sel.end)
      const url = mediaSrc(res.demo_url) || undefined
      setPreviewUrl(url || null)
      const id = `gif-${Date.now()}`
      setGifItems((prev) => [
        ...prev,
        {
          id,
          kind: 'gif',
          label: `GIF 预览 ${(sel.end - sel.start).toFixed(0)}s`,
          start: sel.start,
          end: sel.end,
          url,
        },
      ])
      toast.ok('已生成预览片段，GIF 导出后续接')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '预览失败（需 ffmpeg）')
    } finally {
      setBusy(false)
    }
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
    const allEx = rows.map((r) => r.ex)
    const demoN = allEx.filter((e) => e.attach_demo || e.replace_demo).length
    const unbound = allEx.filter((e) => !e.exercise_id).length
    const lines = [
      isExerciseOnly
        ? `将写入动作库：示范约 ${demoN} 条（不建计划）。要领需在抽屉里单独写进库。`
        : publish
          ? '将发布计划上线。要领需已在抽屉里写进库的才会进总库。'
          : '将存为草稿计划。',
      unbound ? `仍有 ${unbound} 个未绑定，不能发布。` : '动作均已绑定。',
    ]
    if (unbound && publish) {
      toast.err(`还有 ${unbound} 个未绑定`)
      return
    }
    if (!window.confirm(lines.join('\n'))) return
    setBusy(true)
    try {
      const res = await confirmStudioPlan({
        task_id: activeId,
        draft: { ...draft, mode: isExerciseOnly ? 'exercise_only' : draft.mode },
        append_to_plan_id: isExerciseOnly ? null : appendPlanId.trim() || null,
        publish: isExerciseOnly ? false : publish,
      })
      if (isExerciseOnly) {
        toast.ok(`已写入示范 ${res.attached ?? 0} 条`)
      } else if (res.plan_id) {
        toast.ok(`已写入计划 ${res.plan_id}`)
        navigate(`/plans/${encodeURIComponent(res.plan_id)}`)
      }
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '发布失败')
    } finally {
      setBusy(false)
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

  function renderRoleTag(kind: 'readonly' | 'ops') {
    return (
      <span className={`role-tag ${kind === 'readonly' ? 'readonly' : 'ops'}`}>
        {kind === 'readonly' ? '只读' : '操作区'}
      </span>
    )
  }

  function renderQueue() {
    return (
      <aside className="col queue">
        <div className="col-head">
          <span className="col-head-title">
            任务队列
            {renderRoleTag('readonly')}
          </span>
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
          {!tasks.length ? <li className="empty-note">暂无任务，点下方「＋ 新建任务」</li> : null}
        </ul>
        <div className="queue-foot">
          <button type="button" className="btn sm queue-new" onClick={() => void openIngest()}>
            ＋ 新建任务
          </button>
        </div>
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
                选区 {fmtPrecise(sel.start)} → {fmtPrecise(sel.end)}
                <span className="pill">{(sel.end - sel.start).toFixed(1)}s</span>
              </>
            ) : (
              <span className="muted">未选择区间 · 在波形上拖一段</span>
            )}
            {activeRow ? (
              <span className="selbar-target">挂到「{activeRow.ex.spoken_name || activeRow.ex.exercise_name}」</span>
            ) : null}
          </div>
          <div className="selbar-actions">
            <button type="button" className="btn sm" disabled={!sel} onClick={() => playSelection()}>
              播这段
            </button>
            <button type="button" className="btn sm" disabled={!sel || busy || isExerciseOnly} onClick={() => void onSetCover()}>
              设封面
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!sel || busy}
              title="后端暂无真 GIF 导出；会先生成预览片段"
              onClick={() => void onExportGif()}
            >
              导 GIF
            </button>
            <button type="button" className="btn sm accent-fill" disabled={!sel || busy} onClick={() => void onClipOut()}>
              出库示范
            </button>
            <button type="button" className="link sel-more" onClick={() => setShowSelMore((v) => !v)}>
              {showSelMore ? '收起' : '更多'}
            </button>
          </div>
        </div>
        {showSelMore ? (
          <div className="selbar-secondary">
            <button type="button" className="btn sm" onClick={setStartFromPlayhead} disabled={!duration}>
              起点=播放头
            </button>
            <button type="button" className="btn sm" onClick={setEndFromPlayhead} disabled={!duration}>
              终点=播放头
            </button>
          </div>
        ) : null}
        {producedItems.length ? (
          <div className="produced-strip" aria-label="本次产出">
            <span className="produced-label">
              本次产出 · {producedItems.length} 条
              <span className="role-tag produce">产出</span>
            </span>
            <div className="produced-list">
              {producedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`produced-chip ${item.kind}`}
                  onClick={() => {
                    if (item.start != null && item.end != null) {
                      setSel({ start: item.start, end: item.end })
                      seekTo(item.start)
                    }
                  }}
                  title={item.label}
                >
                  {item.url && item.kind !== 'gif' ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <span className="produced-ico">{item.kind === 'cover' ? '封面' : item.kind === 'gif' ? 'GIF' : '示范'}</span>
                  )}
                  <em>
                    {item.kind === 'cover'
                      ? '计划封面'
                      : item.start != null && item.end != null
                        ? `${(item.end - item.start).toFixed(0)}s`
                        : item.label}
                  </em>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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

  function renderBindBlock(ex: StudioExerciseDraft) {
    const score = matchScoreOf(ex)
    const cands = (ex.candidates || []).slice(0, 5)
    return (
      <div className="action-card-block">
        <div className="action-card-k">
          绑定 <span className="muted">点选即生效 · {score} 分</span>
        </div>
        {ex.exercise_id ? (
          <p className="action-card-v">
            已选 <span className="num">{ex.exercise_id}</span>
            {ex.exercise_name ? ` · ${ex.exercise_name}` : ''}
          </p>
        ) : (
          <p className="muted">未选 · 点下面候选，或搜库 / 新建</p>
        )}
        {cands.length ? (
          <ul className="cand-list">
            {cands.map((c) => {
              const on = c.id === ex.exercise_id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`cand-btn${on ? ' on' : ''}`}
                    onClick={() => adoptCandidate(ex, c)}
                  >
                    <span className="cand-name">{c.name_zh}</span>
                    <span className="cand-meta">
                      {c.muscle || ''}
                      {c.gear ? ` · ${c.gear}` : ''}
                      {c.has_demo ? ' · 有示范' : ''}
                      {' · '}
                      <span className="num">{c.score}</span>分
                      {c.reason ? ` · ${c.reason}` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="muted tight">库内暂无相近候选 → 可新建</p>
        )}
        <div className="ops-line">
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
          <button type="button" className="btn sm" disabled={busy} onClick={() => void onQuickCreate(ex)}>
            ＋ 新建动作
          </button>
        </div>
        {pickerRowId === ex.id ? (
          <div className="picker">
            <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="搜动作" autoFocus />
            <ul>
              {pickerHits.map((hit) => (
                <li key={hit.id}>
                  <button type="button" onClick={() => adoptCandidate(ex, hit)}>
                    {hit.name_zh}
                    <span>{hit.muscle}</span>
                  </button>
                </li>
              ))}
              {pickerQ.trim() && !pickerHits.length ? <li className="muted pad">库里没搜到</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  function renderListRow(r: Row) {
    const t = trafficOf(r.ex)
    const tag = mediaTag(r.ex)
    const at = anchorOf(r.ex)
    const on = r.ex.id === activeRowId
    const cue0 = (r.ex.cues || [])[0]?.text
    const statusLabelText =
      t === 'red' ? '库外' : t === 'amber' ? '待候选' : tag.label === '已切 ✓' ? '已切' : tag.label === '用库里' ? '用库里' : '已绑'
    return (
      <li key={r.ex.id} className={`arow${on ? ' on' : ''}`}>
        <button type="button" className="arow-btn" onClick={() => activateRow(r.ex, { toggle: true })}>
          <span className="arow-n num">{r.n}</span>
          <span className={`dot ${t}`} title={trafficText(t)} />
          <span className="arow-body">
            <span className="arow-name">{r.ex.spoken_name || r.ex.exercise_name || '未命名'}</span>
            {cue0 ? <span className="arow-cue">{cue0}</span> : null}
          </span>
          <span className="arow-sets num">{setsText(r.ex)}</span>
          {at !== undefined ? <span className="arow-at num">{fmtAnchor(at)}</span> : null}
          <span className={`tag ${t === 'red' ? 'red' : t === 'amber' ? 'amber' : tag.cls}`}>{statusLabelText}</span>
        </button>
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

  function renderFooter() {
    const empty = rows.length === 0
    const primaryLabel = isExerciseOnly ? '写入动作库' : '发布'
    const statusText =
      empty
        ? '还没有动作'
        : pendingAll
          ? `${amberCount} 个待绑定 · ${redCount} 个库外 / 修完才能发布`
          : '都绑好了，可以发布'
    return (
      <div className="right-foot">
        <p className="foot-status">{statusText}</p>
        <div className="foot-actions">
          <button type="button" className="btn" disabled={busy || !task} onClick={() => void onSaveDraft()}>
            存草稿
          </button>
          <button type="button" className="btn primary" disabled={busy || empty} onClick={() => void onConfirm(true)}>
            {primaryLabel}
          </button>
        </div>
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

    const hasTranscript = segments.length > 0 || Boolean(task?.transcript_json?.text)
    const reparseBtn = hasTranscript ? (
      <button
        type="button"
        className="btn sm ghost-inline"
        disabled={busy}
        title="不重转字幕，只用 DeepSeek 按现有口播重拆"
        onClick={() => void onReparse()}
      >
        LLM 重拆
      </button>
    ) : null

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
              <div className="btn-row">
                <button type="button" className="btn sm" onClick={addManualRow}>
                  ＋ 手动加一行
                </button>
                {reparseBtn}
              </div>
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
            <div className="section-title">
              <strong>动作清单</strong>
              {reparseBtn}
            </div>
            <p className="muted">仅存动作素材：绑 SKU → 中栏选区「出库示范」→ 写入动作库（不建计划）</p>
            <ul className="alist">{visibleRows.map((r) => renderListRow(r))}</ul>
            <button type="button" className="btn sm" onClick={addManualRow}>
              ＋ 手动加一行
            </button>
          </div>
          {activeRow ? renderActionCard(activeRow) : null}
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
            <strong>
              动作清单 · <span className="num">{visibleRows.length}</span>
            </strong>
            <span className="muted">
              待处理 {pendingAll}
              {clippedCount ? ` · 已切 ${clippedCount}` : ''}
            </span>
            {reparseBtn}
          </div>
          <ul className="alist">{visibleRows.map((r) => renderListRow(r))}</ul>
          <div className="legend">
            <span><i className="dot green" /> 绿 · 绑定可信</span>
            <span><i className="dot amber" /> 黄 · 待候选</span>
            <span><i className="dot red" /> 红 · 库外</span>
          </div>
          <button type="button" className="btn sm" onClick={addManualRow}>
            ＋ 手动加一行
          </button>
        </div>
        {activeRow ? renderActionCard(activeRow) : null}
        {renderFooter()}
      </>
    )
  }

  /* ── 动作详情 (05) ── */

  function renderActionCard(r: Row) {
    const ex = r.ex
    const t = trafficOf(ex)
    const at = anchorOf(ex)
    const statusText = t === 'red' ? '库外' : t === 'amber' ? '待候选' : '已绑'
    return (
      <div className="action-card" role="region" aria-label="动作卡 · 只绑定">
        <div className="action-card-head">
          <span className={`dot ${t}`} />
          <strong>
            No.{r.n}{' '}
            <input
              className="action-card-name"
              value={ex.spoken_name || ex.exercise_name || ''}
              onChange={(e) => {
                const name = e.target.value
                patchExercise(ex.id, {
                  spoken_name: name,
                  ...(ex.exercise_id ? {} : { exercise_name: name }),
                })
              }}
              aria-label="口播名"
            />
          </strong>
          <span className={`tag ${t === 'green' ? 'ok' : t === 'amber' ? 'amber' : 'red'}`}>{statusText}</span>
          {at !== undefined ? <span className="muted num">{fmtAnchor(at)}</span> : null}
          <button type="button" className="link" onClick={() => setActiveRowId(null)}>
            收起
          </button>
        </div>

        <div className="action-card-meta">
          <label>
            组
            <input
              className="num"
              type="number"
              min={1}
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
              onChange={(e) =>
                patchExercise(ex.id, { target_reps: e.target.value, sets_from_transcript: true })
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
          <span className="muted">
            {roleLabel(ex.role)}
            {ex.gear ? ` · ${ex.gear}` : ''}
          </span>
        </div>

        {renderBindBlock(ex)}

        <div className="action-card-foot">
          <button
            type="button"
            className="btn"
            disabled={!ex.exercise_id || busy}
            onClick={() => void openCueDrawer(ex)}
          >
            打开要领抽屉
          </button>
          <button type="button" className="btn danger sm" onClick={() => removeExerciseRow(ex.id)}>
            删除本行
          </button>
        </div>
      </div>
    )
  }

  function renderCueDrawer() {
    if (!cueDrawerRowId) return null
    const r = rows.find((x) => x.ex.id === cueDrawerRowId)
    if (!r) return null
    const ex = r.ex
    const backup = ex.cues_library_backup
    const segs = (task?.transcript_json?.segments || []) as { start?: number; text?: string }[]
    const spokenAt = Number(ex.spoken_at ?? ex.snippet?.spoken_at ?? 0)
    const nearby = segs
      .filter((s) => {
        const st = Number(s.start || 0)
        return Math.abs(st - spokenAt) <= 20
      })
      .slice(0, 8)

    return (
      <div className="cue-drawer-root" role="dialog" aria-label="要领对比抽屉">
        <button type="button" className="cue-drawer-mask" aria-label="关闭" onClick={closeCueDrawer} />
        <aside className="cue-drawer">
          <header className="cue-drawer-head">
            <div>
              <strong>{ex.exercise_name || ex.spoken_name}</strong>
              <span className="muted num"> {ex.exercise_id}</span>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={!ex.exercise_id || renameBusy || !ex.spoken_name}
              onClick={() => {
                if (!ex.exercise_id || !ex.spoken_name) return
                void (async () => {
                  setRenameBusy(true)
                  try {
                    await updateExercise(ex.exercise_id!, { name_zh: ex.spoken_name })
                    patchExercise(ex.id, { exercise_name: ex.spoken_name })
                    toast.ok('已改名并对齐叫法（旧名进别名）')
                  } catch (err: unknown) {
                    toast.err(err instanceof Error ? err.message : '改名失败')
                  } finally {
                    setRenameBusy(false)
                  }
                })()
              }}
            >
              改名对齐叫法
            </button>
            <button type="button" className="link cue-drawer-x" onClick={closeCueDrawer}>
              ×
            </button>
          </header>

          <div className="cue-drawer-body">
            <div className="action-card-k">
              要领对比 {cuePairDegraded ? <span className="tag amber">待判断</span> : null}
            </div>
            <table className="cue-pair-table">
              <thead>
                <tr>
                  <th>库里现在</th>
                  <th>这次视频</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {cuePairs.length ? (
                  cuePairs.map((p, i) => (
                    <tr key={i}>
                      <td className={p.relation === 'replace' ? 'strike muted' : ''}>
                        {p.library_cue || <span className="muted">库里没有</span>}
                      </td>
                      <td>
                        {p.draft_cue || <span className="muted">—</span>}
                        {p.relation === 'add' ? <span className="tag amber">新增</span> : null}
                      </td>
                      <td>
                        <select
                          value={p.relation}
                          onChange={(e) => {
                            const next = [...cuePairs]
                            next[i] = { ...p, relation: e.target.value, pending: false }
                            setCuePairs(next)
                          }}
                        >
                          <option value="replace">换掉</option>
                          <option value="keep">保留</option>
                          <option value="add">新增</option>
                        </select>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="muted">
                      暂无配对结果
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {cuePairSummary ? (
              <p className="muted tight">
                换 {cuePairSummary.replace} · 加 {cuePairSummary.add}
                {cuePairSummary.keep != null ? ` · 留 ${cuePairSummary.keep}` : ''} → 约{' '}
                {cuePairSummary.result_total} 条
              </p>
            ) : null}

            <div className="cue-mode-row">
              {(['replace', 'append', 'none'] as const).map((m) => (
                <label key={m} className={`cue-mode-opt${cueDrawerMode === m ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="cue-mode"
                    checked={cueDrawerMode === m}
                    onChange={() => setCueDrawerMode(m)}
                  />
                  {cueModeLabel(m)}
                </label>
              ))}
            </div>

            <button
              type="button"
              className="btn accent-outline"
              disabled={busy || cueDrawerMode === 'none'}
              onClick={() => {
                if (activeId == null) return
                void (async () => {
                  setBusy(true)
                  try {
                    const res = await writeStudioCues({
                      task_id: activeId,
                      row_id: ex.id,
                      cue_mode: cueDrawerMode,
                      pairs: cuePairs,
                    })
                    if (!res.ok) {
                      toast.err(res.message || res.reason || '未写入')
                      return
                    }
                    patchExercise(ex.id, {
                      cue_mode: cueDrawerMode,
                      cues_library_backup: (res.backup as StudioExerciseDraft['cues_library_backup']) || ex.cues_library_backup,
                    })
                    toast.ok('要领已写进库')
                  } catch (err: unknown) {
                    toast.err(err instanceof Error ? err.message : '写入失败')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              把要领写进库
            </button>
            <p className="muted tight">不点就只留在这条视频的草稿里</p>

            <details className="cue-drawer-block">
              <summary>这段原话（只读）</summary>
              <ul className="cue-quote-list">
                {nearby.length ? (
                  nearby.map((s, i) => (
                    <li key={i}>
                      <span className="num">{fmtMmss(Number(s.start || 0))}</span> {s.text}
                    </li>
                  ))
                ) : (
                  <li className="muted">附近没有字幕</li>
                )}
              </ul>
            </details>

            <details className="cue-drawer-block">
              <summary>历史要领（只读）</summary>
              {backup ? (
                <div className="cue-history">
                  <p className="muted tight">
                    {(backup as { replaced_at?: string }).replaced_at
                      ? `替换于 ${(backup as { replaced_at?: string }).replaced_at}`
                      : '最近一次覆盖前'}
                  </p>
                  <ul>
                    {(backup.cues_zh || []).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted">还没有覆盖留档</p>
              )}
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
    const linkMode = ingestKind !== 'file'
    const hardBlock = linkMode && deps && !deps.yt_dlp
    const cookieHint = cookieOk
      ? 'Cookie 已配'
      : platformHit?.platform === 'bilibili' || !platformHit
        ? 'Cookie 未配 · 720P 可用'
        : 'Cookie 未配'
    return (
      <div className="modal-mask" role="dialog" aria-modal="true">
        <div className="modal wide ingest-modal">
          <div className="modal-head">
            <div>
              <h2>新建任务</h2>
              <p className="muted">进入口 → 选模式 → 开始</p>
            </div>
            <button type="button" className="link" onClick={() => setShowIngest(false)} aria-label="关闭">
              ✕
            </button>
          </div>

          <div className="sub-label">素材怎么来 · 三选一</div>
          <div className="choice-grid">
            {SOURCE_CARDS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`choice${ingestKind === c.id ? ' on' : ''}`}
                onClick={() => setIngestKind(c.id)}
              >
                <strong>{c.title}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>

          {linkMode ? (
            <>
              <div className="link-input-wrap">
                <textarea
                  rows={3}
                  placeholder={
                    ingestKind === 'direct'
                      ? '粘贴 m3u8 / mp4 直链，一行一条'
                      : '粘贴链接或分享口令，一行一条：\n【某博主】练胸完整跟练 https://www.bilibili.com/video/BV1xx…'
                  }
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                />
                {ingestText ? (
                  <button type="button" className="link clear-link" onClick={() => setIngestText('')}>
                    清空
                  </button>
                ) : null}
              </div>
              <div className="cookie-row">
                <span className={`plat-hit${platformHit ? ' ok' : ''}`}>
                  {platformHit ? (
                    <>
                      <i className="dot green" /> 已识别 {platformHit.label}
                    </>
                  ) : ingestText.trim() ? (
                    <>未识别平台 · 仍可尝试</>
                  ) : (
                    <>贴链接后自动识别平台</>
                  )}
                </span>
                <span className="cookie-status">
                  <span className={cookieOk ? 'tone-ok' : 'tone-warn'}>{cookieHint}</span>
                  <select
                    className="browser-select"
                    value={cookies.browser}
                    onChange={(e) => setCookies({ ...cookies, browser: e.target.value, source: 'browser' })}
                    aria-label="浏览器"
                  >
                    <option value="chrome">Chrome</option>
                    <option value="edge">Edge</option>
                    <option value="firefox">Firefox</option>
                    <option value="brave">Brave</option>
                    <option value="chromium">Chromium</option>
                  </select>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={cookieBusy}
                    onClick={() => void onReadCookiesFromBrowser()}
                  >
                    {cookieBusy ? '读取中…' : '从浏览器读取'}
                  </button>
                </span>
              </div>
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
              <span>{ingestFiles.length ? ingestFiles.map((f) => f.name).join('、') : '可多选'}</span>
            </label>
          )}

          <div className="sub-label spread">
            <span>处理到什么程度 · 按这条视频</span>
            {processDegree !== 'assets' ? (
              <label className="check inline">
                <input type="checkbox" checked={mergePlans} onChange={(e) => setMergePlans(e.target.checked)} />
                合成一套分化
              </label>
            ) : null}
          </div>
          <div className="choice-grid">
            {DEGREE_CARDS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`choice sm${processDegree === c.id ? ' on' : ''}`}
                onClick={() => {
                  setProcessDegree(c.id)
                  if (c.id === 'assets') setMergePlans(false)
                }}
              >
                <strong>{c.title}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>
          {mergePlans && processDegree !== 'assets' ? (
            <label className="field">
              计划名（合成时更清晰）
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
            </label>
          ) : null}

          <div className={`deps-bar${deps && (!deps.ffmpeg || !deps.yt_dlp) ? ' alert' : ''}`}>
            <span className={deps?.yt_dlp ? 'dep ok' : 'dep bad'}>
              {deps?.yt_dlp ? '✓' : '⚠'} yt-dlp{deps && !deps.yt_dlp ? ' 未装' : ''}
            </span>
            <span className={deps?.faster_whisper ? 'dep ok' : 'dep warn'}>
              {deps?.faster_whisper ? '✓' : '⚠'} faster-whisper{deps && !deps.faster_whisper ? ' 未装' : ''}
            </span>
            <span className={deps?.ffmpeg ? 'dep ok' : 'dep bad'}>
              {deps?.ffmpeg ? '✓ ffmpeg' : '⚠ ffmpeg 未装 · 音视频合并会失败'}
            </span>
            {deps?.llm ? (
              <span className="dep ok" title={deps.llm_model || ''}>
                ✓ LLM{deps.llm_model ? ` · ${deps.llm_model}` : ''}
              </span>
            ) : null}
            <button type="button" className="link deps-help-btn" onClick={() => setShowDepsHelp((v) => !v)}>
              看装法
            </button>
          </div>
          {showDepsHelp ? (
            <code className="deps-help">
              pip install yt-dlp faster-whisper
              {'\n'}
              ffmpeg 装好后加入 PATH，并重启 API（uvicorn）
              {'\n'}
              读 Cookie 前请完全退出所选浏览器，否则可能锁库读不到
            </code>
          ) : null}
          {hardBlock ? (
            <p className="muted tone-warn">未装 yt-dlp 时链接下载会失败；可改用「本地文件」，或先装好再开始。</p>
          ) : null}

          <div className="ingest-foot">
            <p className="muted">
              这条视频按「{DEGREE_LABEL[processDegree]}」
              {mergePlans && processDegree !== 'assets' ? ' · 合成分化' : ''}，下次记住
            </p>
            <div className="btn-row end">
              <button type="button" className="btn ghost" onClick={() => setShowIngest(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !canStart || Boolean(hardBlock)}
                onClick={() => void onIngest()}
              >
                开始处理
              </button>
            </div>
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

  /* ───────────── 主渲染 ───────────── */

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

  const titleZh = task ? `内容工坊 / ${taskTitle(task)}` : '内容工坊'

  function backToQueue() {
    setActiveId(null)
    setTask(null)
    setDraft({ plan_title: '', blocks: [] })
    setSel(null)
    setDuration(0)
    setCurTime(0)
    setActiveRowId(null)
    setPreviewUrl(null)
    setClipUrls({})
    setGifItems([])
    setPickerRowId(null)
    setDrawerOpen(false)
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
            <span className="title-zh">{titleZh}</span>
          </h1>
        </div>
        <div className="top-actions">
          {task ? (
            <button type="button" className="btn ghost back-queue" onClick={backToQueue}>
              ← 回任务列表
            </button>
          ) : null}
          <button type="button" className="btn primary new-task" onClick={() => void openIngest()}>
            ＋ 新建任务
          </button>
        </div>
      </header>

      {task ? renderStepper() : null}
      {banner}

      <div className={`studio-grid${drawerOpen ? ' drawer-open' : ''}`}>
        {renderQueue()}
        <section className="col mid">
          <div className="col-head">
            <span className="col-head-title">
              视频与时间轴
              {renderRoleTag('ops')}
            </span>
            <span className="num">{duration ? fmtMmss(duration) : '—'}</span>
          </div>
          <div className="mid-body">{renderCenter()}</div>
        </section>
        <section className="col right">
          <div className="col-head">
            <span className="col-head-title">
              动作清单
              {renderRoleTag('ops')}
            </span>
            <span className="num">
              {task && workbench && status === 'done' ? `${rows.length} 个 · 已切 ${clippedCount}` : '—'}
            </span>
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

      <input
        ref={fallbackRef}
        type="file"
        hidden
        accept="video/*"
        onChange={(e) => void onFallback(e.target.files?.[0] || null)}
      />

      {showIngest ? renderIngestModal() : null}
      {showRelink ? renderRelinkModal() : null}
      {renderCueDrawer()}
    </div>
  )
}
