import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createPlanBlock,
  createPlanExercise,
  deletePlanBlock,
  deletePlanExercise,
  fetchAdminPlanDetail,
  fetchExercises,
  mediaSrc,
  updateAdminPlan,
  updatePlanBlock,
  updatePlanExercise,
  uploadPlanCover,
  type AdminPlanBlock,
  type AdminPlanDetail,
  type AdminPlanExercise,
  type ExerciseListItem,
} from '../lib/api'
import { MUSCLES, PLAN_GEAR_TAGS, PLAN_SLOT_ROLES } from '../lib/exerciseUi'
import './PlanDetailPage.css'

type MetaForm = {
  title: string
  subtitle: string
  author: string
  badge_label: string
  template_type: string
  level: string
  days_per_week: number
  minutes_min: string
  minutes_max: string
  muscle_tags: string[]
  split_summary: string
  gear_tags: string[]
  description: string
  is_published: boolean
  sort_order: number
}

function toMeta(plan: AdminPlanDetail): MetaForm {
  return {
    title: plan.title || '',
    subtitle: plan.subtitle || '',
    author: plan.author || '',
    badge_label: plan.badge_label || '',
    template_type: plan.template_type || 'framework',
    level: plan.level || '',
    days_per_week: plan.days_per_week || 3,
    minutes_min: plan.minutes_min != null ? String(plan.minutes_min) : '',
    minutes_max: plan.minutes_max != null ? String(plan.minutes_max) : '',
    muscle_tags: [...(plan.muscle_tags || [])],
    split_summary: plan.split_summary || '',
    gear_tags: [...(plan.gear_tags || [])],
    description: plan.description || '',
    is_published: !!plan.is_published,
    sort_order: plan.sort_order || 0,
  }
}

function toggleTag(list: string[], tag: string) {
  return list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]
}

export function PlanDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const coverRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<AdminPlanDetail | null>(null)
  const [meta, setMeta] = useState<MetaForm | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [pickerQ, setPickerQ] = useState('')
  const [pickerHits, setPickerHits] = useState<ExerciseListItem[]>([])
  const [pickerForExId, setPickerForExId] = useState<number | null>(null)

  async function reload(selectBlockId?: number | null) {
    const detail = await fetchAdminPlanDetail(id)
    setPlan(detail)
    setMeta(toMeta(detail))
    const nextId =
      selectBlockId ??
      activeBlockId ??
      detail.blocks[0]?.id ??
      null
    setActiveBlockId(
      nextId && detail.blocks.some((b) => b.id === nextId)
        ? nextId
        : detail.blocks[0]?.id ?? null,
    )
    return detail
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchAdminPlanDetail(id)
      .then((detail) => {
        if (!alive) return
        setPlan(detail)
        setMeta(toMeta(detail))
        setActiveBlockId(detail.blocks[0]?.id ?? null)
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

  const activeBlock: AdminPlanBlock | null = useMemo(() => {
    if (!plan || activeBlockId == null) return null
    return plan.blocks.find((b) => b.id === activeBlockId) || null
  }, [plan, activeBlockId])

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
    }, 240)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [pickerQ])

  async function saveMeta() {
    if (!meta || !plan) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await updateAdminPlan(plan.id, {
        title: meta.title.trim(),
        subtitle: meta.subtitle.trim() || null,
        author: meta.author.trim() || null,
        badge_label: meta.badge_label.trim() || null,
        template_type: meta.template_type,
        level: meta.level || null,
        days_per_week: meta.days_per_week,
        minutes_min: meta.minutes_min ? Number(meta.minutes_min) : null,
        minutes_max: meta.minutes_max ? Number(meta.minutes_max) : null,
        muscle_tags: meta.muscle_tags,
        split_summary: meta.split_summary.trim() || null,
        gear_tags: meta.gear_tags,
        description: meta.description.trim() || null,
        is_published: meta.is_published,
        sort_order: meta.sort_order,
      })
      await reload(activeBlockId)
      setNotice('主信息已保存')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function onUploadCover(file: File | null) {
    if (!file || !plan) return
    setSaving(true)
    setError('')
    try {
      await uploadPlanCover(plan.id, file)
      await reload(activeBlockId)
      setNotice('封面已更新（横向压缩）')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '封面上传失败')
    } finally {
      setSaving(false)
      if (coverRef.current) coverRef.current.value = ''
    }
  }

  async function addBlock() {
    if (!plan) return
    setSaving(true)
    setError('')
    try {
      const block = await createPlanBlock(plan.id, {
        title: `训练日 ${plan.blocks.length + 1}`,
        muscles: [],
      })
      await reload(block.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新增板块失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveBlock(patch: Partial<AdminPlanBlock>) {
    if (!activeBlock) return
    setSaving(true)
    setError('')
    try {
      await updatePlanBlock(activeBlock.id, {
        title: patch.title ?? activeBlock.title,
        muscles: patch.muscles ?? activeBlock.muscles,
        minutes_min: patch.minutes_min ?? activeBlock.minutes_min,
        minutes_max: patch.minutes_max ?? activeBlock.minutes_max,
        note: patch.note ?? activeBlock.note,
        order_index: patch.order_index ?? activeBlock.order_index,
      })
      await reload(activeBlock.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '板块保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeBlock(block: AdminPlanBlock) {
    if (!window.confirm(`删除板块「${block.title}」？`)) return
    setSaving(true)
    try {
      await deletePlanBlock(block.id)
      await reload(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除板块失败')
    } finally {
      setSaving(false)
    }
  }

  async function moveBlock(block: AdminPlanBlock, dir: -1 | 1) {
    if (!plan) return
    const sorted = [...plan.blocks].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((b) => b.id === block.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setSaving(true)
    try {
      await updatePlanBlock(block.id, { order_index: swap.order_index })
      await updatePlanBlock(swap.id, { order_index: block.order_index })
      await reload(block.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '排序失败')
    } finally {
      setSaving(false)
    }
  }

  async function addExercise() {
    if (!activeBlock || !plan) return
    setSaving(true)
    try {
      const lock = plan.template_type === 'fixed' ? 'fixed' : 'slot'
      await createPlanExercise(activeBlock.id, {
        role: 'main',
        lock_level: lock,
        target_sets: 3,
        target_reps: '8-12',
        warmup_sets: 0,
      })
      await reload(activeBlock.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加动作行失败')
    } finally {
      setSaving(false)
    }
  }

  async function patchExercise(ex: AdminPlanExercise, patch: Record<string, unknown>) {
    setSaving(true)
    setError('')
    try {
      await updatePlanExercise(ex.id, patch)
      await reload(activeBlockId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '动作行保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeExercise(ex: AdminPlanExercise) {
    if (!window.confirm('删除这一行动作？')) return
    setSaving(true)
    try {
      await deletePlanExercise(ex.id)
      await reload(activeBlockId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  async function pickSku(ex: AdminPlanExercise, item: ExerciseListItem) {
    await patchExercise(ex, {
      exercise_id: item.id,
      exercise_name: item.name_zh,
    })
    setPickerForExId(null)
    setPickerQ('')
    setPickerHits([])
  }

  if (loading) return <div className="plan-detail state">加载计划…</div>
  if (error && !plan) {
    return (
      <div className="plan-detail">
        <Link to="/plans">← 返回列表</Link>
        <div className="state error">{error}</div>
      </div>
    )
  }
  if (!plan || !meta) return null

  const cover = mediaSrc(plan.cover_url)

  return (
    <div className="plan-detail">
      <div className="topbar">
        <div>
          <button type="button" className="back" onClick={() => navigate('/plans')}>
            ← 计划列表
          </button>
          <h1>{plan.title}</h1>
          <div className="sub">
            {plan.id} · {plan.template_type === 'fixed' ? '成品' : '框架'} ·{' '}
            {plan.is_published ? '已发布' : '未发布'}
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="primary" disabled={saving} onClick={() => void saveMeta()}>
            {saving ? '保存中…' : '保存主信息'}
          </button>
        </div>
      </div>

      {error ? <div className="state error">{error}</div> : null}
      {notice ? <div className="state ok">{notice}</div> : null}

      <section className="meta-panel">
        <div className="cover-box">
          {cover ? <img src={cover} alt="" /> : <div className="cover-empty">无封面</div>}
          <button type="button" onClick={() => coverRef.current?.click()}>
            上传横向封面
          </button>
          <input
            ref={coverRef}
            type="file"
            hidden
            accept="image/*"
            onChange={(e) => void onUploadCover(e.target.files?.[0] || null)}
          />
        </div>

        <div className="meta-grid">
          <label>
            标题
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </label>
          <label>
            副标题
            <input
              value={meta.subtitle}
              onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })}
            />
          </label>
          <label>
            署名
            <input value={meta.author} onChange={(e) => setMeta({ ...meta, author: e.target.value })} />
          </label>
          <label>
            角标
            <input
              value={meta.badge_label}
              onChange={(e) => setMeta({ ...meta, badge_label: e.target.value })}
            />
          </label>
          <label>
            类型
            <select
              value={meta.template_type}
              onChange={(e) => setMeta({ ...meta, template_type: e.target.value })}
            >
              <option value="framework">框架型</option>
              <option value="fixed">成品型</option>
            </select>
          </label>
          <label>
            难度
            <select value={meta.level} onChange={(e) => setMeta({ ...meta, level: e.target.value })}>
              <option value="">未设</option>
              <option value="beginner">新手</option>
              <option value="intermediate">进阶</option>
              <option value="advanced">强化</option>
            </select>
          </label>
          <label>
            每周天数
            <input
              className="num"
              type="number"
              min={1}
              max={7}
              value={meta.days_per_week}
              onChange={(e) => setMeta({ ...meta, days_per_week: Number(e.target.value) || 3 })}
            />
          </label>
          <label>
            排序
            <input
              className="num"
              type="number"
              value={meta.sort_order}
              onChange={(e) => setMeta({ ...meta, sort_order: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            时长 min
            <input
              className="num"
              value={meta.minutes_min}
              onChange={(e) => setMeta({ ...meta, minutes_min: e.target.value })}
            />
          </label>
          <label>
            时长 max
            <input
              className="num"
              value={meta.minutes_max}
              onChange={(e) => setMeta({ ...meta, minutes_max: e.target.value })}
            />
          </label>
          <label>
            分化短句
            <input
              value={meta.split_summary}
              onChange={(e) => setMeta({ ...meta, split_summary: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={meta.is_published}
              onChange={(e) => setMeta({ ...meta, is_published: e.target.checked })}
            />
            已发布（H5 可见）
          </label>
          <label className="span-all">
            简介
            <textarea
              rows={3}
              value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            />
          </label>
          <div className="span-all">
            <div className="field-label">部位标签</div>
            <div className="chip-row">
              {MUSCLES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={meta.muscle_tags.includes(m) ? 'on' : ''}
                  onClick={() => setMeta({ ...meta, muscle_tags: toggleTag(meta.muscle_tags, m) })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="span-all">
            <div className="field-label">器械标签</div>
            <div className="chip-row">
              {PLAN_GEAR_TAGS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={meta.gear_tags.includes(g) ? 'on' : ''}
                  onClick={() => setMeta({ ...meta, gear_tags: toggleTag(meta.gear_tags, g) })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="editor">
        <aside className="blocks">
          <div className="panel-head">
            <h2>板块</h2>
            <button type="button" onClick={() => void addBlock()} disabled={saving}>
              + 新增
            </button>
          </div>
          <ul>
            {plan.blocks.map((block) => (
              <li key={block.id} className={block.id === activeBlockId ? 'on' : ''}>
                <button type="button" className="block-main" onClick={() => setActiveBlockId(block.id)}>
                  <strong>{block.title}</strong>
                  <span>
                    {(block.muscles || []).join(' · ') || '未设部位'} · {block.exercises.length} 行
                  </span>
                </button>
                <div className="block-ops">
                  <button type="button" onClick={() => void moveBlock(block, -1)}>
                    ↑
                  </button>
                  <button type="button" onClick={() => void moveBlock(block, 1)}>
                    ↓
                  </button>
                  <button type="button" className="danger" onClick={() => void removeBlock(block)}>
                    删
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <div className="exercise-panel">
          {!activeBlock ? (
            <div className="state">先新增或选择一个板块</div>
          ) : (
            <>
              <div className="block-edit">
                <input
                  value={activeBlock.title}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      blocks: plan.blocks.map((b) =>
                        b.id === activeBlock.id ? { ...b, title: e.target.value } : b,
                      ),
                    })
                  }
                  onBlur={(e) => void saveBlock({ title: e.target.value })}
                />
                <input
                  placeholder="备注"
                  value={activeBlock.note || ''}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      blocks: plan.blocks.map((b) =>
                        b.id === activeBlock.id ? { ...b, note: e.target.value } : b,
                      ),
                    })
                  }
                  onBlur={(e) => void saveBlock({ note: e.target.value })}
                />
                <div className="chip-row">
                  {MUSCLES.map((m) => {
                    const on = (activeBlock.muscles || []).includes(m)
                    return (
                      <button
                        key={m}
                        type="button"
                        className={on ? 'on' : ''}
                        onClick={() => {
                          const muscles = toggleTag(activeBlock.muscles || [], m)
                          setPlan({
                            ...plan,
                            blocks: plan.blocks.map((b) =>
                              b.id === activeBlock.id ? { ...b, muscles } : b,
                            ),
                          })
                          void saveBlock({ muscles })
                        }}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="panel-head">
                <h2>动作行</h2>
                <button type="button" onClick={() => void addExercise()} disabled={saving}>
                  + 加一行
                </button>
              </div>

              <div className="ex-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>动作</th>
                      <th>角色</th>
                      <th>锁定</th>
                      <th>组</th>
                      <th>次数</th>
                      <th>热身</th>
                      <th>备选</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBlock.exercises.map((ex) => (
                      <tr key={ex.id}>
                        <td className="ex-cell">
                          <div className="ex-name">
                            {ex.thumb_url ? (
                              <img src={mediaSrc(ex.thumb_url) || ''} alt="" />
                            ) : (
                              <span className="ph" />
                            )}
                            <div>
                              <strong>{ex.exercise_name || '（空槽位）'}</strong>
                              <button
                                type="button"
                                className="link"
                                onClick={() => {
                                  setPickerForExId(ex.id)
                                  setPickerQ(ex.exercise_name || '')
                                }}
                              >
                                选 SKU / 改
                              </button>
                              {pickerForExId === ex.id ? (
                                <div className="picker">
                                  <input
                                    value={pickerQ}
                                    onChange={(e) => setPickerQ(e.target.value)}
                                    placeholder="搜动作名"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    className="link"
                                    onClick={() =>
                                      void patchExercise(ex, {
                                        exercise_id: null,
                                        exercise_name: null,
                                      }).then(() => {
                                        setPickerForExId(null)
                                        setPickerQ('')
                                      })
                                    }
                                  >
                                    清空为槽位
                                  </button>
                                  <ul>
                                    {pickerHits.map((hit) => (
                                      <li key={hit.id}>
                                        <button type="button" onClick={() => void pickSku(ex, hit)}>
                                          {hit.name_zh}
                                          <span>{hit.muscle}</span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            value={ex.role}
                            onChange={(e) => void patchExercise(ex, { role: e.target.value })}
                          >
                            {PLAN_SLOT_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={ex.lock_level}
                            onChange={(e) => void patchExercise(ex, { lock_level: e.target.value })}
                          >
                            <option value="slot">可换</option>
                            <option value="fixed">锁定</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="num tiny"
                            type="number"
                            value={ex.target_sets ?? ''}
                            onChange={(e) =>
                              setPlan({
                                ...plan,
                                blocks: plan.blocks.map((b) =>
                                  b.id !== activeBlock.id
                                    ? b
                                    : {
                                        ...b,
                                        exercises: b.exercises.map((row) =>
                                          row.id === ex.id
                                            ? {
                                                ...row,
                                                target_sets: e.target.value
                                                  ? Number(e.target.value)
                                                  : null,
                                              }
                                            : row,
                                        ),
                                      },
                                ),
                              })
                            }
                            onBlur={(e) =>
                              void patchExercise(ex, {
                                target_sets: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="tiny"
                            value={ex.target_reps || ''}
                            onChange={(e) =>
                              setPlan({
                                ...plan,
                                blocks: plan.blocks.map((b) =>
                                  b.id !== activeBlock.id
                                    ? b
                                    : {
                                        ...b,
                                        exercises: b.exercises.map((row) =>
                                          row.id === ex.id
                                            ? { ...row, target_reps: e.target.value }
                                            : row,
                                        ),
                                      },
                                ),
                              })
                            }
                            onBlur={(e) => void patchExercise(ex, { target_reps: e.target.value || null })}
                          />
                        </td>
                        <td>
                          <input
                            className="num tiny"
                            type="number"
                            min={0}
                            value={ex.warmup_sets}
                            onChange={(e) =>
                              void patchExercise(ex, { warmup_sets: Number(e.target.value) || 0 })
                            }
                          />
                        </td>
                        <td>
                          <input
                            key={`alt-${ex.id}-${(ex.alternatives || []).join('|')}`}
                            className="alts"
                            placeholder="备选，逗号分隔"
                            defaultValue={(ex.alternatives || []).join(', ')}
                            onBlur={(e) =>
                              void patchExercise(ex, {
                                alternatives: e.target.value
                                  .split(/[,，]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </td>
                        <td>
                          <button type="button" className="danger" onClick={() => void removeExercise(ex)}>
                            删
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
