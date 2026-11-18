import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ImageCropModal } from '../components/ImageCropModal'
import {
  clearExerciseSlot,
  fetchAiDraft,
  fetchExerciseDetail,
  mediaSrc,
  publishMedia,
  rollbackMedia,
  updateExercise,
  uploadExerciseMedia,
  type ExerciseDetail,
} from '../lib/api'
import {
  GEARS,
  JOINT_KEYS,
  JOINT_LABELS,
  LEVEL_LABELS,
  MODALITIES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  PLAN_SLOT_ROLES,
  ROLE_LABELS,
  SUB_REGIONS,
  parseSubRegions,
  toggleSubRegion,
} from '../lib/exerciseUi'
import { peekExercisesReturn } from '../lib/listReturn'
import './ExerciseDetailPage.css'

type FormState = {
  name_zh: string
  muscle: string
  sub_region: string
  movement_pattern: string
  gear: string
  modality: string
  coach_core: boolean
  needs_review: boolean
  slot_roles: string[]
  instructions: string[]
  cues: string
  mistakes: string
  aliases: string
  joint_stress: Record<string, string>
}

function toForm(data: ExerciseDetail): FormState {
  const joints: Record<string, string> = {}
  for (const key of JOINT_KEYS) joints[key] = data.joint_stress?.[key] || 'low'
  return {
    name_zh: data.name_zh || '',
    muscle: data.muscle || '',
    sub_region: data.sub_region || '',
    movement_pattern: data.movement_pattern || '',
    gear: data.gear || '',
    modality: data.modality || '',
    coach_core: !!data.coach_core,
    needs_review: !!data.needs_review,
    slot_roles: [...(data.slot_roles || [])],
    instructions: [...(data.instructions_zh || []), '', '', '', ''].slice(0, 4),
    cues: (data.cues_zh || []).join('\n'),
    mistakes: (data.common_mistakes_zh || []).join('\n'),
    aliases: (data.aliases || []).join('\n'),
    joint_stress: joints,
  }
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function ExerciseDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<ExerciseDetail | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [activeRole, setActiveRole] = useState('start')
  const [autoFlip, setAutoFlip] = useState(false)
  const [publishOnUpload, setPublishOnUpload] = useState(true)
  const [cropFile, setCropFile] = useState<File | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchExerciseDetail(id)
      .then((res) => {
        if (!alive) return
        setData(res)
        setForm(toForm(res))
        const first = res.slots.find((s) => s.url)?.role || 'start'
        setActiveRole(first)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  const activeSlot = data?.slots.find((s) => s.role === activeRole)
  const startUrl = useMemo(
    () => mediaSrc(data?.slots.find((s) => s.role === 'start')?.url),
    [data],
  )
  const endUrl = useMemo(
    () => mediaSrc(data?.slots.find((s) => s.role === 'end')?.url),
    [data],
  )
  const filled = data?.slots.filter((s) => s.url).length ?? 0
  const previewUrl = mediaSrc(activeSlot?.url)
  const subOptions = form?.muscle ? SUB_REGIONS[form.muscle] || [] : []

  useEffect(() => {
    if (!autoFlip || !startUrl || !endUrl) return
    if (activeRole !== 'start' && activeRole !== 'end') return
    const timer = window.setInterval(() => {
      setActiveRole((prev) => (prev === 'start' ? 'end' : 'start'))
    }, 1200)
    return () => window.clearInterval(timer)
  }, [autoFlip, startUrl, endUrl, activeRole])

  function applyDetail(next: ExerciseDetail, msg?: string) {
    setData(next)
    setForm(toForm(next))
    if (msg) setNotice(msg)
  }

  async function onSave() {
    if (!form || !data) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // 「发布」= 内容入库且视为已人工核对，自动清掉待复核
      const next = await updateExercise(data.id, {
        name_zh: form.name_zh.trim(),
        muscle: form.muscle,
        sub_region: form.sub_region || null,
        movement_pattern: form.movement_pattern || null,
        gear: form.gear,
        modality: form.modality,
        coach_core: form.coach_core,
        needs_review: false,
        slot_roles: form.slot_roles,
        instructions_zh: form.instructions.map((s) => s.trim()).filter(Boolean),
        cues_zh: lines(form.cues),
        common_mistakes_zh: lines(form.mistakes),
        aliases: lines(form.aliases),
        joint_stress: form.joint_stress,
      })
      applyDetail(next, '已发布到动作库，并取消待复核')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function onAiDraft() {
    if (!data || !form) return
    setAiBusy(true)
    setError('')
    try {
      const draft = await fetchAiDraft(data.id)
      const filled: string[] = ['教案', '提示', '错误', '关节风险']
      const next = {
        ...form,
        aliases: draft.aliases.join('\n') || form.aliases,
        instructions: [...draft.instructions_zh, '', '', '', ''].slice(0, 4),
        cues: draft.cues_zh.join('\n'),
        mistakes: draft.common_mistakes_zh.join('\n'),
        joint_stress: { ...form.joint_stress, ...draft.joint_stress },
      }
      // 空字段才用 AI 补分类，避免覆盖人工已选
      if (!form.muscle && draft.muscle) {
        next.muscle = draft.muscle
        filled.push('部位')
      }
      if (!form.sub_region && draft.sub_region) {
        next.sub_region = draft.sub_region
        filled.push('靶区')
      }
      if (!form.movement_pattern && draft.movement_pattern) {
        next.movement_pattern = draft.movement_pattern
        filled.push('动作模式')
      }
      if (!form.gear && draft.gear) {
        next.gear = draft.gear
        filled.push('器械')
      }
      if (!form.modality && draft.modality) {
        next.modality = draft.modality
        filled.push('模态')
      }
      if (draft.needs_review) next.needs_review = true
      setForm(next)
      const note = draft.confidence_note ? ` · ${draft.confidence_note}` : ''
      setNotice(`AI 已补：${filled.join('、')}。请核对后再点「发布修改」${note}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'AI 草稿失败')
    } finally {
      setAiBusy(false)
    }
  }

  function needsCrop(file: File) {
    const type = file.type || ''
    const name = file.name.toLowerCase()
    if (type.includes('gif') || name.endsWith('.gif')) return false
    if (type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return false
    return type.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(name)
  }

  async function uploadPicked(file: File) {
    if (!data) return
    setMediaBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await uploadExerciseMedia(data.id, activeRole, file, publishOnUpload)
      applyDetail(next, publishOnUpload ? '素材已上传并发布' : '素材已上传为草稿')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setMediaBusy(false)
      setCropFile(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onPickFile(file: File | null) {
    if (!file || !data) return
    if (needsCrop(file)) {
      setCropFile(file)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    if (file.type.includes('gif') || file.name.toLowerCase().endsWith('.gif')) {
      setNotice('动图将原样上传（动画裁剪易损坏）。列表缩略图可用；建议静图槽位用裁剪后的 JPG。')
    }
    await uploadPicked(file)
  }

  async function onPublishDraft() {
    const mediaId = activeSlot?.draft?.media_id
    if (!mediaId || !data) return
    setMediaBusy(true)
    setError('')
    try {
      const next = await publishMedia(mediaId)
      applyDetail(next, '草稿已发布')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发布失败')
    } finally {
      setMediaBusy(false)
    }
  }

  async function onRollback() {
    if (!data || !activeSlot) return
    const target =
      activeSlot.draft?.media_id ||
      activeSlot.rollback_media_id ||
      activeSlot.published?.media_id ||
      activeSlot.media_id
    if (!target) {
      setError('没有可回滚的版本')
      return
    }
    setMediaBusy(true)
    setError('')
    try {
      const next = await rollbackMedia(target)
      applyDetail(next, '已回滚素材')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '回滚失败')
    } finally {
      setMediaBusy(false)
    }
  }

  async function onClearSlot() {
    if (!data || !activeSlot?.url) return
    const label = ROLE_LABELS[activeRole] || activeRole
    if (
      !window.confirm(
        activeRole === 'demo'
          ? `删除「动图」？会立刻从 H5 拿掉循环示范，并清掉工坊带出的封面。动作名仍在库里能搜到——要从 H5 消失请另点「从 H5 下架」。`
          : `删除「${label}」素材？立刻生效（可回滚）。这只删图/视频，动作名仍可被 H5 搜到。`,
      )
    )
      return
    setMediaBusy(true)
    setError('')
    try {
      const next = await clearExerciseSlot(data.id, activeRole)
      const extra =
        activeRole === 'demo'
          ? '（同源封面一并清了）。动作名还在库里，H5 仍能搜到——要从列表消失请点「从 H5 下架」。'
          : '。动作本身还在，H5 仍能搜到名字；要从列表消失请点「从 H5 下架」。'
      applyDetail(next, `已删除「${label}」素材${extra}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '清空失败')
    } finally {
      setMediaBusy(false)
    }
  }

  async function onToggleH5Visibility() {
    if (!data || !form) return
    const hide = data.is_valid_exercise !== false
    const msg = hide
      ? '确认从 H5 下架？用户搜不到、详情也打不开。后台仍可再上架。'
      : '确认重新上架到 H5？'
    if (!window.confirm(msg)) return
    setSaving(true)
    setError('')
    try {
      const next = await updateExercise(data.id, { is_valid_exercise: !hide })
      applyDetail(next, hide ? '已从 H5 下架（后台仍可见）' : '已重新上架到 H5')
      if (hide) navigate(peekExercisesReturn())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="ex-detail">
        <div className="state">加载动作详情…</div>
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="ex-detail">
        <div className="state error">{error}</div>
        <button type="button" className="secondary" onClick={() => navigate(peekExercisesReturn())}>
          返回列表
        </button>
      </div>
    )
  }
  if (!data || !form) return null

  const listReturn = peekExercisesReturn()

  return (
    <div className="ex-detail">
      {cropFile ? (
        <ImageCropModal
          file={cropFile}
          title={`裁剪「${ROLE_LABELS[activeRole] || activeRole}」`}
          onCancel={() => setCropFile(null)}
          onConfirm={(file) => {
            void uploadPicked(file)
          }}
        />
      ) : null}
      <div className="nav-row">
        <button type="button" className="back-btn" onClick={() => navigate(listReturn)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M12.5 4.5 7 10l5.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          返回列表
        </button>
        <div className="crumbs">
          <Link className="crumb" to={listReturn}>
            动作 SKU
          </Link>
          <span className="crumb-sep">/</span>
          <span className="crumb current">#{data.id}</span>
        </div>
      </div>

      <div className="head">
        <div>
          <div className="eyebrow">Exercise Editor · #{data.id}</div>
          <h1>{form.name_zh || data.name_zh}</h1>
          <div className="sub">
            {data.name_en}
            {data.fdb_id ? ` · ${data.fdb_id}` : ''}
            {form.coach_core ? ' · 主力' : ''}
            {data.is_valid_exercise === false ? ' · 已从 H5 下架' : ''}
          </div>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="secondary ai-draft"
            disabled={aiBusy}
            onClick={onAiDraft}
            title="补教案、提示、错误，以及空着的部位/靶区/模式等"
          >
            {aiBusy ? '生成中…' : 'AI 补全'}
          </button>
          <button
            type="button"
            className="secondary danger"
            disabled={saving}
            onClick={() => void onToggleH5Visibility()}
            title={data.is_valid_exercise === false ? '重新上架到 H5' : '从 H5 动作库下架（仍留后台）'}
          >
            {data.is_valid_exercise === false ? '重新上架 H5' : '从 H5 下架'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={onSave}
            title="保存右侧名称/教案/提示等到动作库；不会重新切片，也不会恢复已删素材"
          >
            {saving ? '保存中…' : '保存字段'}
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <strong>多模态素材</strong>
            <span className={`status ${filled < 2 ? 'wait' : ''}`}>
              {filled} / 5
              {activeSlot?.status === 'draft' ? ' · 草稿' : ''}
            </span>
          </div>
          <div className="panel-note">
            删素材：点槽位 →「删除此素材」（立刻生效，不必再点保存）。删的是图/视频，不是动作名——H5 还能搜到请用右上角「从 H5 下架」。
          </div>
          <div className="media-preview">
            {previewUrl ? (
              previewUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                <video src={previewUrl} muted loop playsInline autoPlay controls />
              ) : (
                <img src={previewUrl} alt="" />
              )
            ) : (
              '暂无预览'
            )}
          </div>
          <div className="slot-strip">
            {data.slots.map((slot) => (
              <button
                key={slot.role}
                type="button"
                className={`slot-card ${slot.url ? 'on' : ''} ${activeRole === slot.role ? 'active' : ''}`}
                onClick={() => {
                  setActiveRole(slot.role)
                  setAutoFlip(false)
                }}
              >
                <b>{ROLE_LABELS[slot.role] || slot.role}</b>
                <span>{slot.url ? slot.status : '待补充'}</span>
              </button>
            ))}
          </div>
          <div className="media-actions">
            <span className="slot-hint">
              当前槽位：<b>{ROLE_LABELS[activeRole] || activeRole}</b>
              {activeSlot?.url
                ? ' · 再上传会直接替换（旧版可回滚）'
                : ' · 空槽，先点槽位再上传'}
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={publishOnUpload}
                onChange={(e) => setPublishOnUpload(e.target.checked)}
              />
              上传后直接发布
            </label>
            <button
              type="button"
              className="secondary"
              disabled={mediaBusy}
              onClick={() => fileRef.current?.click()}
            >
              {mediaBusy
                ? '处理中…'
                : activeSlot?.url
                  ? `替换「${ROLE_LABELS[activeRole] || activeRole}」`
                  : `上传「${ROLE_LABELS[activeRole] || activeRole}」`}
            </button>
            {activeSlot?.url ? (
              <button type="button" className="secondary danger" disabled={mediaBusy} onClick={onClearSlot}>
                删除此素材
              </button>
            ) : null}
            {activeSlot?.draft?.media_id ? (
              <button type="button" className="secondary" disabled={mediaBusy} onClick={onPublishDraft}>
                发布草稿
              </button>
            ) : null}
            {activeSlot?.can_rollback || activeSlot?.draft ? (
              <button type="button" className="secondary" disabled={mediaBusy} onClick={onRollback}>
                {activeSlot?.draft ? '丢弃草稿' : '回滚上一版'}
              </button>
            ) : null}
            {startUrl && endUrl ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setActiveRole('start')
                  setAutoFlip((v) => !v)
                }}
              >
                {autoFlip ? '暂停切帧' : '起止切帧'}
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={
                activeRole === 'highlight_video'
                  ? 'image/*,video/*,.gif'
                  : 'image/*,.gif'
              }
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
          </div>
        </section>

        <section className="panel">
          <div className="form-section">
            <div className="form-title">结构化分类</div>
            <div className="form-grid">
              <div className="form-control">
                <label>中文名</label>
                <input
                  value={form.name_zh}
                  onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                />
              </div>
              <div className="form-control">
                <label>主力动作</label>
                <select
                  value={form.coach_core ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, coach_core: e.target.value === '1' })}
                >
                  <option value="1">是 · 主力</option>
                  <option value="0">否 · 普通入库</option>
                </select>
              </div>
              <div className="form-control span-2">
                <label>计划槽位角色（slot_roles）</label>
                <div className="chip-row">
                  {PLAN_SLOT_ROLES.map((role) => {
                    const on = form.slot_roles.includes(role.value)
                    return (
                      <button
                        key={role.value}
                        type="button"
                        className={`chip-toggle ${on ? 'on' : ''}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            slot_roles: on
                              ? form.slot_roles.filter((x) => x !== role.value)
                              : [...form.slot_roles, role.value],
                          })
                        }
                      >
                        {role.label}
                      </button>
                    )
                  })}
                </div>
                <span className="field-hint">供框架计划按主项/辅助/孤立/热身检索，不改肌群 roles</span>
              </div>
              <div className="form-control">
                <label>部位</label>
                <select
                  value={form.muscle}
                  onChange={(e) =>
                    setForm({ ...form, muscle: e.target.value, sub_region: '' })
                  }
                >
                  {MUSCLES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control span-2">
                <label>靶区（可多选）</label>
                <div className="chip-row">
                  {subOptions.map((s) => {
                    const on = parseSubRegions(form.sub_region).includes(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        className={`chip-toggle ${on ? 'on' : ''}`}
                        onClick={() =>
                          setForm({ ...form, sub_region: toggleSubRegion(form.sub_region, s) })
                        }
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
                <span className="field-hint">
                  {form.sub_region
                    ? `已选：${form.sub_region}`
                    : '拿不准就选「肩部整体 / ××整体」；中后束可一起勾'}
                </span>
              </div>
              <div className="form-control">
                <label>动作模式</label>
                <select
                  value={form.movement_pattern}
                  onChange={(e) => setForm({ ...form, movement_pattern: e.target.value })}
                >
                  <option value="">未指定</option>
                  {MOVEMENT_PATTERNS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control">
                <label>器械</label>
                <select
                  value={form.gear}
                  onChange={(e) => setForm({ ...form, gear: e.target.value })}
                >
                  {GEARS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control">
                <label>训练模态</label>
                <select
                  value={form.modality}
                  onChange={(e) => setForm({ ...form, modality: e.target.value })}
                >
                  {MODALITIES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control">
                <label>待复核</label>
                <select
                  value={form.needs_review ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, needs_review: e.target.value === '1' })}
                >
                  <option value="0">否</option>
                  <option value="1">是 · 待修</option>
                </select>
                <span className="field-hint">AI 补全会标成待修；点右上角「发布」会自动取消</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-title">关节风险</div>
            <div className="risk-grid edit">
              {JOINT_KEYS.map((joint) => (
                <label key={joint} className={`risk-chip ${form.joint_stress[joint] || ''}`}>
                  <b>{JOINT_LABELS[joint]}</b>
                  <select
                    value={form.joint_stress[joint] || 'low'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        joint_stress: { ...form.joint_stress, [joint]: e.target.value },
                      })
                    }
                  >
                    {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="form-title">4 步教案</div>
            <div className="steps">
              {form.instructions.map((step, idx) => (
                <div className="step" key={idx}>
                  <i className="num">{idx + 1}</i>
                  <input
                    value={step}
                    onChange={(e) => {
                      const next = [...form.instructions]
                      next[idx] = e.target.value
                      setForm({ ...form, instructions: next })
                    }}
                    placeholder={`第 ${idx + 1} 步`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="form-grid">
              <div className="form-control">
                <label>Cues · 发力提示（每行一条）</label>
                <textarea
                  value={form.cues}
                  onChange={(e) => setForm({ ...form, cues: e.target.value })}
                />
              </div>
              <div className="form-control">
                <label>Mistakes · 常见错误（每行一条）</label>
                <textarea
                  value={form.mistakes}
                  onChange={(e) => setForm({ ...form, mistakes: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-title">别名（每行一个；改名后旧名会自动保留）</div>
            <textarea
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              placeholder="平板卧推&#10;杠铃推胸"
            />
          </div>
        </section>
      </div>
    </div>
  )
}
