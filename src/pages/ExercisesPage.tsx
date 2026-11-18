import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CreateExerciseModal } from '../components/CreateExerciseModal'
import { FilterSelect } from '../components/FilterSelect'
import {
  fetchExercises,
  mediaSrc,
  patchReviewFlag,
  type ExerciseListItem,
  type ExerciseListResult,
} from '../lib/api'
import {
  GEARS,
  MEDIA_STATES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  ROLE_KEYS,
  SUB_REGIONS,
  formatUpdatedAt,
  parseBoolParam,
} from '../lib/exerciseUi'
import { rememberExercisesReturn, takeExercisesScroll } from '../lib/listReturn'
import './ExercisesPage.css'

const PAGE_SIZE = 30

function statusLabel(item: ExerciseListItem): { text: string; wait: boolean } {
  if (item.needs_review) return { text: '待复核', wait: true }
  if (item.media_state === 'none') return { text: '缺素材', wait: true }
  if (item.coach_core) return { text: '主力', wait: false }
  return { text: '已入库', wait: false }
}

function pageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set<number>([1, total, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((n) => pages.add(n))
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => pages.add(n))
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  sorted.forEach((n, idx) => {
    if (idx > 0 && n - sorted[idx - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

export function ExercisesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [draftQ, setDraftQ] = useState(params.get('q') || '')
  const [data, setData] = useState<ExerciseListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const restoreScrollRef = useRef(takeExercisesScroll())

  const query = useMemo(() => {
    const page = Math.max(1, Number(params.get('page') || 1) || 1)
    const sort = params.get('sort') || 'updated_desc'
    return {
      q: params.get('q') || undefined,
      muscle: params.get('muscle') || undefined,
      sub_region: params.get('sub_region') || undefined,
      gear: params.get('gear') || undefined,
      movement_pattern: params.get('movement_pattern') || undefined,
      media_state: params.get('media_state') || undefined,
      coach_core: parseBoolParam(params.get('coach_core')),
      needs_review: parseBoolParam(params.get('needs_review')),
      sort,
      page,
      page_size: PAGE_SIZE,
    }
  }, [params])

  const subRegionOptions = query.muscle ? SUB_REGIONS[query.muscle] || [] : []

  useEffect(() => {
    rememberExercisesReturn(params.toString(), tableWrapRef.current?.scrollTop || 0)
  }, [params])

  useEffect(() => {
    setDraftQ(params.get('q') || '')
  }, [params])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchExercises(query)
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

  useEffect(() => {
    if (!data || loading) return
    const top = restoreScrollRef.current
    if (!top) return
    restoreScrollRef.current = 0
    requestAnimationFrame(() => {
      if (tableWrapRef.current) tableWrapRef.current.scrollTop = top
    })
  }, [data, loading])

  function openDetail(id: string) {
    rememberExercisesReturn(params.toString(), tableWrapRef.current?.scrollTop || 0)
    navigate(`/exercises/${id}`)
  }

  function patchFilters(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params)
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === '') copy.delete(key)
      else copy.set(key, value)
    })
    if (!('page' in next)) copy.delete('page')
    setParams(copy, { replace: true })
  }

  function onSearch(event: FormEvent) {
    event.preventDefault()
    patchFilters({ q: draftQ.trim() || null })
  }

  async function toggleReview(item: ExerciseListItem, event: MouseEvent) {
    event.stopPropagation()
    setBusyId(item.id)
    try {
      const res = await patchReviewFlag(item.id, !item.needs_review)
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((row) =>
                row.id === item.id ? { ...row, needs_review: res.needs_review } : row,
              ),
            }
          : prev,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '标记失败')
    } finally {
      setBusyId('')
    }
  }

  const total = data?.total ?? 0
  const page = data?.page ?? query.page
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)
  const pages = pageWindow(page, pageCount)

  return (
    <div className="ex-list">
      {creating ? (
        <CreateExerciseModal
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            navigate(`/exercises/${id}`)
          }}
        />
      ) : null}
      <div className="head">
        <div>
          <div className="eyebrow">Exercise Assets</div>
          <h1>标准动作 SKU</h1>
          <div className="sub num">
            {loading && !data ? '加载中…' : `${total.toLocaleString()} 条结果`}
            {query.muscle ? ` · ${query.muscle}` : ''}
            {query.sub_region ? ` / ${query.sub_region}` : ''}
            {query.movement_pattern ? ` · ${query.movement_pattern}` : ''}
            {query.coach_core ? ' · 仅主力' : ''}
            {query.needs_review ? ' · 待复核' : ''}
            {total > 0 ? ` · 第 ${page}/${pageCount} 页` : ''}
          </div>
        </div>
        <button type="button" className="create-btn" onClick={() => setCreating(true)}>
          ＋ 新建动作
        </button>
      </div>

      <form className="toolbar" onSubmit={onSearch}>
        <label className="field grow">
          <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder="中文名 / 英文名 / 别名 / ID"
          />
        </label>
        <FilterSelect
          value={query.muscle || ''}
          placeholder="全部部位"
          options={MUSCLES.map((m) => ({ value: m, label: m }))}
          onChange={(value) =>
            patchFilters({
              muscle: value || null,
              sub_region: null,
            })
          }
        />
        <FilterSelect
          value={query.sub_region || ''}
          placeholder={query.muscle ? '全部靶区' : '先选部位'}
          disabled={!query.muscle}
          options={subRegionOptions.map((s) => ({ value: s, label: s }))}
          onChange={(value) => patchFilters({ sub_region: value || null })}
        />
        <FilterSelect
          value={query.movement_pattern || ''}
          placeholder="动作模式"
          options={MOVEMENT_PATTERNS.map((p) => ({ value: p, label: p }))}
          onChange={(value) => patchFilters({ movement_pattern: value || null })}
        />
        <FilterSelect
          value={query.gear || ''}
          placeholder="全部器械"
          options={GEARS.map((g) => ({ value: g, label: g }))}
          onChange={(value) => patchFilters({ gear: value || null })}
        />
        <FilterSelect
          value={query.media_state || ''}
          placeholder="素材状态"
          options={MEDIA_STATES.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(value) => patchFilters({ media_state: value || null })}
        />
        <FilterSelect
          value={query.sort || 'updated_desc'}
          placeholder="排序"
          options={[
            { value: 'updated_desc', label: '最新更新' },
            { value: 'core', label: '主力优先' },
            { value: 'name', label: '按名称' },
          ]}
          onChange={(value) => patchFilters({ sort: value || 'updated_desc' })}
        />
        <button
          type="button"
          className={`chip ${query.coach_core ? 'on' : ''}`}
          onClick={() => patchFilters({ coach_core: query.coach_core ? null : 'true' })}
        >
          仅看主力
        </button>
        <button
          type="button"
          className={`chip ${query.needs_review ? 'on' : ''}`}
          onClick={() => patchFilters({ needs_review: query.needs_review ? null : 'true' })}
        >
          待复核
        </button>
      </form>

      <section className="panel">
        {error ? <div className="state error">{error}</div> : null}
        {loading && !data ? <div className="state">加载动作列表…</div> : null}
        {data ? (
          <>
            <div className="table-wrap" ref={tableWrapRef}>
              <table>
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>别名</th>
                    <th>分类</th>
                    <th>风险</th>
                    <th>5 槽位</th>
                    <th>状态</th>
                    <th>更新</th>
                    <th>巡检</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const st = statusLabel(item)
                    return (
                      <tr key={item.id} onClick={() => openDetail(item.id)}>
                        <td>
                          <div className="asset">
                            <span className="thumb">
                              {mediaSrc(item.thumb_url) ? (
                                <img src={mediaSrc(item.thumb_url)!} alt="" />
                              ) : (
                                '—'
                              )}
                            </span>
                            <div>
                              {item.name_zh}
                              <small className="num">
                                #{item.id}
                                {item.name_en ? ` · ${item.name_en}` : ''}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {(item.aliases || []).slice(0, 3).map((alias) => (
                            <span className="tag" key={alias}>
                              {alias}
                            </span>
                          ))}
                          {!item.aliases?.length ? '—' : null}
                        </td>
                        <td>
                          <div className="class-tags">
                            {item.muscle ? <span className="tag accent">{item.muscle}</span> : null}
                            {item.sub_region ? <span className="tag">{item.sub_region}</span> : null}
                            {item.movement_pattern ? (
                              <span className="tag">{item.movement_pattern}</span>
                            ) : null}
                            {item.gear ? <span className="tag">{item.gear}</span> : null}
                            {!item.muscle && !item.sub_region && !item.movement_pattern ? '—' : null}
                          </div>
                        </td>
                        <td>
                          {item.risk ? (
                            <span className={`risk ${item.risk.level}`}>{item.risk.label}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className="slots">
                            {ROLE_KEYS.map((role) => (
                              <i key={role} className={item.slots[role] ? 'on' : ''} />
                            ))}
                          </span>
                        </td>
                        <td>
                          <span className={`status ${st.wait ? 'wait' : ''}`}>{st.text}</span>
                        </td>
                        <td className="num">{formatUpdatedAt(item.updated_at)}</td>
                        <td>
                          <button
                            type="button"
                            className={`mark-btn ${item.needs_review ? 'on' : ''}`}
                            disabled={busyId === item.id}
                            onClick={(e) => toggleReview(item, e)}
                          >
                            {item.needs_review ? '取消待修' : '标记待修'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!data.items.length ? <div className="state">没有匹配的动作</div> : null}
            <div className="pagination">
              <span className="num">
                显示 {from}–{to} / {total.toLocaleString()}
              </span>
              <div className="pager">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => patchFilters({ page: String(page - 1) })}
                >
                  上一页
                </button>
                {pages.map((item, idx) =>
                  item === '…' ? (
                    <span key={`e-${idx}`} className="pager-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={item === page ? 'on' : ''}
                      disabled={loading}
                      onClick={() => patchFilters({ page: String(item) })}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={page >= pageCount || loading}
                  onClick={() => patchFilters({ page: String(page + 1) })}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
