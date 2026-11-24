import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  attachStudioDemo,
  confirmStudioPlan,
  continueStudioPipeline,
  deleteStudioTask,
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
  skipStudioTranscribe,
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
const DEMO_MIN_SEC = 2
const DEMO_MAX_SEC = 15
/**
 * 微调窗口：选区大约只占中间 28%，左右留白。
 * 不再把窗口卡在 90s——选区一长就会铺满整条，两端贴边只能整段拖。
 */
function computeZoomView(range: { start: number; end: number }, dur: number) {
  const selDur = Math.max(0.5, range.end - range.start)
  const spanTarget = Math.max(20, selDur / 0.28)
  if (dur <= 0) {
    const start = Math.max(0, range.start - spanTarget * 0.36)
    return { start, end: start + spanTarget }
  }
  const span = Math.min(dur, spanTarget)
  const mid = (range.start + range.end) / 2
  let start = mid - span / 2
  let end = mid + span / 2
  if (start < 0) {
    end = Math.min(dur, end - start)
    start = 0
  }
  if (end > dur) {
    start = Math.max(0, start - (end - dur))
    end = dur
  }
  return { start, end }
}

type LiveInfo = {
  percent?: number
  size?: string
  speed?: string
  eta?: string
  stage?: string
  detail?: string
}
type Row = { ex: StudioExerciseDraft; block: number; n: number }
type ProducedItem = {
  id: string
  kind: 'demo' | 'cover'
  label: string
  start?: number
  end?: number
  url?: string
  /** 本次切片钉住的封面/示范，区别于库内旧示范回填 */
  fromSession?: boolean
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

/** ≥90 且非含糊：自动预填主命中（后端通常已写；前端兜底） */
function withAutoBind(ex: StudioExerciseDraft): StudioExerciseDraft {
  if (ex.exercise_id) {
    return ex.traffic === 'green' ? ex : { ...ex, traffic: 'green' }
  }
  const top = [...(ex.candidates || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]
  if (!top || Number(top.score) < 90) return ex
  return {
    ...ex,
    exercise_id: top.id,
    exercise_name: top.name_zh,
    gear: top.gear || ex.gear,
    target_muscle: top.muscle || ex.target_muscle,
    match_score: Number(top.score),
    match_confidence: Number(top.score) / 100,
    traffic: 'green',
    media_status: ex.media_status === 'clipped' ? 'clipped' : ex.media_status || 'library',
  }
}

function asDraft(raw: StudioTask['draft_json']): StudioDraft {
  const d = (raw || {}) as StudioDraft
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).map((b) => ({
    ...b,
    exercises: (b.exercises || []).map(withAutoBind),
  }))
  return {
    plan_title: d.plan_title || '',
    scene_tag: d.scene_tag || '热门计划',
    cover_url: d.cover_url || '',
    mode: d.mode,
    blocks,
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

function taskPublished(t: StudioTask) {
  const ref = t.result_ref || {}
  if (t.review_state === 'published') return true
  if (ref.published === true) return true
  if (typeof ref.plan_id === 'string' && ref.plan_id && ref.published !== false) return true
  return false
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
    if (taskPublished(t)) {
      return { label: '已发布', tone: 'ok' }
    }
    if (t.review_state === 'drafted') {
      return { label: '已存草稿', tone: 'ok' }
    }
    const segs = t.transcript_json?.segments || []
    const warn = Boolean(t.transcript_json?.warning)
    const n = Number(t.exercise_count ?? t.score?.total ?? 0)
    if (!segs.length || warn) return { label: '缺字幕', tone: 'amber' }
    if (n <= 0) return { label: '未拆出动作', tone: 'amber' }
    const draft = (t.draft_json || {}) as StudioDraft
    const unbound = (draft.blocks || []).some((b) =>
      (b.exercises || []).some((ex) => ex.source_kind !== 'missing' && ex.spoken_name !== '待人工补充' && !ex.exercise_id),
    )
    if (unbound) return { label: `待绑定 · ${n}`, tone: 'amber' }
    return { label: `可发布 · ${n}`, tone: 'ok' }
  }
  return { label: statusLabel(t.status), tone: 'run' }
}

function clipMetaFromDraft(d: StudioDraft): Record<string, { demo?: string; cover?: string }> {
  const out: Record<string, { demo?: string; cover?: string }> = {}
  for (const b of d.blocks || []) {
    for (const ex of b.exercises || []) {
      const demo = mediaSrc(ex.demo_url || null) || undefined
      const cover = mediaSrc(ex.demo_cover_url || null) || undefined
      if (demo || cover) out[ex.id] = { demo, cover }
    }
  }
  return out
}

/** 合并示范缓存：草稿有值优先；本次切片钉住的行不被旧缓存盖掉 */
function mergeClipMeta(
  fromDraft: Record<string, { demo?: string; cover?: string }>,
  prev: Record<string, { demo?: string; cover?: string }>,
  pins: Record<string, { demo?: string; cover?: string }>,
): Record<string, { demo?: string; cover?: string }> {
  const ids = new Set([...Object.keys(fromDraft), ...Object.keys(prev), ...Object.keys(pins)])
  const out: Record<string, { demo?: string; cover?: string }> = {}
  for (const id of ids) {
    const pin = pins[id]
    if (pin?.demo || pin?.cover) {
      out[id] = { demo: pin.demo, cover: pin.cover }
      continue
    }
    const d = fromDraft[id]
    const p = prev[id]
    const demo = d?.demo || p?.demo
    const cover = d?.cover || p?.cover
    if (demo || cover) out[id] = { demo, cover }
  }
  return out
}

function stageLabel(stage?: string) {
  const map: Record<string, string> = {
    downloading: '下载中',
    merging: '合流阶段',
    merge: '合流阶段',
    awaiting_confirm: '等你确认',
    extract_audio: '抽音轨',
    load_model: '加载模型',
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

/** 名字归一：去空白、小写，用于同名查重（展示仍用原文 + 部位/器械/编号区分） */
function normExerciseName(name: string | null | undefined) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function summarizeCuePairs(pairs: StudioCuePair[]) {
  let replace = 0
  let add = 0
  let keep = 0
  let result = 0
  for (const p of pairs) {
    const rel = String(p.relation || '')
    const lib = String(p.library_cue || '').trim()
    const draft = String(p.draft_cue || '').trim()
    if (rel === 'replace') {
      replace += 1
      if (draft) result += 1
    } else if (rel === 'add') {
      add += 1
      if (draft) result += 1
    } else {
      keep += 1
      if (lib) result += 1
    }
  }
  return { replace, add, keep, result_total: result }
}

/** 只标示范素材状态；绑定看圆点，不在这里再说「已绑」 */
function mediaTag(ex: StudioExerciseDraft): { label: string; cls: string } | null {
  switch (ex.media_status) {
    case 'clipped':
      return { label: '示范已切', cls: 'ok' }
    case 'library':
      return { label: '库有示范', cls: 'info' }
    case 'pending_sku':
      return { label: '还没建库动作', cls: 'red' }
    case 'uncut':
      return ex.exercise_id ? { label: '未切示范', cls: 'mute' } : { label: '还没建库动作', cls: 'red' }
    default:
      if (!ex.exercise_id) return { label: '还没建库动作', cls: 'red' }
      // 已绑但没切过：不必再挂「已绑」字，留给圆点
      return null
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

function taskSourceLabel(t: StudioTask) {
  const path = (t.stored_path || t.source_url || t.source_text || '').split(/[\\/]/).pop() || ''
  const clean = path.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > 22 ? `${clean.slice(0, 22)}…` : clean
}

function taskTitle(t: StudioTask) {
  const d = (t.draft_json || {}) as StudioDraft
  if (d.plan_title) return d.plan_title
  const text = (t.source_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (text) return text.length > 16 ? `${text.slice(0, 16)}…` : text
  const path = taskSourceLabel(t)
  if (path) return path
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
  const zoomWaveRef = useRef<HTMLDivElement>(null)
  const waveWrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    mode: 'start' | 'end' | 'new' | 'move'
    anchor: number
    moved: boolean
    surface: 'overview' | 'zoom'
    /** move 模式：按下时选区起点 */
    moveStart0?: number
    moveEnd0?: number
  } | null>(null)
  const playUntilRef = useRef<number | null>(null)
  const playRangeRef = useRef<{ start: number; end: number } | null>(null)
  const selLoopRef = useRef(false)
  const ignorePauseRef = useRef(false)
  const taskRef = useRef<StudioTask | null>(null)
  const draftRef = useRef<StudioDraft>({ plan_title: '', blocks: [] })
  /** 本次切片成功后钉住该行封面/示范，防止轮询旧缓存或库内旧图盖住 */
  const clipPinsRef = useRef<Record<string, { demo?: string; cover?: string }>>({})

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

  // Cookie / 环境（只读展示 + 就地读浏览器）
  const [deps, setDeps] = useState<{
    yt_dlp: boolean
    ffmpeg: boolean
    faster_whisper: boolean
    whisper_model?: string | null
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
  /** 微调轴窗口（相对总长放大）；拖微调时不随选区抖动重算 */
  const [zoomView, setZoomView] = useState<{ start: number; end: number } | null>(null)
  const [duration, setDuration] = useState(0)
  const [curTime, setCurTime] = useState(0)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  /** 示范产出：缩略图用 cover，预览用 demo；与 clipPinsRef 同步的钉住行 */
  const [clipMeta, setClipMeta] = useState<Record<string, { demo?: string; cover?: string }>>({})
  const [clipPins, setClipPins] = useState<Record<string, { demo?: string; cover?: string }>>({})
  const [demoPickOpen, setDemoPickOpen] = useState(false)
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
  const [cuePairDegraded, setCuePairDegraded] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false)

  // 抽屉内：已绑则收起；点「不对，重选」再展开相关列表
  const [bindFilter, setBindFilter] = useState('')
  const [bindHits, setBindHits] = useState<ExerciseListItem[]>([])
  const [bindPickerOpen, setBindPickerOpen] = useState(false)

  useEffect(() => {
    taskRef.current = task
  }, [task])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    clipPinsRef.current = clipPins
  }, [clipPins])

  /** 视频已能播但 React duration 被清成 0 时（同 src 不重挂载、loadedmetadata 不再触发）把总长捞回来 */
  function syncDurationFromVideo(el: HTMLVideoElement | null | undefined) {
    const d = el?.duration
    if (d && Number.isFinite(d) && d > 0) {
      setDuration((prev) => (Math.abs(prev - d) > 0.05 ? d : prev))
    }
  }

  /* ── 数据加载 ── */

  const reloadList = useCallback(async () => {
    const res = await fetchStudioTasks(80)
    setTasks(res.items)
    return res.items
  }, [])

  const selectTask = useCallback(async (id: number) => {
    const detail = await fetchStudioTask(id)
    const nextDraft = asDraft(detail.draft_json)
    setActiveId(id)
    setTask(detail)
    setDraft(nextDraft)
    setActiveBlockIdx(-1)
    setSel(null)
    setZoomView(null)
    setDuration(0)
    setCurTime(0)
    setActiveRowId(null)
    setPreviewUrl(null)
    clipPinsRef.current = {}
    setClipPins({})
    setClipMeta(clipMetaFromDraft(nextDraft))
    setGifItems([])
    setBindFilter('')
    setBindHits([])
    setBindPickerOpen(false)
  }, [])

  /** 轮询刷新：只在状态变化 / 仍在处理中时覆盖草稿，避免吞掉人工编辑 */
  const refreshActive = useCallback(async (id: number) => {
    const detail = await fetchStudioTask(id)
    const prev = taskRef.current
    setTask(detail)
    if (!prev || prev.id !== id || prev.status !== detail.status || prev.status !== 'done') {
      const nextDraft = asDraft(detail.draft_json)
      setDraft(nextDraft)
      setClipMeta((prevMeta) =>
        mergeClipMeta(clipMetaFromDraft(nextDraft), prevMeta, clipPinsRef.current),
      )
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

  // 抽屉绑定时拉相关库动作
  useEffect(() => {
    if (!cueDrawerRowId) {
      setBindHits([])
      return
    }
    const q = bindFilter.trim()
    if (!q) {
      setBindHits([])
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      fetchExercises({ q, page: 1, page_size: 12 })
        .then((res) => {
          if (alive) setBindHits(res.items)
        })
        .catch(() => {
          if (alive) setBindHits([])
        })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [bindFilter, cueDrawerRowId])

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

  // 切任务 / 存草稿后若 duration 被清掉，视频同 src 不会再派 loadedmetadata，这里兜底同步
  useEffect(() => {
    if (!playSrc) {
      setDuration(0)
      return
    }
    const el = videoRef.current
    syncDurationFromVideo(el)
    if (!el) return
    const onMeta = () => syncDurationFromVideo(el)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    return () => {
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSrc, activeId, workbench])
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
      const pin = clipPins[r.ex.id]
      const meta = clipMeta[r.ex.id]
      const draftCover = mediaSrc(r.ex.demo_cover_url || null) || undefined
      // 本次钉住 > 缓存 > 草稿行；有钉住/草稿 demo_url 视为本次片段
      const cover = pin?.cover || meta?.cover || draftCover
      const fromSession = Boolean(pin?.cover || pin?.demo || r.ex.demo_url)
      items.push({
        id: `demo-${r.ex.id}`,
        kind: 'demo',
        label: r.ex.spoken_name || r.ex.exercise_name || `示范 ${r.n}`,
        start,
        end,
        // 必须用封面图；demo 是 mp4，塞进 <img> 会裂图
        url: cover,
        fromSession,
      })
    }
    return items
  }, [draft.cover_url, rows, clipMeta, clipPins])

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
    toast.ok(`已从清单移除「${label}」。点「存草稿」固化；SKU 若还在库里，可到动作库页下架。`)
  }

  function seekTo(sec: number) {
    const el = videoRef.current
    if (el) el.currentTime = Math.max(0, sec)
    setCurTime(Math.max(0, sec))
  }

  function stopSelLoop() {
    selLoopRef.current = false
    playUntilRef.current = null
    playRangeRef.current = null
  }

  function lockZoomAround(range: { start: number; end: number }) {
    setZoomView(computeZoomView(range, duration > 0 ? duration : range.end + 30))
  }

  /** 点清单：视频 + 波形选区一起定位，并滚到波形 */
  function focusWaveAt(range: { start: number; end: number }) {
    const start = Math.max(0, range.start)
    const end = Math.max(start + 0.3, range.end)
    const next = { start, end }
    setSel(next)
    lockZoomAround(next)
    seekTo(start)
    requestAnimationFrame(() => {
      waveWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function nudgeSel(edge: 'start' | 'end' | 'both', delta: number) {
    setSel((prev) => {
      if (!prev || duration <= 0) return prev
      if (edge === 'both') {
        const len = prev.end - prev.start
        let start = prev.start + delta
        let end = prev.end + delta
        if (start < 0) {
          end = len
          start = 0
        }
        if (end > duration) {
          end = duration
          start = Math.max(0, end - len)
        }
        if (end - start < 0.3) return prev
        const next = { start, end }
        lockZoomAround(next)
        seekTo(start)
        return next
      }
      if (edge === 'start') {
        const start = Math.max(0, Math.min(prev.end - 0.3, prev.start + delta))
        return { start, end: prev.end }
      }
      const end = Math.min(duration, Math.max(prev.start + 0.3, prev.end + delta))
      return { start: prev.start, end }
    })
  }

  function defaultSelAround(at: number): { start: number; end: number } {
    const dur = duration > 0 ? duration : at + 8
    const start = Math.max(0, at - 0.5)
    const end = Math.min(dur, start + Math.max(DEMO_MIN_SEC, 4))
    return { start, end: Math.max(start + DEMO_MIN_SEC, end) }
  }

  /** 点清单 / 锚点：只定位视频+波形，不弹详情 */
  function focusRow(ex: StudioExerciseDraft) {
    setActiveRowId(ex.id)
    stopSelLoop()
    videoRef.current?.pause()
    const at = anchorOf(ex)
    if (ex.snippet?.start != null && ex.snippet?.end != null) {
      focusWaveAt({ start: Number(ex.snippet.start), end: Number(ex.snippet.end) })
    } else if (at !== undefined) {
      focusWaveAt(defaultSelAround(Math.max(0, at)))
    } else {
      waveWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  function openRowDetail(ex: StudioExerciseDraft) {
    setActiveRowId(ex.id)
    void openCueDrawer(ex)
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
    if (
      !window.confirm(
        '用当前语音模型重新转字幕并拆动作？本地视频保留，旧字幕/动作清单会被清掉重跑。',
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await retranscribeStudioTask(activeId)
      setSkipSubtitle((prev) => ({ ...prev, [activeId]: false }))
      await reloadActive(activeId)
      toast.ok('已开始重跑字幕')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '重跑字幕失败')
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteTask(taskId: number, title: string) {
    if (
      !window.confirm(
        `删除任务「${title}」#${taskId}？本地视频会一并删掉；已发布的计划/动作库不会回滚。`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await deleteStudioTask(taskId)
      if (activeId === taskId) {
        setActiveId(null)
        setTask(null)
        setDraft({ plan_title: '', blocks: [] })
      }
      await reloadList()
      toast.ok('任务已删除')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  async function onSkipTranscribe() {
    if (activeId == null) return
    if (!window.confirm('跳过自动字幕，直接进工作台手填动作？视频还在，之后仍可点「重跑字幕」。')) return
    setBusy(true)
    try {
      const next = await skipStudioTranscribe(activeId)
      const nextDraft = asDraft(next.draft_json)
      setTask(next)
      setDraft(nextDraft)
      clipPinsRef.current = {}
      setClipPins({})
      setClipMeta(clipMetaFromDraft(nextDraft))
      setSkipSubtitle((prev) => ({ ...prev, [activeId]: true }))
      await reloadList()
      toast.ok('已跳过字幕，可在右栏手填动作')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '跳过失败')
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
            ? `AI 已重新拆出 ${next.exercise_count ?? next.score?.total ?? 0} 个动作`
            : `启发式兜底 · ${next.exercise_count ?? next.score?.total ?? 0} 个动作（检查 LLM 配置）`,
        )
      })
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '重新拆动作失败')
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
      // 已发布时服务端会用 PlanTemplate 标题盖回，避免补示范后仍显示发布前短名
      const serverDraft = asDraft(saved.draft_json)
      if (serverDraft.plan_title && serverDraft.plan_title !== (next.plan_title || '')) {
        setDraft({ ...next, plan_title: serverDraft.plan_title })
      }
      void reloadList().catch(() => undefined)
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

  /* ── 操作：选区 → 示范片段 ── */
  function selDurationSec(range: { start: number; end: number } | null = sel) {
    if (!range) return 0
    return range.end - range.start
  }

  function assertDemoDuration(range: { start: number; end: number } | null = sel): boolean {
    const dur = selDurationSec(range)
    if (dur < DEMO_MIN_SEC) {
      toast.err(`示范太短：至少 ${DEMO_MIN_SEC} 秒（现在 ${(dur).toFixed(1)}s）`)
      return false
    }
    if (dur > DEMO_MAX_SEC) {
      toast.err(`示范太长：最多 ${DEMO_MAX_SEC} 秒，请缩短选区（现在 ${(dur).toFixed(1)}s）`)
      return false
    }
    return true
  }

  function openDemoPick() {
    if (!sel) {
      toast.err('先在波形上拖一段选区')
      return
    }
    if (!assertDemoDuration(sel)) return
    if (!rows.length) {
      toast.err('还没有动作清单')
      return
    }
    setDemoPickOpen(true)
  }

  async function attachDemoToRow(r: Row) {
    if (!sel || !assertDemoDuration(sel)) return
    setDemoPickOpen(false)
    setActiveRowId(r.ex.id)
    await onAttachDemoNow({
      ...r.ex,
      snippet: { ...r.ex.snippet, start: sel.start, end: sel.end },
      attach_demo: true,
    })
  }

  async function onSetPlanCover() {
    if (activeId == null || !sel) {
      toast.err('先在波形上拖一段选区')
      return
    }
    setBusy(true)
    try {
      const res = await previewStudioClip(activeId, sel.start, sel.end)
      setDraft((prev) => ({ ...prev, cover_url: res.cover_url }))
      setPlanInfoOpen(true)
      toast.ok('已设为计划封面，记得存草稿')
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '设置计划封面失败（需 ffmpeg）')
    } finally {
      setBusy(false)
    }
  }

  function playSelection(range?: { start: number; end: number } | null, opts?: { loop?: boolean }) {
    const el = videoRef.current
    const target = range ?? sel
    if (!el || !target) return
    const next = { start: target.start, end: target.end }
    playRangeRef.current = next
    playUntilRef.current = next.end
    selLoopRef.current = opts?.loop !== false
    ignorePauseRef.current = true
    el.currentTime = next.start
    setCurTime(next.start)
    void el.play()
      .catch(() => undefined)
      .finally(() => {
        window.setTimeout(() => {
          ignorePauseRef.current = false
        }, 80)
      })
  }

  /* ── 波形拖拽（总览 + 微调轴） ── */

  function posToSecOverview(clientX: number) {
    const el = waveRef.current
    if (!el || !duration) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function posToSecZoom(clientX: number) {
    const el = zoomWaveRef.current
    const zv = zoomView
    if (!el || !zv || zv.end <= zv.start) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return zv.start + ratio * (zv.end - zv.start)
  }

  function relocateSelTo(t: number, len: number) {
    const L = Math.max(0.3, len)
    let start = Math.max(0, Math.min(duration - L, t))
    let end = start + L
    if (end > duration) {
      end = duration
      start = Math.max(0, end - L)
    }
    const next = { start, end }
    setSel(next)
    lockZoomAround(next)
    seekTo(start)
    playSelection(next)
    return next
  }

  /** 清空总览选区，再拖即为全新自由选区（不残留旧长度/位置） */
  function resetSelection() {
    stopSelLoop()
    videoRef.current?.pause()
    setSel(null)
    setZoomView(null)
  }

  function onWaveDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!duration || !waveRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    stopSelLoop()
    videoRef.current?.pause()
    const t = posToSecOverview(e.clientX)
    const width = waveRef.current.getBoundingClientRect().width
    // 总览短选区：仅按在绿条附近才整段挪（收窄命中，减少误触）；两端精修交给微调轴
    if (sel) {
      const selPx = ((sel.end - sel.start) / duration) * width
      const mid = (sel.start + sel.end) / 2
      const nearBlob =
        (Math.abs(t - mid) / duration) * width < Math.max(10, selPx / 2 + 4)
      if (selPx < 56 && nearBlob) {
        dragRef.current = {
          mode: 'move',
          anchor: t,
          moved: false,
          surface: 'overview',
          moveStart0: sel.start,
          moveEnd0: sel.end,
        }
        return
      }
      const hitPx = 16
      const near = (sec: number) => (Math.abs(t - sec) / duration) * width < hitPx
      if (selPx >= 56 && near(sel.start) && Math.abs(t - sel.start) <= Math.abs(t - sel.end)) {
        dragRef.current = { mode: 'start', anchor: t, moved: false, surface: 'overview' }
        return
      }
      if (selPx >= 56 && near(sel.end)) {
        dragRef.current = { mode: 'end', anchor: t, moved: false, surface: 'overview' }
        return
      }
    }
    dragRef.current = { mode: 'new', anchor: t, moved: false, surface: 'overview' }
  }

  function onZoomDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!duration || !zoomView || !sel) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.stopPropagation()
    stopSelLoop()
    videoRef.current?.pause()
    const t = posToSecZoom(e.clientX)
    const width = e.currentTarget.getBoundingClientRect().width
    const span = Math.max(0.001, zoomView.end - zoomView.start)
    const px = (sec: number) => ((sec - zoomView.start) / span) * width
    const distStart = Math.abs(px(sel.start) - (e.clientX - e.currentTarget.getBoundingClientRect().left))
    const distEnd = Math.abs(px(sel.end) - (e.clientX - e.currentTarget.getBoundingClientRect().left))
    const hit = 28
    // 短选区：左半改起点、右半改终点；中间拖 = 整段平移（字幕偏早就往后拖）
    const inside = t >= sel.start && t <= sel.end
    const mid = (sel.start + sel.end) / 2
    if (distStart <= hit && distStart <= distEnd) {
      dragRef.current = { mode: 'start', anchor: t, moved: false, surface: 'zoom' }
    } else if (distEnd <= hit) {
      dragRef.current = { mode: 'end', anchor: t, moved: false, surface: 'zoom' }
    } else if (inside) {
      dragRef.current = {
        mode: 'move',
        anchor: t,
        moved: false,
        surface: 'zoom',
        moveStart0: sel.start,
        moveEnd0: sel.end,
      }
    } else if (t < mid) {
      dragRef.current = { mode: 'start', anchor: t, moved: false, surface: 'zoom' }
    } else {
      dragRef.current = { mode: 'end', anchor: t, moved: false, surface: 'zoom' }
    }
  }

  function onWaveMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || !duration || d.surface !== 'overview') return
    const t = posToSecOverview(e.clientX)
    if (Math.abs(t - d.anchor) / duration > 0.003) d.moved = true
    if (!d.moved) return
    if (d.mode === 'move' && d.moveStart0 != null && d.moveEnd0 != null) {
      const len = d.moveEnd0 - d.moveStart0
      let start = d.moveStart0 + (t - d.anchor)
      let end = start + len
      if (start < 0) {
        start = 0
        end = len
      }
      if (end > duration) {
        end = duration
        start = Math.max(0, end - len)
      }
      setSel({ start, end })
      seekTo(start)
      return
    }
    seekTo(t)
    if (d.mode === 'new') {
      setSel({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) })
    } else if (d.mode === 'start') {
      setSel((prev) => (prev ? { start: Math.min(t, prev.end - 0.3), end: prev.end } : prev))
    } else if (d.mode === 'end') {
      setSel((prev) => (prev ? { start: prev.start, end: Math.max(t, prev.start + 0.3) } : prev))
    }
  }

  function onZoomMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || !duration || d.surface !== 'zoom' || !zoomView) return
    const t = posToSecZoom(e.clientX)
    const span = Math.max(0.001, zoomView.end - zoomView.start)
    if (Math.abs(t - d.anchor) / span > 0.002) d.moved = true
    if (!d.moved) return
    if (d.mode === 'move' && d.moveStart0 != null && d.moveEnd0 != null) {
      const len = d.moveEnd0 - d.moveStart0
      let start = d.moveStart0 + (t - d.anchor)
      let end = start + len
      if (start < 0) {
        start = 0
        end = len
      }
      if (end > duration) {
        end = duration
        start = Math.max(0, end - len)
      }
      setSel({ start, end })
      seekTo(start)
      return
    }
    seekTo(t)
    if (d.mode === 'new') {
      setSel({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) })
    } else if (d.mode === 'start') {
      setSel((prev) => (prev ? { start: Math.min(t, prev.end - 0.3), end: prev.end } : prev))
    } else if (d.mode === 'end') {
      setSel((prev) => (prev ? { start: prev.start, end: Math.max(t, prev.start + 0.3) } : prev))
    }
  }

  function finishWaveDrag(e: ReactPointerEvent<HTMLDivElement>, surface: 'overview' | 'zoom') {
    const d = dragRef.current
    if (!d || d.surface !== surface) return
    dragRef.current = null
    const readSec = surface === 'zoom' ? posToSecZoom : posToSecOverview
    const t = readSec(e.clientX)
    if (!d.moved) {
      // 总览单击空白：整段跳到这里（长度不变）——偏了整窗时靠这个，不靠下面 ±0.5s
      if (surface === 'overview' && sel) {
        const pad = 0.15
        if (t < sel.start - pad || t > sel.end + pad) {
          relocateSelTo(t, sel.end - sel.start)
          return
        }
      }
      seekTo(t)
      return
    }
    if (d.mode === 'new') {
      setSel((prev) => {
        if (!prev || prev.end - prev.start < 0.5) {
          setZoomView(null)
          return null
        }
        lockZoomAround(prev)
        playSelection(prev)
        return prev
      })
      return
    }
    setSel((prev) => {
      if (prev) {
        lockZoomAround(prev)
        playSelection(prev)
      }
      return prev
    })
  }

  function onWaveUp(e: ReactPointerEvent<HTMLDivElement>) {
    finishWaveDrag(e, 'overview')
  }

  function onZoomUp(e: ReactPointerEvent<HTMLDivElement>) {
    finishWaveDrag(e, 'zoom')
  }

  /* ── 操作：动作库 ── */

  async function onQuickCreate(ex: StudioExerciseDraft) {
    if (activeId == null) return null
    const name = (ex.spoken_name || ex.exercise_name || '').trim() || '新动作'
    const key = normExerciseName(name)
    setBusy(true)
    try {
      // 新建前查重：同名 / 别名命中则提示直接绑定，避免再造一条
      try {
        const found = await fetchExercises({ q: name, page: 1, page_size: 20 })
        const hit = found.items.find((item) => {
          if (normExerciseName(item.name_zh) === key) return true
          return (item.aliases || []).some((a) => normExerciseName(a) === key)
        })
        if (hit) {
          const bind = window.confirm(`库里已有「${hit.name_zh}」#${hit.id}，直接绑定？`)
          if (bind) {
            adoptCandidate(ex, hit)
            setBindPickerOpen(false)
            return {
              exercise_id: hit.id,
              exercise_name: hit.name_zh,
              traffic: 'green' as const,
            }
          }
          return null
        }
      } catch {
        // 查重失败不拦新建
      }
      const clipped = ex.media_status === 'clipped'
      const res = await quickCreateStudioExercise({
        task_id: activeId,
        spoken_name: name,
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
      toast.ok(`已新建 · ${res.exercise.name_zh}`)
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
      toast.err(`请先拖出 ${DEMO_MIN_SEC}～${DEMO_MAX_SEC} 秒选区`)
      return
    }
    if (!assertDemoDuration(range)) return
    setBusy(true)
    try {
      const res = await attachStudioDemo({
        task_id: activeId,
        exercise_id: exerciseId,
        start: range.start,
        end: range.end,
        row_id: ex.id,
      })
      const demoUrl = mediaSrc(res.demo?.demo_url || null) || undefined
      const coverUrl = mediaSrc(res.demo?.cover_url || null) || undefined
      if (!demoUrl && !coverUrl) {
        throw new Error('切片成功但没返回文件地址，请检查 ffmpeg / 存储')
      }
      const pin = { demo: demoUrl, cover: coverUrl }
      const patch: Partial<StudioExerciseDraft> = {
        exercise_id: exerciseId,
        attach_demo: true,
        replace_demo: true,
        media_status: 'clipped',
        demo_url: res.demo?.demo_url || null,
        demo_cover_url: res.demo?.cover_url || null,
        snippet: { ...ex.snippet, start: range.start, end: range.end },
      }
      // 用最新草稿快照，避免闭包旧 draft 把别的编辑盖掉
      const patched = mapRows(draftRef.current, ex.id, patch)
      setDraft(patched)
      clipPinsRef.current = { ...clipPinsRef.current, [ex.id]: pin }
      setClipPins((p) => ({ ...p, [ex.id]: pin }))
      setClipMeta((p) => ({ ...p, [ex.id]: pin }))
      // 预览加时间戳防浏览器沿用旧博主同路径缓存（虽已换 token，双保险）
      if (demoUrl) setPreviewUrl(`${demoUrl}${demoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`)
      // 后端已按 row_id 写回；再 quiet 存一次，防前端草稿与列表不同步
      await onSaveDraft(patched, true)
      toast.ok(`「${ex.spoken_name || ex.exercise_name || '该动作'}」示范已生成`)
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : '写入示范失败')
    } finally {
      setBusy(false)
    }
  }

  function adoptCandidate(ex: StudioExerciseDraft, hit: StudioMatchCandidate | ExerciseListItem) {
    const score = 'score' in hit && hit.score != null ? Number(hit.score) : 100
    const hitId = String(hit.id)
    const next: StudioExerciseDraft = {
      ...ex,
      exercise_id: hitId,
      exercise_name: hit.name_zh,
      gear: hit.gear || ex.gear,
      target_muscle: hit.muscle || ex.target_muscle,
      match_score: score,
      match_confidence: score / 100,
      traffic: 'green',
      media_status: ex.media_status === 'clipped' ? 'clipped' : 'library',
    }
    const nextDraft = mapRows(draft, ex.id, {
      exercise_id: next.exercise_id,
      exercise_name: next.exercise_name,
      gear: next.gear,
      target_muscle: next.target_muscle,
      match_score: next.match_score,
      match_confidence: next.match_confidence,
      traffic: 'green',
      media_status: next.media_status,
    })
    setDraft(nextDraft)
    setBindPickerOpen(false)
    toast.ok(`已对应：${hit.name_zh}`)
    // 立刻落盘，避免写要领时服务端仍显示未绑定
    if (activeId != null) {
      void saveStudioDraft(activeId, nextDraft)
        .then((saved) => setTask(saved))
        .catch((err: unknown) => {
          toast.err(err instanceof Error ? err.message : '绑定未保存到服务器')
        })
    }
    // 抽屉已开时，绑完立刻拉要领对比
    if (cueDrawerRowId === ex.id) void openCueDrawer(next)
  }

  function draftCuePreviewPairs(ex: StudioExerciseDraft): StudioCuePair[] {
    const out: StudioCuePair[] = []
    for (const item of ex.cues || []) {
      const text = (typeof item === 'string' ? item : item?.text || '').trim()
      if (!text) continue
      out.push({
        library_cue: null,
        draft_cue: text,
        relation: 'add',
        reason: '视频抽出（未绑库）',
        kind: 'cue',
      })
    }
    for (const item of ex.mistakes || []) {
      const text = (typeof item === 'string' ? item : item?.text || '').trim()
      if (!text) continue
      out.push({
        library_cue: null,
        draft_cue: text,
        relation: 'add',
        reason: '视频抽出（未绑库）',
        kind: 'mistake',
      })
    }
    return out
  }

  function applyAllVideoReplace() {
    setCuePairs((prev) =>
      prev.map((p) => {
        const draft = String(p.draft_cue || '').trim()
        const lib = String(p.library_cue || '').trim()
        if (draft && lib) return { ...p, relation: 'replace' as const, pending: false }
        if (draft) return { ...p, relation: 'add' as const, pending: false }
        return p
      }),
    )
  }

  function setCuePairRelation(index: number, relation: string) {
    setCuePairs((prev) =>
      prev.map((p, i) => (i === index ? { ...p, relation, pending: false } : p)),
    )
  }

  async function openCueDrawer(ex: StudioExerciseDraft) {
    setCueDrawerRowId(ex.id)
    setActiveRowId(ex.id)
    setBindFilter(ex.spoken_name || ex.exercise_name || '')
    setBindPickerOpen(!ex.exercise_id)
    // 未绑定：先展示视频抽出的内容；绑上后再配对 / AI 补
    if (!ex.exercise_id || activeId == null) {
      const preview = draftCuePreviewPairs(ex)
      setCuePairs(preview)
      setCuePairDegraded(false)
      return
    }
    setBusy(true)
    try {
      const res = await pairStudioCues({
        task_id: activeId,
        row_id: ex.id,
        exercise_id: ex.exercise_id,
      })
      const pairs = res.pairs || []
      setCuePairs(pairs)
      setCuePairDegraded(Boolean(res.degraded))
      if (res.degraded) toast.err('自动配对超时，请人工点选每条「处理」')
      else if ((res as { engine?: string }).engine === 'ai_suggest') {
        toast.ok('视频未讲要领，已按动作名 AI 补了几条，可改后再写进库')
      } else if (!pairs.length) {
        toast.err('没有可写的要领：视频未讲，AI 也未补出——可重开抽屉再试')
      }
    } catch (err: unknown) {
      setCuePairs([])
      setCuePairDegraded(true)
      toast.err(err instanceof Error ? err.message : '配对失败，可人工填写')
    } finally {
      setBusy(false)
    }
  }

  function closeCueDrawer() {
    setCueDrawerRowId(null)
    setCuePairs([])
    setCuePairDegraded(false)
    setBindPickerOpen(false)
  }

  async function onConfirm(publish: boolean) {
    if (activeId == null) return
    if (!isExerciseOnly && !draft.cover_url?.trim()) {
      setPlanInfoOpen(true)
      if (
        !window.confirm(
          '还没设计划封面。可在选区点「设为计划封面」，或在计划信息里上传。仍要继续吗？',
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
        await reloadList().catch(() => undefined)
        if (activeId != null) await selectTask(activeId).catch(() => undefined)
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
        if (taskPublished(task)) {
          // 全部打勾：当前步停在「发布」且标完成态
          cur = 4
          suffix = '已发布'
        } else if (missingSub) {
          cur = 2
          kind = 'warn'
        } else if (rows.length > 0 && pendingAll === 0) cur = 4
        else {
          cur = 3
          suffix = `${rows.length} 个动作`
        }
      } else cur = 1
    }
    const publishedDone = Boolean(task && status === 'done' && taskPublished(task))
    return (
      <ol className="stepper" aria-label="流水线进度">
        {STEP_LABELS.map((label, i) => {
          const state =
            cur < 0
              ? 'todo'
              : i < cur
                ? 'done'
                : i === cur
                  ? publishedDone
                    ? 'done'
                    : kind
                  : 'todo'
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
            const title = taskTitle(t)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={`qcard${t.id === activeId ? ' on' : ''}${bad ? ' bad' : ''}`}
                  onClick={() => void selectTask(t.id)}
                >
                  <span className="qcard-title">
                    <strong>{title}</strong>
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
                            : taskPublished(t)
                              ? typeof t.result_ref?.plan_id === 'string'
                                ? `计划 ${t.result_ref.plan_id}`
                                : '示范已写入库'
                              : t.status === 'done' && (t.transcript_json?.segments || []).length
                                ? `${t.exercise_count ?? t.score?.total ?? 0} 个动作`
                                : t.status === 'done'
                                  ? '装 whisper 后重跑'
                                  : ''}
                        {!running && !bad && taskSourceLabel(t)
                          ? ` · ${taskSourceLabel(t)}`
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
      live.detail,
      live.size && !live.detail?.includes('句') ? `约 ${live.size}` : '',
      live.speed,
      live.eta && `剩余约 ${live.eta}`,
      !live.detail ? stage : '',
    ].filter(Boolean)
    const hint =
      t.status === 'transcribing'
        ? '正在转字幕…'
        : t.status === 'parsing'
          ? '正在拆动作…'
          : t.status === 'queued'
            ? '排队中…'
            : t.status === 'downloading'
              ? '正在下载视频…'
              : ''
    const canRetrySub =
      (t.status === 'transcribing' || t.status === 'parsing' || t.status === 'queued') && taskHasLocalVideo(t)
    return (
      <div className="card prog" aria-live="polite">
        <div className="card-title">
          <span className="icon-sq accent">↓</span>
          <strong>
            <span className="num">#{t.id}</span> {t.status === 'downloading' ? '正在下载' : statusLabel(t.status)}
            {stage ? ` · ${stage}` : ''}
          </strong>
        </div>
        {hint ? <p className="muted">{hint}</p> : null}
        <div className="prog-row">
          <div className="bar">
            <i style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
          </div>
          <span className="num prog-pct">{pct}%</span>
        </div>
        <p className="prog-meta num">{meta.length ? meta.join(' · ') : '正在连接并拉取视频…'}</p>
        {canRetrySub ? (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void onRetranscribe()}>
              重新转字幕
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void onSkipTranscribe()}>
              跳过，手填动作
            </button>
          </div>
        ) : null}
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
          {subtitleFail ? '视频还在，点「重跑字幕」再试。' : '换直链或上传本地文件后继续。'}
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
    const zv =
      sel && duration
        ? zoomView && zoomView.end > zoomView.start
          ? zoomView
          : computeZoomView(sel, duration)
        : null
    const zSpan = zv ? zv.end - zv.start : 0
    const zSelLeft = sel && zv && zSpan > 0 ? ((sel.start - zv.start) / zSpan) * 100 : 0
    const zSelWidth = sel && zv && zSpan > 0 ? ((sel.end - sel.start) / zSpan) * 100 : 0
    const zHeadLeft = zv && zSpan > 0 ? ((curTime - zv.start) / zSpan) * 100 : 0
    // 总览只有约 120 根柱，切 90s 只剩几根，拉满后像一整条绿块。微调单独画密一点。
    const zoomBars = zv
      ? fauxBars((task?.id || 1) + Math.round(zv.start), 96)
      : []
    return (
      <div className="wave-wrap" ref={waveWrapRef}>
        <div className="wave-head">
          <span>
            {missingSub
              ? '视频能看，但还没有字幕，暂时无法按句定位'
              : '总览：单击空白=整段跳 · 拖绿条=挪 · 拖空白=重画'}
          </span>
          <span className="wave-head-actions">
            <button
              type="button"
              className="btn sm"
              disabled={!sel}
              onClick={resetSelection}
              title="清空选区，再在总览上拖一段新的"
            >
              重置选区
            </button>
            <span className="num">{duration ? `${fmtMmss(duration)} 总长` : '加载中…'}</span>
          </span>
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
            <div className="sel" style={{ left: `${selLeft}%`, width: `${Math.max(selWidth, 0.35)}%` }}>
              <b className="handle l" />
              <b className="handle r" />
            </div>
          ) : null}
          {duration ? <i className="playhead" style={{ left: `${headLeft}%` }} /> : null}
          {missingSub ? <div className="wave-note">有波形但无字幕段</div> : null}
        </div>

        {sel && zv && duration ? (
          <div className="wave-zoom">
            <div className="wave-zoom-head">
              <span>
                微调 · 选区 {(sel.end - sel.start).toFixed(1)}s
                <em>
                  （窗口 {fmtPrecise(zv.start)}–{fmtPrecise(zv.end)} · 拖「起」改开头、「止」改结尾；整段挪位置用上面总览）
                </em>
              </span>
              <button type="button" className="link" onClick={() => lockZoomAround(sel)}>
                对齐选区
              </button>
            </div>
            <div
              ref={zoomWaveRef}
              className="wave zoom"
              onPointerDown={onZoomDown}
              onPointerMove={onZoomMove}
              onPointerUp={onZoomUp}
              onPointerCancel={onZoomUp}
            >
              <div className="bars" aria-hidden="true">
                {zoomBars.map((h, i) => (
                  <i key={i} style={{ transform: `scaleY(${h})` }} />
                ))}
              </div>
              {zSelLeft > 0.4 ? (
                <div className="zoom-shade" style={{ left: 0, width: `${zSelLeft}%` }} />
              ) : null}
              <div
                className="sel"
                style={{ left: `${zSelLeft}%`, width: `${Math.max(zSelWidth, 2)}%` }}
              >
                <b className="handle l">起</b>
                <b className="handle r">止</b>
              </div>
              {zSelLeft + Math.max(zSelWidth, 2) < 99.6 ? (
                <div
                  className="zoom-shade"
                  style={{ left: `${zSelLeft + Math.max(zSelWidth, 2)}%`, right: 0 }}
                />
              ) : null}
              {curTime >= zv.start && curTime <= zv.end ? (
                <i className="playhead" style={{ left: `${Math.max(0, Math.min(100, zHeadLeft))}%` }} />
              ) : null}
            </div>
            <div className="wave-nudge">
              <span className="muted">整段大跳</span>
              <button type="button" className="btn sm" onClick={() => nudgeSel('both', -5)}>
                ← 5s
              </button>
              <button type="button" className="btn sm accent-outline" onClick={() => nudgeSel('both', 5)}>
                5s →
              </button>
              <button type="button" className="btn sm" onClick={() => nudgeSel('both', -0.5)}>
                ← 0.5
              </button>
              <button type="button" className="btn sm" onClick={() => nudgeSel('both', 0.5)}>
                0.5 →
              </button>
              <span className="muted nudge-gap">起点</span>
              <button type="button" className="btn sm" onClick={() => nudgeSel('start', -0.5)}>
                −0.5
              </button>
              <button type="button" className="btn sm" onClick={() => nudgeSel('start', 0.5)}>
                +0.5
              </button>
              <span className="muted nudge-gap">终点</span>
              <button type="button" className="btn sm" onClick={() => nudgeSel('end', -0.5)}>
                −0.5
              </button>
              <button type="button" className="btn sm" onClick={() => nudgeSel('end', 0.5)}>
                +0.5
              </button>
            </div>
          </div>
        ) : null}

        <div className="track">
          <div className="track-label">
            <span className="dot green" />
            {draft.parse_engine === 'llm' ? '动作锚点 · DeepSeek 抽取' : '动作锚点'}
            <em>
              {draft.parse_engine === 'heuristic'
                ? '（当前是启发式，不是 LLM；可点「重新拆动作」）'
                : '（≈ 正式讲/做该动作附近，不是片头报菜名）'}
            </em>
          </div>
          {anchors.length ? (
            <div className="chips">
              {anchors.map(({ r, at }) => (
                <button
                  key={r.ex.id}
                  type="button"
                  className={`chip ${trafficOf(r.ex)}${r.ex.id === activeRowId ? ' on' : ''}`}
                  onClick={() => focusRow(r.ex)}
                >
                  <span className="num">{fmtAnchor(at)}</span> {r.ex.spoken_name || r.ex.exercise_name || '未命名'}
                  <span className="num"> {setsText(r.ex)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="track-empty">还没有动作锚点。有字幕后点「重新拆动作」。 </p>
          )}
        </div>

        <div className="selbar">
          <div className="selbar-info num">
            {sel ? (
              <>
                选区 {fmtPrecise(sel.start)} → {fmtPrecise(sel.end)}
                <span className={`pill${selDurationSec(sel) > DEMO_MAX_SEC || selDurationSec(sel) < DEMO_MIN_SEC ? ' warn' : ''}`}>
                  {(sel.end - sel.start).toFixed(1)}s
                </span>
              </>
            ) : (
              <span className="muted">在波形上拖一段</span>
            )}
          </div>
          <div className="selbar-actions">
            <button
              type="button"
              className="btn sm sel-secondary"
              disabled={!sel}
              onClick={() => playSelection(sel, { loop: true })}
              title="循环播放当前选区"
            >
              循环播放
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!sel}
              onClick={() => {
                stopSelLoop()
                videoRef.current?.pause()
              }}
            >
              暂停
            </button>
            <button
              type="button"
              className="btn sm sel-primary"
              disabled={!sel || busy}
              onClick={() => openDemoPick()}
            >
              做成示范视频
            </button>
            {!isExerciseOnly ? (
            <button
              type="button"
              className="btn sm sel-secondary"
              disabled={!sel || busy}
              onClick={() => void onSetPlanCover()}
            >
              设为计划封面
            </button>
            ) : null}
          </div>
        </div>
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
                      focusWaveAt({ start: item.start, end: item.end })
                    }
                  }}
                  title={item.label}
                >
                  {item.url ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <span className="produced-ico">{item.kind === 'cover' ? '封面' : '示范'}</span>
                  )}
                  <em>
                    {item.kind === 'cover'
                      ? '计划封面'
                      : `${item.fromSession ? '本次 · ' : '库内 · '}${item.label}${
                          item.start != null && item.end != null
                            ? ` · ${(item.end - item.start).toFixed(0)}s`
                            : ''
                        }`}
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
        <button type="button" className="drawer-head transcript-toggle" onClick={() => setShowTranscript((v) => !v)}>
          <span className="transcript-title">
            字幕原文
            {segments.length ? <span className="num"> · {segments.length} 段</span> : null}
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
                换视频链接
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => fallbackRef.current?.click()}>
                换成本地视频
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
              <span className="num">
                {duration ? `${fmtMmss(duration)} · ` : ''}
                {task.source_type === 'upload' || !task.source_url ? '本地视频' : '已下载'}
              </span>
            </span>
          </div>
          <div className="video-box">
            <video
              key={playSrc || 'none'}
              ref={videoRef}
              src={playSrc || undefined}
              controls
              playsInline
              onLoadedMetadata={(e) => syncDurationFromVideo(e.currentTarget)}
              onDurationChange={(e) => syncDurationFromVideo(e.currentTarget)}
              onPause={() => {
                if (ignorePauseRef.current) return
                // 用户点暂停 = 结束循环
                if (selLoopRef.current) stopSelLoop()
              }}
              onTimeUpdate={(e) => {
                const el = e.currentTarget
                // 总长丢了时靠播放进度捞回，避免波形一直「加载中…」点不动
                if (!duration) syncDurationFromVideo(el)
                const t = el.currentTime
                setCurTime(t)
                const until = playUntilRef.current
                const range = playRangeRef.current
                if (until == null || t < until - 0.02) return
                if (selLoopRef.current && range) {
                  ignorePauseRef.current = true
                  el.currentTime = range.start
                  setCurTime(range.start)
                  window.setTimeout(() => {
                    ignorePauseRef.current = false
                  }, 80)
                  return
                }
                el.pause()
                stopSelLoop()
              }}
            />
          </div>
        </div>
        {renderWave()}
        {renderTranscript()}
      </>
    )
  }

  function renderBindBlock(ex: StudioExerciseDraft, variant: 'card' | 'drawer' = 'card') {
    const cands = (ex.candidates || []).slice(0, 3)
    const options: {
      id: string
      name_zh: string
      muscle?: string | null
      gear?: string | null
      score?: number
    }[] = []
    const seen = new Set<string>()
    const pushOpt = (o: {
      id: string | number
      name_zh: string
      muscle?: string | null
      gear?: string | null
      score?: number
    }) => {
      const id = String(o.id || '').trim()
      if (!id || seen.has(id)) return
      options.push({
        id,
        name_zh: o.name_zh,
        muscle: o.muscle,
        gear: o.gear,
        score: o.score,
      })
      seen.add(id)
    }
    // 搜库结果 + 自动候选 + 当前绑定；同 id 只留一条。同名不同 id 并列，靠部位/器械/编号区分
    for (const h of bindHits) pushOpt({ id: h.id, name_zh: h.name_zh, muscle: h.muscle, gear: h.gear })
    for (const c of cands) pushOpt(c)
    if (ex.exercise_id) {
      pushOpt({
        id: ex.exercise_id,
        name_zh: ex.exercise_name || String(ex.exercise_id),
        muscle: ex.target_muscle,
        gear: ex.gear,
      })
    }
    const boundId = ex.exercise_id ? String(ex.exercise_id) : ''
    const bound = Boolean(boundId)
    // 抽屉未绑时始终展开列表；卡片 / 已绑收起后点重选再展开
    const showPicker = variant === 'drawer' ? !bound || bindPickerOpen : !bound || bindPickerOpen

    if (!showPicker) {
      return (
        <div className="action-card-block bind-sku">
          <div className="bind-sku-current">
            <strong>{ex.exercise_name || boundId}</strong>
            <span className="muted num"> {boundId}</span>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setBindFilter(ex.spoken_name || ex.exercise_name || '')
                setBindPickerOpen(true)
              }}
            >
              重选
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="action-card-block bind-sku">
        <div className="action-card-k">
          库动作
          {bound ? (
            <button type="button" className="link bind-sku-cancel" onClick={() => setBindPickerOpen(false)}>
              收起
            </button>
          ) : null}
        </div>
        {variant === 'card' ? (
          <input
            className="bind-sku-filter"
            value={bindFilter}
            onChange={(e) => setBindFilter(e.target.value)}
            placeholder="筛库"
            autoFocus={bound}
          />
        ) : null}
        <ul className="bind-sku-list">
          {!options.length ? <li className="muted pad">无匹配</li> : null}
          {options.map((c) => {
            const on = c.id === boundId
            const meta = [c.muscle, c.gear].filter(Boolean).join(' · ')
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`bind-sku-item${on ? ' on' : ''}`}
                  onClick={() => {
                    if (on) {
                      setBindPickerOpen(false)
                      return
                    }
                    const hit =
                      bindHits.find((h) => String(h.id) === c.id) ||
                      cands.find((h) => String(h.id) === c.id) ||
                      c
                    adoptCandidate(ex, hit as StudioMatchCandidate | ExerciseListItem)
                  }}
                >
                  <span className="bind-sku-name">
                    {c.name_zh}
                    {on ? <em> · 当前</em> : null}
                  </span>
                  <span className="bind-sku-meta muted">
                    {meta || '—'}
                    <span className="num"> · {c.id}</span>
                  </span>
                </button>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              className="bind-sku-item create"
              disabled={busy}
              onClick={() => {
                void onQuickCreate(ex).then((patch) => {
                  if (patch) setBindPickerOpen(false)
                })
              }}
            >
              新建
            </button>
          </li>
        </ul>
      </div>
    )
  }

  function renderListRow(r: Row) {
    const t = trafficOf(r.ex)
    const tag = mediaTag(r.ex)
    const at = anchorOf(r.ex)
    const on = r.ex.id === activeRowId
    return (
      <li key={r.ex.id} className={`arow${on ? ' on' : ''}`}>
        <button type="button" className="arow-btn" onClick={() => focusRow(r.ex)} title="定位到视频与波形">
          <span className="arow-n num">{r.n}</span>
          <span className={`dot ${t}`} title={trafficText(t)} />
          <span className="arow-body">
            <span className="arow-name" title={r.ex.spoken_name || r.ex.exercise_name || '未命名'}>
              {r.ex.spoken_name || r.ex.exercise_name || '未命名'}
            </span>
          </span>
          <span className="arow-sets num">{setsText(r.ex)}</span>
          {at !== undefined ? <span className="arow-at num">{fmtAnchor(at)}</span> : null}
          {tag ? (
            <span className={`tag ${tag.cls}`} title={tag.label}>
              {tag.label}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="arow-open"
          title="绑定 / 要领详情"
          onClick={(e) => {
            e.stopPropagation()
            openRowDetail(r.ex)
          }}
        >
          详情
        </button>
        <button
          type="button"
          className="arow-del"
          title="从清单删除"
          aria-label={`删除 ${r.ex.spoken_name || r.ex.exercise_name || '本行'}`}
          onClick={(e) => {
            e.stopPropagation()
            removeExerciseRow(r.ex.id)
            if (cueDrawerRowId === r.ex.id) closeCueDrawer()
            if (activeRowId === r.ex.id) setActiveRowId(null)
          }}
        >
          ×
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
            {draft.plan_title || '未命名计划'} · {draft.scene_tag || '热门计划'}
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
              分类
              <select value={draft.scene_tag || ''} onChange={(e) => setDraft({ ...draft, scene_tag: e.target.value })}>
                <option value="热门计划">热门计划</option>
                <option value="女性专项">女性专项</option>
                <option value="新手入门">新手入门</option>
                <option value="进阶强化">进阶强化</option>
                <option value="居家训练">居家训练</option>
                <option value="增肌专项">增肌专项</option>
                <option value="减脂塑形">减脂塑形</option>
                <option value="博主同款">博主同款</option>
              </select>
            </label>
            <div className="field">
              计划背景图（H5 计划详情顶图）
              <p className="field-hint muted">选区点「设为计划封面」，或直接上传本地图。</p>
              <div className="cover-row">
                <input
                  value={draft.cover_url || ''}
                  onChange={(e) => setDraft({ ...draft, cover_url: e.target.value })}
                  placeholder="https://… 或上传 / 选区「设为计划封面」"
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
    const published = Boolean(task && taskPublished(task))
    const planId = typeof task?.result_ref?.plan_id === 'string' ? String(task.result_ref.plan_id) : ''
    const primaryLabel = published
      ? planId
        ? '查看计划'
        : '已写入'
      : isExerciseOnly
        ? '写入动作库'
        : '发布'
    const statusText = published
      ? planId
        ? '已发布，可打开计划页继续改'
        : '示范已写入动作库'
      : empty
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
          <button
            type="button"
            className="btn primary"
            disabled={busy || empty || (published && !planId)}
            onClick={() => {
              if (published && planId) {
                navigate(`/plans/${encodeURIComponent(planId)}`)
                return
              }
              void onConfirm(true)
            }}
          >
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
    const hasLocalVideo = taskHasLocalVideo(task)
    const retranscribeBtn = hasLocalVideo ? (
      <button
        type="button"
        className="btn sm"
        disabled={busy}
        title="本地视频保留，清空旧字幕后用当前语音模型重转"
        onClick={() => void onRetranscribe()}
      >
        重跑字幕
      </button>
    ) : null
    const reparseBtn = hasTranscript ? (
      <button
        type="button"
        className="btn sm reparse-btn"
        disabled={busy}
        title="不重转字幕：按现有口播，用 AI 重新识别动作清单"
        onClick={() => void onReparse()}
      >
        重新拆动作
      </button>
    ) : null
    const toolBtns = (
      <span className="btn-row" style={{ gap: 6 }}>
        {retranscribeBtn}
        {reparseBtn}
      </span>
    )

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
                {toolBtns}
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
              {toolBtns}
            </div>
            <p className="muted">仅存动作素材：绑 SKU → 中栏「设为动作示范片段」→ 写入动作库（不建计划）</p>
            <ul className="alist">{visibleRows.map((r) => renderListRow(r))}</ul>
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
            <strong>
              动作清单 · <span className="num">{visibleRows.length}</span>
            </strong>
            <span className="muted">
              待处理 {pendingAll}
              {clippedCount ? ` · 示范已切 ${clippedCount}` : ''}
            </span>
            {toolBtns}
          </div>
          <ul className="alist">{visibleRows.map((r) => renderListRow(r))}</ul>
          <div className="legend">
            <span><i className="dot green" /> 绿 · 已对应库动作</span>
            <span><i className="dot amber" /> 黄 · 还没选定</span>
            <span><i className="dot red" /> 红 · 库里没有</span>
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
            详情
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
    const bound = Boolean(ex.exercise_id)

    return (
      <div className="cue-drawer-root" role="dialog" aria-label="动作详情">
        <button type="button" className="cue-drawer-mask" aria-label="关闭" onClick={closeCueDrawer} />
        <aside className="cue-drawer">
          <header className="cue-drawer-head">
            <div className="cue-drawer-titles">
              <input
                className="cue-spoken-input"
                value={ex.spoken_name || ''}
                placeholder="动作名"
                aria-label="动作名"
                onChange={(e) => {
                  const name = e.target.value
                  // 只改本次叫法；同步筛词供下方库动作列表，不自动展开、不改库名
                  patchExercise(ex.id, { spoken_name: name })
                  setBindFilter(name)
                }}
              />
            </div>
            <button type="button" className="link cue-drawer-x" onClick={closeCueDrawer} aria-label="关闭">
              ×
            </button>
          </header>

          <div className="cue-drawer-body">
            <div className="cue-drawer-tools">
              {bound ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={renameBusy || !ex.spoken_name?.trim() || ex.spoken_name.trim() === ex.exercise_name}
                  title="用上面的名字覆盖库正式名，旧名进别名"
                  onClick={() => {
                    const name = ex.spoken_name?.trim()
                    if (!ex.exercise_id || !name) return
                    if (!window.confirm(`确认把库名改为「${name}」？`)) return
                    void (async () => {
                      setRenameBusy(true)
                      try {
                        await updateExercise(ex.exercise_id!, { name_zh: name })
                        patchExercise(ex.id, { exercise_name: name, spoken_name: name })
                        toast.ok(`库名已改 · ${name}`)
                      } catch (err: unknown) {
                        toast.err(err instanceof Error ? err.message : '改名失败')
                      } finally {
                        setRenameBusy(false)
                      }
                    })()
                  }}
                >
                  同步库名
                </button>
              ) : null}
              <button
                type="button"
                className="btn sm danger"
                onClick={() => {
                  removeExerciseRow(ex.id)
                  closeCueDrawer()
                }}
              >
                移除
              </button>
            </div>

            {renderBindBlock(ex, 'drawer')}

            <div className="action-card-k">
              要领对比 {cuePairDegraded ? <span className="tag amber">待判断</span> : null}
              {!bound ? <span className="muted"> · 未绑定</span> : null}
            </div>

            {bound && cuePairs.length ? (
              <div className="cue-pair-toolbar">
                <button type="button" className="btn sm" disabled={busy} onClick={applyAllVideoReplace}>
                  一键替换
                </button>
              </div>
            ) : null}

            {cuePairs.length ? (
              <>
                {(
                  [
                    { key: 'cue', title: '要点', rows: cuePairs
                      .map((p, i) => ({ p, i }))
                      .filter(({ p }) => String(p.kind || 'cue') !== 'mistake') },
                    { key: 'mistake', title: '易错', rows: cuePairs
                      .map((p, i) => ({ p, i }))
                      .filter(({ p }) => String(p.kind || 'cue') === 'mistake') },
                  ] as const
                ).map((section) =>
                  section.rows.length ? (
                    <div key={section.key} className="cue-pair-section">
                      <p className="cue-pair-section-title">{section.title}</p>
                      <table className="cue-pair-table">
                        <thead>
                          <tr>
                            <th>库里现在</th>
                            <th>这次视频</th>
                            <th>处理</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map(({ p, i }) => (
                            <tr key={`${section.key}-${i}`}>
                              <td className={p.relation === 'replace' ? 'strike muted' : ''}>
                                {p.library_cue || <span className="muted">—</span>}
                              </td>
                              <td>{p.draft_cue || <span className="muted">—</span>}</td>
                              <td>
                                <select
                                  value={p.relation}
                                  onChange={(e) => setCuePairRelation(i, e.target.value)}
                                >
                                  <option value="replace">换掉</option>
                                  <option value="keep">保留</option>
                                  <option value="add">新增</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null,
                )}
                {(() => {
                  const sum = summarizeCuePairs(cuePairs)
                  return (
                    <p className="muted tight">
                      换 {sum.replace} · 加 {sum.add} · 留 {sum.keep} → 库里约 {sum.result_total} 条
                    </p>
                  )
                })()}
              </>
            ) : (
              <p className="muted tight">
                {!bound
                  ? '这段视频没抽出要点/易错。先在上面点选库动作，绑上后会按动作名 AI 补几条要点。'
                  : '视频没讲、AI 也没补出。可关抽屉再开一次重试。'}
              </p>
            )}

            {!bound ? (
              <p className="muted tight">还没绑库：上面点一个候选（或新建），绑上后才会配对并允许写库。</p>
            ) : null}

            <button
              type="button"
              className="btn accent-outline"
              disabled={busy || !bound || !cuePairs.length}
              onClick={() => {
                if (activeId == null || !bound) return
                void (async () => {
                  setBusy(true)
                  try {
                    // 逐行 relation 已表达换/留/加；写库固定按 replace 口径落字段
                    const res = await writeStudioCues({
                      task_id: activeId,
                      row_id: ex.id,
                      cue_mode: 'replace',
                      pairs: cuePairs,
                      exercise_id: ex.exercise_id,
                    })
                    if (!res.ok) {
                      toast.err(res.message || res.reason || '未写入')
                      return
                    }
                    patchExercise(ex.id, {
                      cue_mode: 'replace',
                      cues_library_backup:
                        (res.backup as StudioExerciseDraft['cues_library_backup']) ||
                        ex.cues_library_backup,
                    })
                    toast.ok('已保存到动作库')
                  } catch (err: unknown) {
                    toast.err(err instanceof Error ? err.message : '保存失败')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              保存编辑
            </button>
            <p className="muted tight">
              {bound
                ? cuePairs.length
                  ? '不点只留在这次草稿，不会改动作库'
                  : '视频没讲时会按动作名 AI 补要领；仍空可关抽屉再开一次'
                : '先点选库动作；绑上后若视频没讲，会自动 AI 补要点'}
            </p>

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
              <summary>上次被换掉的旧版本，仅供查看</summary>
              {backup ? (
                <div className="cue-history">
                  <p className="muted tight">
                    {(backup as { replaced_at?: string }).replaced_at
                      ? `替换于 ${(backup as { replaced_at?: string }).replaced_at}`
                      : '最近一次覆盖前'}
                  </p>
                  {(backup.cues_zh || []).length ? (
                    <>
                      <p className="cue-pair-section-title">要点</p>
                      <ul>
                        {(backup.cues_zh || []).map((t, i) => (
                          <li key={`c-${i}`}>{t}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {(backup.common_mistakes_zh || []).length ? (
                    <>
                      <p className="cue-pair-section-title">易错</p>
                      <ul>
                        {(backup.common_mistakes_zh || []).map((t, i) => (
                          <li key={`m-${i}`}>{t}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {!(backup.cues_zh || []).length && !(backup.common_mistakes_zh || []).length ? (
                    <p className="muted">留档为空</p>
                  ) : null}
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

  function renderDemoPickModal() {
    if (!sel) return null
    const list = visibleRows.length ? visibleRows : rows
    return (
      <div className="modal-mask" role="dialog" aria-modal="true" aria-label="选择示范挂到哪条动作">
        <div className="modal">
          <div className="modal-head">
            <div>
              <h2>做成示范视频</h2>
              <p className="muted">
                {fmtPrecise(sel.start)} → {fmtPrecise(sel.end)} · {(sel.end - sel.start).toFixed(1)}s
                （限 {DEMO_MIN_SEC}～{DEMO_MAX_SEC} 秒）· 选挂到哪条动作
              </p>
            </div>
            <button type="button" className="link" onClick={() => setDemoPickOpen(false)} aria-label="关闭">
              ✕
            </button>
          </div>
          <ul className="demo-pick-list">
            {list.map((r) => {
              const name = r.ex.spoken_name || r.ex.exercise_name || `动作 ${r.n}`
              const bound = r.ex.exercise_name || (r.ex.exercise_id ? `ID ${r.ex.exercise_id}` : '尚未绑库')
              const preferred = r.ex.id === activeRowId
              return (
                <li key={r.ex.id}>
                  <button
                    type="button"
                    className={`demo-pick-btn${preferred ? ' prefer' : ''}`}
                    disabled={busy}
                    onClick={() => void attachDemoToRow(r)}
                  >
                    <span className="demo-pick-n num">{r.n}</span>
                    <span className="demo-pick-body">
                      <strong>{name}</strong>
                      <em>{bound}</em>
                    </span>
                    <span className="demo-pick-go">{preferred ? '当前选中 · 用这条' : '用这条'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

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
              {deps?.faster_whisper
                ? `✓ whisper · ${deps.whisper_model || 'small'}`
                : '⚠ faster-whisper 未装'}
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
              pip install yt-dlp faster-whisper zhconv
              {'\n'}
              ffmpeg 装好后加入 PATH，并重启 API（uvicorn）
              {'\n'}
              默认 whisper=small；连不上模型站时自动镜像并回退 base
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
    setZoomView(null)
    setDuration(0)
    setCurTime(0)
    setActiveRowId(null)
    setPreviewUrl(null)
    clipPinsRef.current = {}
    setClipPins({})
    setClipMeta({})
    setGifItems([])
    setBindFilter('')
    setBindHits([])
    setBindPickerOpen(false)
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
            <>
              <button type="button" className="btn ghost back-queue" onClick={backToQueue}>
                ← 回任务列表
              </button>
              <button
                type="button"
                className="btn sm danger"
                disabled={busy || (IN_PROGRESS as readonly string[]).includes(task.status)}
                title={
                  (IN_PROGRESS as readonly string[]).includes(task.status)
                    ? '处理中不能删除'
                    : '删除当前任务'
                }
                onClick={() => void onDeleteTask(task.id, taskTitle(task))}
              >
                删除任务
              </button>
            </>
          ) : null}
          <button type="button" className="btn new-task" onClick={() => void openIngest()}>
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
              {task && workbench && status === 'done' ? `${rows.length} 个 · 示范已切 ${clippedCount}` : '—'}
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
      {demoPickOpen ? renderDemoPickModal() : null}
      {renderCueDrawer()}
    </div>
  )
}
