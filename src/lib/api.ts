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

export { API_BASE }
