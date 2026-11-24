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
  uploadPlanBlockCover,
  uploadPlanCover,
  type AdminPlanBlock,
  type AdminPlanDetail,
  type AdminPlanExercise,
  type ExerciseListItem,
} from '../lib/api'
import { MUSCLES, PLAN_GEAR_TAGS, PLAN_SLOT_ROLES } from '../lib/exerciseUi'
import './PlanDetailPage.css'

/** H5 计划库大分组：人群/场景，不是三分化/五分化 */
const SCENE_TAGS = [
  '热门计划',
  '女性专项',
  '新手入门',
  '进阶强化',
  '居家训练',
  '增肌专项',
  '减脂塑形',
  '博主同款',
] as const

const TARGET_MUSCLES = ['胸', '背', '肩', '腿', '臂', '核心'] as const

type MetaForm = {
  title: string
  subtitle: string
  author: string
  badge_label: string
  template_type: string
  scene_tag: string
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
    scene_tag: plan.scene_tag || '',
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

function looksLikeImageUrl(raw: string) {
  const v = raw.trim()
  return /^https?:\/\//i.test(v)
}

function toggleTag(list: string[], tag: string) {
  return list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]
}

export function PlanDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const coverRef = useRef<HTMLInputElement>(null)
  const blockCoverRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<AdminPlanDetail | null>(null)
  const [meta, setMeta] = useState<MetaForm | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [coverUrlDraft, setCoverUrlDraft] = useState('')
  const [blockCoverUrlDraft, setBlockCoverUrlDraft] = useState('')
  const [pickerQ, setPickerQ] = useState('')
  const [pickerHits, setPickerHits] = useState<ExerciseListItem[]>([])
  const [pickerForExId, setPickerForExId] = useState<number | null>(null)

  async function reload(selectBlockId?: number | null) {
    const detail = await fetchAdminPlanDetail(id)
    setPlan(detail)
    setMeta(toMeta(detail))
    setCoverUrlDraft(detail.cover_url || '')
    const nextId =
      selectBlockId ??
      activeBlockId ??
      detail.blocks[0]?.id ??
      null
    const resolved =
      nextId && detail.blocks.some((b) => b.id === nextId)
        ? nextId
        : detail.blocks[0]?.id ?? null
    setActiveBlockId(resolved)
    const block = detail.blocks.find((b) => b.id === resolved)
    setBlockCoverUrlDraft(block?.cover_url || '')
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
        setCoverUrlDraft(detail.cover_url || '')
        const firstId = detail.blocks[0]?.id ?? null
        setActiveBlockId(firstId)
        setBlockCoverUrlDraft(detail.blocks[0]?.cover_url || '')
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
    setBlockCoverUrlDraft(activeBlock?.cover_url || '')
  }, [activeBlock?.id, activeBlock?.cover_url])

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
        scene_tag: meta.scene_tag.trim() || null,
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

  async function savePlanCoverUrl() {
    if (!plan) return
    const url = coverUrlDraft.trim()
    if (url && !looksLikeImageUrl(url)) {
      setError('封面外链需以 http:// 或 https:// 开头')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateAdminPlan(plan.id, { cover_url: url || null })
      await reload(activeBlockId)
      setNotice(url ? '封面外链已保存' : '已清空封面外链')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存封面外链失败')
    } finally {
      setSaving(false)
    }
  }

  async function onUploadBlockCover(file: File | null) {
    if (!file || !activeBlock) return
    setSaving(true)
    setError('')
    try {
      await uploadPlanBlockCover(activeBlock.id, file)
      await reload(activeBlock.id)
      setNotice('板块背景图已更新')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '板块封面上传失败')
    } finally {
      setSaving(false)
      if (blockCoverRef.current) blockCoverRef.current.value = ''
    }
  }

  async function saveBlockCoverUrl() {
    if (!activeBlock) return
    const url = blockCoverUrlDraft.trim()
    if (url && !looksLikeImageUrl(url)) {
      setError('板块外链需以 http:// 或 https:// 开头')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updatePlanBlock(activeBlock.id, { cover_url: url || null })
      await reload(activeBlock.id)
      setNotice(url ? '板块背景外链已保存' : '已清空板块背景')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存板块外链失败')
    } finally {
      setSaving(false)
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
        cover_url: patch.cover_url !== undefined ? patch.cover_url : activeBlock.cover_url,
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
          <button type="button" onClick={() => coverRef.current?.click()} disabled={saving}>
            上传横向封面
          </button>
          <input
            ref={coverRef}
            type="file"
            hidden
            accept="image/*"
            onChange={(e) => void onUploadCover(e.target.files?.[0] || null)}
          />
          <label className="cover-url">
            或粘贴图片外链
            <div className="cover-url-row">
              <input
                value={coverUrlDraft}
                placeholder="https://cdn.xxx.com/cover.jpg"
                onChange={(e) => setCoverUrlDraft(e.target.value)}
              />
              <button type="button" disabled={saving} onClick={() => void savePlanCoverUrl()}>
                保存外链
              </button>
            </div>
          </label>
        </div>

        <div className="meta-grid">
          <p className="meta-section-title span-all">主信息（H5 列表 / 详情常用）</p>
          <label>
            标题
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </label>
          <label>
            分类
            <select
              value={meta.scene_tag}
              onChange={(e) => setMeta({ ...meta, scene_tag: e.target.value })}
            >
              <option value="">未设</option>
              {SCENE_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
              {meta.scene_tag &&
              !(SCENE_TAGS as readonly string[]).includes(meta.scene_tag) ? (
                <option value={meta.scene_tag}>{meta.scene_tag}（旧值）</option>
              ) : null}
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
          <label className="check">
            <input
              type="checkbox"
              checked={meta.is_published}
              onChange={(e) => setMeta({ ...meta, is_published: e.target.checked })}
            />
            已发布
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
            <div className="field-label">部位</div>
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
            <div className="field-label">器械</div>
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

          <p className="meta-section-title span-all">次要</p>
          <label>
            角标
            <input
              value={meta.badge_label}
              onChange={(e) => setMeta({ ...meta, badge_label: e.target.value })}
              placeholder="可选，卡面小标"
            />
          </label>
          <label>
            分化短句
            <input
              value={meta.split_summary}
              onChange={(e) => setMeta({ ...meta, split_summary: e.target.value })}
              placeholder="如：胸 · 背 · 腿"
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

          <details className="meta-advanced span-all">
            <summary>高级</summary>
            <div className="meta-grid meta-advanced-grid">
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
                排序
                <input
                  className="num"
                  type="number"
                  value={meta.sort_order}
                  onChange={(e) => setMeta({ ...meta, sort_order: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
          </details>
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
                    {block.cover_url ? ' · 有背景图' : ''}
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

                <div className="block-cover">
                  <div className="field-label">板块背景图（H5 板块卡暗角底图）</div>
                  <div className="block-cover-preview">
                    {activeBlock.cover_url ? (
                      <img src={mediaSrc(activeBlock.cover_url) || ''} alt="" />
                    ) : (
                      <div className="cover-empty">无背景图</div>
                    )}
                  </div>
                  <div className="cover-url-row">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => blockCoverRef.current?.click()}
                    >
                      上传板块图
                    </button>
                    <input
                      ref={blockCoverRef}
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={(e) => void onUploadBlockCover(e.target.files?.[0] || null)}
                    />
                    <input
                      value={blockCoverUrlDraft}
                      placeholder="或粘贴 https://… 外链"
                      onChange={(e) => setBlockCoverUrlDraft(e.target.value)}
                    />
                    <button type="button" disabled={saving} onClick={() => void saveBlockCoverUrl()}>
                      保存外链
                    </button>
                    {activeBlock.cover_url ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={saving}
                        onClick={() => {
                          setBlockCoverUrlDraft('')
                          void saveBlock({ cover_url: null }).then(() => setNotice('已清除板块背景'))
                        }}
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
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
                      <th>目标肌</th>
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
                            value={ex.target_muscle || ''}
                            onChange={(e) =>
                              void patchExercise(ex, {
                                target_muscle: e.target.value || null,
                              })
                            }
                          >
                            <option value="">未设</option>
                            {TARGET_MUSCLES.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
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
