import { clearSession, getToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8000'

export type AdminHealth = {
  ok: boolean
  service: string
  exercises: number
  coach_core: number
  media: number
  media_published: number
  aliases: number
  with_image_start: number
}

export type AdminLoginResult = {
  access_token: string
  token_type: string
  username: string
}

export type RiskInfo = {
  joint: string
  joint_zh: string
  level: string
  label: string
} | null

export type ExerciseListItem = {
  id: string
  name_zh: string
  name_en: string
  fdb_id: string | null
  muscle: string
  sub_region: string | null
  movement_pattern: string | null
  gear: string
  modality: string
  coach_core: boolean
  needs_review: boolean
  is_valid_exercise: boolean
  aliases: string[]
  thumb_url: string | null
  slots: Record<string, boolean>
  media_state: string
  risk: RiskInfo
  enriched: boolean
  is_female_variant?: boolean
  has_female_variant?: boolean
  female_variant?: string | null
  variant_of?: string | null
  updated_at: string | null
}

export type ExerciseListResult = {
  total: number
  page: number
  page_size: number
  items: ExerciseListItem[]
}

export type OverviewStats = {
  totals: {
    exercises: number
    coach_core: number
    with_media_rate: number
    with_image_start: number
    enrich_rate: number
    enriched_core: number
    needs_review: number
    media_exercise_count: number
  }
  coverage: Array<{
    muscle: string
    count: number
    slots: Record<string, number>
  }>
  recent: ExerciseListItem[]
}

export type MediaSlotRef = {
  media_id: number | null
  url: string | null
  status: string
  source: string | null
  meta?: Record<string, unknown>
}

export type ExerciseSlot = {
  role: string
  url: string | null
  status: string
  source: string | null
  media_id: number | null
  published?: MediaSlotRef | null
  draft?: MediaSlotRef | null
  can_rollback?: boolean
  rollback_media_id?: number | null
}

export type ExerciseDetail = {
  id: string
  name_zh: string
  name_en: string
  fdb_id: string | null
  muscle: string
  sub_region: string | null
  movement_pattern: string | null
  gear: string
  modality: string
  roles: string[]
  slot_roles: string[]
  coach_core: boolean
  needs_review: boolean
  is_valid_exercise: boolean
  joint_stress: Record<string, string>
  instructions_zh: string[]
  cues_zh: string[]
  common_mistakes_zh: string[]
  description_zh: string | null
  aliases: string[]
  slots: ExerciseSlot[]
  /** 男版指向女版 id */
  female_variant?: string | null
  female_variant_name?: string | null
  /** 女版指向男版 id */
  variant_of?: string | null
  variant_of_name?: string | null
  updated_at: string | null
}

export type ExerciseUpdatePayload = {
  name_zh?: string
  muscle?: string
  sub_region?: string | null
  movement_pattern?: string | null
  gear?: string
  modality?: string
  coach_core?: boolean
  needs_review?: boolean
  /** false = 从 H5 动作库下架（后台仍可见，可再上架） */
  is_valid_exercise?: boolean
  joint_stress?: Record<string, string>
  instructions_zh?: string[]
  cues_zh?: string[]
  common_mistakes_zh?: string[]
  aliases?: string[]
  slot_roles?: string[]
}

export type AiDraftResult = {
  id: string
  aliases: string[]
  instructions_zh: string[]
  cues_zh: string[]
  common_mistakes_zh: string[]
  joint_stress: Record<string, string>
  muscle?: string | null
  sub_region?: string | null
  movement_pattern?: string | null
  gear?: string | null
  modality?: string | null
  needs_review?: boolean
  confidence_note?: string | null
  filled_fields?: string[]
}

export type ExerciseQuery = {
  q?: string
  muscle?: string
  sub_region?: string
  gear?: string
  movement_pattern?: string
  coach_core?: boolean
  media_state?: string
  needs_review?: boolean
  sort?: 'updated_desc' | 'name' | 'core' | string
  page?: number
  page_size?: number
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (!headers.has('Content-Type') && init.body && !isForm) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (res.status === 401) {
    clearSession()
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { detail?: string | Array<{ msg?: string }> }
      if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) detail = data.detail[0].msg
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

export function mediaSrc(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return `${API_BASE}${path}`
  return `${API_BASE}/static/exercises/${path}`
}

export function loginAdmin(username: string, password: string) {
  return request<AdminLoginResult>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function fetchAdminHealth() {
  return request<AdminHealth>('/api/admin/health')
}

export function fetchOverview() {
  return request<OverviewStats>('/api/admin/stats/overview')
}

export function fetchExercises(query: ExerciseQuery = {}) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const qs = params.toString()
  return request<ExerciseListResult>(`/api/admin/exercises${qs ? `?${qs}` : ''}`)
}

export function fetchExerciseDetail(id: string) {
  return request<ExerciseDetail>(`/api/admin/exercises/${encodeURIComponent(id)}`)
}

export function patchReviewFlag(id: string, needs_review: boolean) {
  return request<{ id: string; needs_review: boolean }>(
    `/api/admin/exercises/${encodeURIComponent(id)}/review-flag`,
    {
      method: 'PATCH',
      body: JSON.stringify({ needs_review }),
    },
  )
}

export function deleteExercise(id: string) {
  return request<{ ok: boolean; id: string; name_zh?: string }>(
    `/api/admin/exercises/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export type ExerciseCreatePayload = {
  name_zh: string
  name_en?: string
  id?: string
  muscle?: string
  sub_region?: string | null
  movement_pattern?: string | null
  gear?: string
  modality?: string
  coach_core?: boolean
  needs_review?: boolean
  aliases?: string[]
}

export function createExercise(payload: ExerciseCreatePayload) {
  return request<ExerciseDetail>('/api/admin/exercises', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateExercise(id: string, payload: ExerciseUpdatePayload) {
  return request<ExerciseDetail>(`/api/admin/exercises/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function uploadExerciseMedia(
  id: string,
  role: string,
  file: File,
  publish = false,
) {
  const body = new FormData()
  body.append('role', role)
  body.append('publish', String(publish))
  body.append('file', file)
  return request<ExerciseDetail>(`/api/admin/exercises/${encodeURIComponent(id)}/media`, {
    method: 'POST',
    body,
  })
}

export function publishMedia(mediaId: number) {
  return request<ExerciseDetail>(`/api/admin/media/${mediaId}/publish`, {
    method: 'POST',
  })
}

export function rollbackMedia(mediaId: number) {
  return request<ExerciseDetail>(`/api/admin/media/${mediaId}/rollback`, {
    method: 'POST',
  })
}

export function clearExerciseSlot(id: string, role: string) {
  return request<ExerciseDetail>(
    `/api/admin/exercises/${encodeURIComponent(id)}/media/${encodeURIComponent(role)}`,
    { method: 'DELETE' },
  )
}

export function fetchAiDraft(id: string) {
  return request<AiDraftResult>(`/api/admin/exercises/${encodeURIComponent(id)}/ai-draft`, {
    method: 'POST',
  })
}

export type MediaPoolCandidate = {
  id: string
  name_zh: string
  name_en?: string | null
  fdb_id?: string | null
  muscle?: string | null
  score: number
  reason: string
}

export type MediaPoolItem = {
  id: number
  filename: string
  relative_path: string | null
  url: string | null
  file_type: string
  size_bytes: number
  guessed_role: string | null
  candidates: MediaPoolCandidate[]
  status: string
  bound_exercise_id: string | null
  bound_media_id: number | null
  created_at: string | null
  updated_at: string | null
}

export type MediaPoolListResult = {
  total: number
  page: number
  page_size: number
  items: MediaPoolItem[]
}

export type MediaBatchMatched = {
  filename: string
  relative_path: string
  exercise_id: string
  name_zh: string
  role: string
  reason: string
  media_status: string
  detail_id: string
}

export type MediaBatchResult = {
  matched: MediaBatchMatched[]
  unmatched: MediaPoolItem[]
  errors: Array<{ filename: string; relative_path: string; error: string }>
  summary: {
    total: number
    matched: number
    unmatched: number
    errors: number
  }
}

export function uploadMediaBatch(files: File[], relativePaths: string[], publish = false) {
  const body = new FormData()
  body.append('publish', String(publish))
  files.forEach((file, idx) => {
    body.append('files', file)
    body.append('relative_paths', relativePaths[idx] || file.name)
  })
  return request<MediaBatchResult>('/api/admin/media/batch', {
    method: 'POST',
    body,
  })
}

export function fetchMediaPool(query: { status?: string; page?: number; page_size?: number } = {}) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const qs = params.toString()
  return request<MediaPoolListResult>(`/api/admin/media-pool${qs ? `?${qs}` : ''}`)
}

export function searchMediaPoolBind(q: string, limit = 12) {
  const params = new URLSearchParams({ q, limit: String(limit) })
  return request<{ items: MediaPoolCandidate[] }>(`/api/admin/media-pool/search?${params}`)
}

export function bindMediaPoolItem(
  poolId: number,
  payload: { exercise_id: string; role?: string | null; publish?: boolean },
) {
  return request<{
    pool: MediaPoolItem
    exercise: { id: string; name_zh: string }
    role: string
  }>(`/api/admin/media-pool/${poolId}/bind`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function ignoreMediaPoolItem(poolId: number) {
  return request<MediaPoolItem>(`/api/admin/media-pool/${poolId}/ignore`, {
    method: 'POST',
  })
}

// ---------- 计划模板 ----------

export type AdminPlanListItem = {
  id: string
  title: string
  subtitle?: string | null
  author?: string | null
  badge_label?: string | null
  template_type: 'framework' | 'fixed' | string
  level?: string | null
  days_per_week: number
  minutes_min?: number | null
  minutes_max?: number | null
  minutes_label?: string | null
  muscle_tags: string[]
  split_summary?: string | null
  gear_tags: string[]
  description?: string | null
  cover_url?: string | null
  /** 场景标签：三分化 / 四分化 / 博主同款…（与 H5 列表筛对齐） */
  scene_tag?: string | null
  is_published: boolean
  sort_order: number
  block_count: number
  updated_at?: string | null
}

export type AdminPlanExercise = {
  id: number
  block_id: number
  order_index: number
  exercise_id?: string | null
  exercise_name?: string | null
  role: string
  lock_level: string
  /** 单行目标肌群：胸/背/肩/腿/臂/核心 */
  target_muscle?: string | null
  target_sets?: number | null
  target_reps?: string | null
  warmup_sets: number
  alternatives: string[]
  note?: string | null
  thumb_url?: string | null
  pending?: boolean
}

export type AdminPlanBlock = {
  id: number
  template_id: string
  order_index: number
  title: string
  muscles: string[]
  minutes_min?: number | null
  minutes_max?: number | null
  minutes_label?: string | null
  cover_url?: string | null
  note?: string | null
  exercises: AdminPlanExercise[]
}

export type AdminPlanDetail = AdminPlanListItem & {
  blocks: AdminPlanBlock[]
}

export type AdminPlanListResult = {
  total: number
  page: number
  page_size: number
  items: AdminPlanListItem[]
}

export type AdminPlanQuery = {
  q?: string
  type?: string
  published?: boolean
  page?: number
  page_size?: number
}

export type AdminPlanPayload = {
  id?: string
  title?: string
  subtitle?: string | null
  author?: string | null
  badge_label?: string | null
  template_type?: string
  level?: string | null
  days_per_week?: number
  minutes_min?: number | null
  minutes_max?: number | null
  muscle_tags?: string[]
  split_summary?: string | null
  gear_tags?: string[]
  description?: string | null
  cover_url?: string | null
  scene_tag?: string | null
  is_published?: boolean
  sort_order?: number
}

export type AdminPlanBlockPayload = {
  title?: string
  muscles?: string[]
  minutes_min?: number | null
  minutes_max?: number | null
  cover_url?: string | null
  note?: string | null
  order_index?: number
}

export type AdminPlanExercisePayload = {
  exercise_id?: string | null
  exercise_name?: string | null
  role?: string
  lock_level?: string
  target_muscle?: string | null
  target_sets?: number | null
  target_reps?: string | null
  warmup_sets?: number
  alternatives?: string[]
  note?: string | null
  order_index?: number
}

export function fetchAdminPlans(query: AdminPlanQuery = {}) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const qs = params.toString()
  return request<AdminPlanListResult>(`/api/admin/plans${qs ? `?${qs}` : ''}`)
}

export function fetchAdminPlanDetail(id: string) {
  return request<AdminPlanDetail>(`/api/admin/plans/${encodeURIComponent(id)}`)
}

export function createAdminPlan(payload: AdminPlanPayload) {
  return request<AdminPlanDetail>('/api/admin/plans', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateAdminPlan(id: string, payload: AdminPlanPayload) {
  return request<AdminPlanDetail>(`/api/admin/plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteAdminPlan(id: string) {
  return request<{ ok: boolean; id: string }>(`/api/admin/plans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function uploadPlanCover(id: string, file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<AdminPlanDetail>(`/api/admin/plans/${encodeURIComponent(id)}/cover`, {
    method: 'POST',
    body,
  })
}

export function uploadPlanBlockCover(blockId: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<AdminPlanBlock>(`/api/admin/plan-blocks/${blockId}/cover`, {
    method: 'POST',
    body,
  })
}

export function createPlanBlock(planId: string, payload: AdminPlanBlockPayload) {
  return request<AdminPlanBlock>(`/api/admin/plans/${encodeURIComponent(planId)}/blocks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updatePlanBlock(blockId: number, payload: AdminPlanBlockPayload) {
  return request<AdminPlanBlock>(`/api/admin/plan-blocks/${blockId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deletePlanBlock(blockId: number) {
  return request<{ ok: boolean; id: number }>(`/api/admin/plan-blocks/${blockId}`, {
    method: 'DELETE',
  })
}

export function createPlanExercise(blockId: number, payload: AdminPlanExercisePayload) {
  return request<AdminPlanExercise>(`/api/admin/plan-blocks/${blockId}/exercises`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updatePlanExercise(exId: number, payload: AdminPlanExercisePayload) {
  return request<AdminPlanExercise>(`/api/admin/plan-exercises/${exId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deletePlanExercise(exId: number) {
  return request<{ ok: boolean; id: number }>(`/api/admin/plan-exercises/${exId}`, {
    method: 'DELETE',
  })
}

/* ---------- 内容工坊 Studio ---------- */

export type StudioEvidenceLine = { text: string; source_at?: number }

export type StudioMatchCandidate = {
  id: string
  name_zh: string
  muscle?: string | null
  gear?: string | null
  has_demo?: boolean
  score: number
  reason?: string
  is_female_variant?: boolean
  has_female_variant?: boolean
  female_variant?: string | null
  variant_of?: string | null
  prefer_derive_female?: boolean
}

export type StudioExerciseEvidence = {
  seg_index?: number | null
  text?: string | null
  start?: number | null
  end?: number | null
}

export type StudioExerciseDraft = {
  id: string
  spoken_name: string
  exercise_id?: string | null
  exercise_name?: string | null
  /** 草稿绑的 SKU 已从动作库消失；需重绑 */
  sku_missing?: boolean
  target_muscle?: string | null
  gear?: string | null
  role?: string
  /** teaching / warmup；example·recall·intro 后端已滤 */
  scene?: string | null
  /** 与灯色独立：缺证据 / 启发式兜底 / 选区重叠等 */
  suspect?: boolean
  suspect_reason?: string | null
  /** 支撑原话（句号 + 原文 + 时间） */
  evidence?: StudioExerciseEvidence | null
  target_sets?: number | null
  target_reps?: string | null
  sets_from_transcript?: boolean
  source_kind?: string
  /** 0～100 百分制匹配分；与 match_confidence 同步（confidence = score/100） */
  match_score?: number
  match_confidence?: number
  candidates?: StudioMatchCandidate[]
  snippet?: { start?: number; end?: number; spoken_at?: number }
  spoken_at?: number
  media_status?: 'uncut' | 'clipped' | 'library' | 'pending_sku' | string
  /** 示范 MP4（attach-demo 写回草稿，刷新后预览用） */
  demo_url?: string | null
  /** 示范封面 JPG（「本次产出」缩略图；勿把 mp4 塞进 img） */
  demo_cover_url?: string | null
  cues?: StudioEvidenceLine[]
  mistakes?: StudioEvidenceLine[]
  tempo?: string
  intensity?: string
  traffic?: 'red' | 'amber' | 'green' | string
  replace_demo?: boolean
  attach_demo?: boolean
  /** 发布时是否把示范写入动作库 SKU；默认 false=只跟计划行 */
  write_library?: boolean
  /** none=仅本次；append=发布时追加；replace=发布时替换（可还原） */
  cue_mode?: 'none' | 'append' | 'replace' | string
  cues_library_backup?: {
    cues_zh?: string[]
    common_mistakes_zh?: string[]
    instructions_zh?: string[]
  } | null
}

export type StudioBlockDraft = {
  title: string
  muscles: string[]
  exercises: StudioExerciseDraft[]
}

export type StudioDraft = {
  plan_title?: string
  scene_tag?: string | null
  cover_url?: string | null
  mode?: string
  parse_engine?: 'llm' | 'heuristic' | string
  blocks: StudioBlockDraft[]
}

export type StudioTask = {
  id: number
  batch_id?: string | null
  batch_order: number
  source_type: string
  source_text?: string | null
  source_url?: string | null
  stored_path?: string | null
  play_url?: string | null
  mode: string
  status: string
  progress: number
  pipeline_step?: string
  exercise_count?: number
  clipped_count?: number
  transcript_json: {
    engine?: string
    warning?: string
    text?: string
    segments?: Array<{ start: number; end: number; text: string }>
  }
  draft_json: StudioDraft | Record<string, unknown>
  score: { red_count?: number; amber_count?: number; green_count?: number; total?: number }
  review_state: string
  result_ref: Record<string, unknown>
  error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export function fetchStudioTasks(limit = 50) {
  return request<{ items: StudioTask[]; total: number }>(`/api/admin/studio/tasks?limit=${limit}`)
}

export function fetchStudioTask(id: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${id}`)
}

export function saveStudioCookies(payload: {
  source?: 'paste' | 'browser'
  browser?: string
  bilibili?: string
  douyin?: string
  youtube?: string
}) {
  return request<{ ok: boolean; source?: string; browser?: string }>('/api/admin/studio/cookies', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function fetchStudioCookies() {
  return request<{
    source?: 'paste' | 'browser'
    browser?: string
    bilibili?: string
    douyin?: string
    youtube?: string
    bilibili_set?: boolean
    douyin_set?: boolean
    youtube_set?: boolean
    updated_at?: string | null
  }>('/api/admin/studio/cookies')
}

export function fetchStudioDeps() {
  return request<{
    yt_dlp: boolean
    ffmpeg: boolean
    faster_whisper: boolean
    whisper_model?: string | null
    llm?: boolean
    llm_model?: string | null
    cookie_source?: string
  }>('/api/admin/studio/deps')
}

export async function ingestStudioBatch(opts: {
  text?: string
  mode?: string
  merge_into_one_plan?: boolean
  plan_title?: string
  files?: File[]
  pause_for_confirm?: boolean
  source_kind?: 'share' | 'direct' | 'file' | string
}) {
  const body = new FormData()
  if (opts.text) body.append('text', opts.text)
  body.append('mode', opts.mode || 'plan_single')
  body.append('merge_into_one_plan', String(Boolean(opts.merge_into_one_plan)))
  body.append('pause_for_confirm', String(Boolean(opts.pause_for_confirm)))
  if (opts.source_kind) body.append('source_kind', opts.source_kind)
  if (opts.plan_title) body.append('plan_title', opts.plan_title)
  for (const f of opts.files || []) body.append('files', f)
  return request<{ batch_id: string | null; items: StudioTask[] }>(
    '/api/admin/studio/ingest-batch',
    { method: 'POST', body },
  )
}

export function continueStudioPipeline(taskId: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/continue`, { method: 'POST' })
}

export function retranscribeStudioTask(taskId: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/retranscribe`, {
    method: 'POST',
  })
}

export function deleteStudioTask(taskId: number) {
  return request<{ ok: boolean; id: number }>(`/api/admin/studio/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export function skipStudioTranscribe(taskId: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/skip-transcribe`, {
    method: 'POST',
  })
}

export function reparseStudioTask(taskId: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/reparse`, {
    method: 'POST',
  })
}

export async function uploadStudioFallback(taskId: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/upload-fallback`, {
    method: 'POST',
    body,
  })
}

export function retryStudioDownload(taskId: number) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/retry-download`, {
    method: 'POST',
  })
}

export function replaceStudioSource(taskId: number, text: string) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/replace-source`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function saveStudioDraft(taskId: number, draft: StudioDraft) {
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ draft }),
  })
}

export function uploadStudioTaskCover(taskId: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<StudioTask>(`/api/admin/studio/tasks/${taskId}/cover`, {
    method: 'POST',
    body,
  })
}

export function previewStudioClip(taskId: number, start: number, end: number) {
  return request<{ demo_url: string; cover_url: string; start: number; end: number }>(
    '/api/admin/studio/preview-clip',
    {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, start, end }),
    },
  )
}

export function quickCreateStudioExercise(payload: {
  task_id: number
  spoken_name: string
  muscle: string
  gear?: string
  role?: string
  start?: number | null
  end?: number | null
  attach_demo?: boolean
  cues?: StudioEvidenceLine[]
  mistakes?: StudioEvidenceLine[]
  write_cues?: boolean
}) {
  return request<{ exercise: { id: string; name_zh: string }; demo: unknown }>(
    '/api/admin/studio/quick-create-exercise',
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export function deriveStudioFemaleVariant(payload: {
  task_id: number
  source_exercise_id: string
  row_id?: string | null
  copy_cues?: boolean
}) {
  return request<{
    exercise: ExerciseDetail
    created: boolean
    reason?: string
    draft_patched?: boolean
  }>('/api/admin/studio/derive-female-variant', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deriveFemaleExercise(sourceId: string, copyCues = true) {
  const q = copyCues ? '' : '?copy_cues=false'
  return request<{
    exercise: ExerciseDetail
    created: boolean
    reason?: string
  }>(`/api/admin/exercises/${encodeURIComponent(sourceId)}/derive-female${q}`, {
    method: 'POST',
  })
}

export type StudioCuePair = {
  library_cue?: string | null
  draft_cue?: string | null
  relation: 'replace' | 'add' | 'keep' | string
  reason?: string
  pending?: boolean
  /** cue=发力要点；mistake=常见错误 —— 分列配对，禁止互替 */
  kind?: 'cue' | 'mistake' | string
}

export type StudioCuePairResult = {
  ok: boolean
  row_id: string
  exercise_id?: string | null
  library: string[]
  draft: { text: string; timestamp?: number | null; kind?: string }[]
  pairs: StudioCuePair[]
  summary: { replace: number; add: number; keep?: number; result_total: number }
  degraded?: boolean
  engine?: string
}

export function pairStudioCues(payload: {
  task_id: number
  row_id: string
  exercise_id?: string | null
}) {
  return request<StudioCuePairResult>('/api/admin/studio/pair-cues', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function writeStudioCues(payload: {
  task_id: number
  row_id: string
  cue_mode: 'none' | 'append' | 'replace' | string
  pairs?: StudioCuePair[]
  exercise_id?: string | null
}) {
  return request<{
    ok: boolean
    mode?: string
    exercise_id?: string
    cues?: string[]
    mistakes?: string[]
    backup?: unknown
    message?: string
    reason?: string
  }>('/api/admin/studio/write-cues', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function attachStudioDemo(payload: {
  task_id: number
  exercise_id: string
  start: number
  end: number
  row_id?: string
  /** true=写入动作库 SKU；默认 false 只挂本计划/草稿行 */
  write_to_library?: boolean
}) {
  return request<{
    ok: boolean
    exercise_id: string
    row_id?: string | null
    write_to_library?: boolean
    demo: { demo_url?: string; cover_url?: string }
  }>('/api/admin/studio/attach-demo', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function confirmStudioPlan(payload: {
  task_id: number
  draft?: StudioDraft
  append_to_plan_id?: string | null
  /** 多条合成一套：其它可发布任务 id（不含当前 task_id） */
  merge_task_ids?: number[] | null
  publish?: boolean
}) {
  return request<{
    ok: boolean
    plan_id: string | null
    block_ids: number[]
    attached?: number
    cues_synced?: number
    merged_task_ids?: number[]
  }>('/api/admin/studio/confirm-plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/* ---------- AI Ops ---------- */

export type AiOpsMissItem = {
  norm_query: string
  display_query: string
  count: number
  last_at: string | null
  examples: string[]
  near_miss: Array<{ exercise_id?: string | null; name_zh: string; score?: number | null }>
  trace_ids: number[]
  status: string
  bound_exercise_id?: string | null
  note?: string | null
}

export type AiOpsMissDiagnose = {
  verdict: 'has_match' | 'missing_exercise' | 'non_exercise' | string
  reason: string
  suggested_candidates: Array<{
    exercise_id?: string | null
    name_zh: string
    confidence?: number
  }>
  suggested_alias?: string | null
}

export type AiOpsFeedbackItem = {
  id: number
  created_at: string | null
  rating: string
  tags: string[]
  note: string
  question: string
  answer: string
  conversation_id: string
  trace_id: number | null
  assistant_turn_id: number | null
  export_status: string
  snapshot: Record<string, unknown>
  ai_diagnosis?: {
    root_cause?: string
    fix_hint?: string
    assert_draft?: string
  } | null
}

export function fetchAiOpsMisses(status = 'pending') {
  const params = new URLSearchParams({ status })
  return request<{ items: AiOpsMissItem[]; total: number }>(
    `/api/admin/ai-ops/misses?${params}`,
  )
}

export function diagnoseAiOpsMiss(payload: {
  norm_query: string
  display_query?: string
  examples?: string[]
}) {
  return request<AiOpsMissDiagnose>('/api/admin/ai-ops/misses/diagnose', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function bindAiOpsMissAlias(payload: {
  norm_query: string
  exercise_id: string
  alias?: string
}) {
  return request<{
    ok: boolean
    alias: string
    bound_exercise_id: string
    exercise_name_zh: string
  }>('/api/admin/ai-ops/misses/bind-alias', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function resolveAiOpsMiss(payload: {
  norm_query: string
  status: 'created_sku' | 'ignored'
  bound_exercise_id?: string
  note?: string
}) {
  return request<{ ok: boolean; status: string }>('/api/admin/ai-ops/misses/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchAiOpsFeedbacks(status = 'pending') {
  const params = new URLSearchParams({ status })
  return request<{ items: AiOpsFeedbackItem[]; total: number }>(
    `/api/admin/ai-ops/feedbacks?${params}`,
  )
}

export function diagnoseAiOpsFeedback(id: number) {
  return request<{
    root_cause: string
    fix_hint: string
    assert_draft: string
  }>(`/api/admin/ai-ops/feedbacks/${id}/diagnose`, { method: 'POST' })
}

export function exportAiOpsFeedback(
  id: number,
  payload: { write_file?: boolean; format?: 'auto' | 'single' | 'thread' } = {},
) {
  return request<{
    ok: boolean
    export_status: string
    yaml: string
    path: string | null
  }>(`/api/admin/ai-ops/feedbacks/${id}/export`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function discardAiOpsFeedback(id: number) {
  return request<{ ok: boolean; export_status: string }>(
    `/api/admin/ai-ops/feedbacks/${id}/discard`,
    { method: 'POST' },
  )
}

export type AiOpsPlanGapItem = {
  key: string
  label: string
  scene_tag: string | null
  count: number
  last_at: string | null
  examples: string[]
  studio_path: string
}

export function fetchAiOpsPlanGaps() {
  return request<{ items: AiOpsPlanGapItem[]; total: number }>('/api/admin/ai-ops/plan-gaps')
}

export function addExerciseAlias(exerciseId: string, alias: string) {
  return request<{
    ok: boolean
    skipped?: boolean
    created?: boolean
    alias: string
    bound_exercise_id: string
    exercise_name_zh: string
  }>('/api/admin/ai-ops/aliases', {
    method: 'POST',
    body: JSON.stringify({ exercise_id: exerciseId, alias }),
  })
}

export { API_BASE }
