import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  createAdminPlan,
  deleteAdminPlan,
  fetchAdminPlans,
  updateAdminPlan,
  type AdminPlanListItem,
  type AdminPlanListResult,
} from '../lib/api'
import './PlansPage.css'

const PAGE_SIZE = 30

function typeLabel(t: string) {
  if (t === 'framework') return '框架'
  if (t === 'fixed') return '成品'
  return t
}

export function PlansPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [draftQ, setDraftQ] = useState(params.get('q') || '')
  const [data, setData] = useState<AdminPlanListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<'framework' | 'fixed'>('framework')
  const [newDays, setNewDays] = useState(3)

  const query = useMemo(() => {
    const page = Math.max(1, Number(params.get('page') || 1) || 1)
    const publishedRaw = params.get('published')
    return {
      q: params.get('q') || undefined,
      type: params.get('type') || undefined,
      published:
        publishedRaw === 'true' ? true : publishedRaw === 'false' ? false : undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [params])

  useEffect(() => {
    setDraftQ(params.get('q') || '')
  }, [params])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchAdminPlans(query)
      .then((res) => {
        if (alive) setData(res)
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
  }, [query])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    next.delete('page')
    setParams(next)
  }

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setFilter('q', draftQ.trim())
  }

  async function togglePublish(item: AdminPlanListItem) {
    setBusyId(item.id)
    setError('')
    try {
      await updateAdminPlan(item.id, { is_published: !item.is_published })
      const res = await fetchAdminPlans(query)
      setData(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '上下架失败')
    } finally {
      setBusyId('')
    }
  }

  async function onDelete(item: AdminPlanListItem) {
    if (!window.confirm(`删除计划「${item.title}」？板块与动作行会一并删除。`)) return
    setBusyId(item.id)
    setError('')
    try {
      await deleteAdminPlan(item.id)
      const res = await fetchAdminPlans(query)
      setData(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusyId('')
    }
  }

  async function onCreate() {
    const title = newTitle.trim()
    if (!title) return
    setCreating(true)
    setError('')
    try {
      const plan = await createAdminPlan({
        title,
        template_type: newType,
        days_per_week: newDays,
        is_published: false,
      })
      setNewTitle('')
      navigate(`/plans/${encodeURIComponent(plan.id)}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新建失败')
    } finally {
      setCreating(false)
    }
  }

  const items = data?.items || []
  const total = data?.total || 0

  return (
    <div className="plans-page">
      <div className="head">
        <div>
          <div className="eyebrow">Plan Templates</div>
          <h1>计划模板</h1>
          <div className="sub">配置框架分化与成品课 · 发布后出现在 H5</div>
        </div>
      </div>

      <form className="create-bar" onSubmit={(e) => { e.preventDefault(); void onCreate() }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="新建计划标题，如「热门四分化」"
        />
        <select value={newType} onChange={(e) => setNewType(e.target.value as 'framework' | 'fixed')}>
          <option value="framework">框架型</option>
          <option value="fixed">成品型</option>
        </select>
        <select value={newDays} onChange={(e) => setNewDays(Number(e.target.value))}>
          {[3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>
              每周 {d} 练
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={creating || !newTitle.trim()}>
          {creating ? '创建中…' : '新建并编排'}
        </button>
      </form>

      <div className="toolbar">
        <form className="search" onSubmit={onSearch}>
          <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder="搜标题 / ID / 署名"
          />
        </form>
        <select
          value={params.get('type') || ''}
          onChange={(e) => setFilter('type', e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="framework">框架</option>
          <option value="fixed">成品</option>
        </select>
        <select
          value={params.get('published') || ''}
          onChange={(e) => setFilter('published', e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="true">已发布</option>
          <option value="false">未发布</option>
        </select>
      </div>

      {loading ? <div className="state">加载计划…</div> : null}
      {error ? <div className="state error">{error}</div> : null}

      {!loading && !error ? (
        <div className="meta-line">
          共 <span className="num">{total}</span> 个模板
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>计划</th>
              <th>类型</th>
              <th>节奏</th>
              <th>部位</th>
              <th>排序</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => navigate(`/plans/${encodeURIComponent(item.id)}`)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.author || item.badge_label || item.id}</span>
                  </button>
                </td>
                <td>
                  <span className={`tag ${item.template_type}`}>{typeLabel(item.template_type)}</span>
                  {item.scene_tag ? (
                    <div className="scene-tag">{item.scene_tag}</div>
                  ) : null}
                </td>
                <td className="num">
                  每周 {item.days_per_week} · {item.minutes_label || '—'} · {item.block_count} 板块
                </td>
                <td>
                  <div className="chips">
                    {(item.muscle_tags || []).slice(0, 5).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </td>
                <td className="num">{item.sort_order}</td>
                <td>
                  <button
                    type="button"
                    className={`pub ${item.is_published ? 'on' : ''}`}
                    disabled={busyId === item.id}
                    onClick={() => void togglePublish(item)}
                  >
                    {item.is_published ? '已发布' : '未发布'}
                  </button>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => navigate(`/plans/${encodeURIComponent(item.id)}`)}
                    >
                      编排
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busyId === item.id}
                      onClick={() => void onDelete(item)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  暂无计划，先在上方新建一个
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
