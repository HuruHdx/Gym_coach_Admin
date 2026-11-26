import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreateExerciseModal } from '../components/CreateExerciseModal'
import {
  bindAiOpsMissAlias,
  diagnoseAiOpsFeedback,
  diagnoseAiOpsMiss,
  discardAiOpsFeedback,
  exportAiOpsFeedback,
  fetchAiOpsFeedbacks,
  fetchAiOpsMisses,
  fetchAiOpsPlanGaps,
  fetchExercises,
  resolveAiOpsMiss,
  type AiOpsFeedbackItem,
  type AiOpsMissDiagnose,
  type AiOpsMissItem,
  type AiOpsPlanGapItem,
  type ExerciseListItem,
} from '../lib/api'
import './AiOpsPage.css'

type MainTab = 'misses' | 'feedbacks'
type MissFilter = 'pending' | 'done'
type FeedbackFilter = 'pending' | 'exported' | 'discarded' | 'all'

const VERDICT_LABEL: Record<string, string> = {
  has_match: '库里有，没认出来',
  missing_exercise: '库里没有',
  non_exercise: '非动作问法',
}

export function AiOpsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<MainTab>('misses')
  const [missFilter, setMissFilter] = useState<MissFilter>('pending')
  const [fbFilter, setFbFilter] = useState<FeedbackFilter>('pending')
  const [misses, setMisses] = useState<AiOpsMissItem[]>([])
  const [feedbacks, setFeedbacks] = useState<AiOpsFeedbackItem[]>([])
  const [selectedMiss, setSelectedMiss] = useState<AiOpsMissItem | null>(null)
  const [selectedFb, setSelectedFb] = useState<AiOpsFeedbackItem | null>(null)
  const [diagnosis, setDiagnosis] = useState<AiOpsMissDiagnose | null>(null)
  const [fbDiagnosis, setFbDiagnosis] = useState<AiOpsFeedbackItem['ai_diagnosis']>(null)
  const [yamlText, setYamlText] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<ExerciseListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [planGaps, setPlanGaps] = useState<AiOpsPlanGapItem[]>([])

  const loadPlanGaps = useCallback(async () => {
    try {
      const res = await fetchAiOpsPlanGaps()
      setPlanGaps(res.items)
    } catch {
      setPlanGaps([])
    }
  }, [])

  const loadMisses = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchAiOpsMisses(missFilter)
      setMisses(res.items)
      setSelectedMiss((prev) => {
        if (!prev) return res.items[0] || null
        return res.items.find((i) => i.norm_query === prev.norm_query) || res.items[0] || null
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载未命中失败')
    } finally {
      setLoading(false)
    }
  }, [missFilter])

  const loadFeedbacks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchAiOpsFeedbacks(fbFilter)
      setFeedbacks(res.items)
      setSelectedFb((prev) => {
        if (!prev) return res.items[0] || null
        return res.items.find((i) => i.id === prev.id) || res.items[0] || null
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载差评失败')
    } finally {
      setLoading(false)
    }
  }, [fbFilter])

  useEffect(() => {
    void loadPlanGaps()
  }, [loadPlanGaps])

  useEffect(() => {
    if (tab === 'misses') void loadMisses()
    else void loadFeedbacks()
  }, [tab, loadMisses, loadFeedbacks])

  useEffect(() => {
    setDiagnosis(null)
    setSearchHits([])
    setSearchQ(selectedMiss?.display_query || '')
  }, [selectedMiss?.norm_query])

  useEffect(() => {
    setFbDiagnosis(selectedFb?.ai_diagnosis || null)
    setYamlText('')
  }, [selectedFb?.id])

  const historyLines = useMemo(() => {
    const snap = selectedFb?.snapshot
    const history = snap && Array.isArray(snap.history) ? snap.history : []
    return history as Array<{ role?: string; text?: string }>
  }, [selectedFb])

  async function onDiagnoseMiss() {
    if (!selectedMiss) return
    setBusy(true)
    setError('')
    try {
      const res = await diagnoseAiOpsMiss({
        norm_query: selectedMiss.norm_query,
        display_query: selectedMiss.display_query,
        examples: selectedMiss.examples,
      })
      setDiagnosis(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '诊断失败')
    } finally {
      setBusy(false)
    }
  }

  async function onSearch() {
    const q = searchQ.trim()
    if (!q) return
    setBusy(true)
    setError('')
    try {
      const res = await fetchExercises({ q, page: 1, page_size: 8 })
      setSearchHits(res.items)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setBusy(false)
    }
  }

  async function onBind(exerciseId: string, alias?: string) {
    if (!selectedMiss) return
    setBusy(true)
    setError('')
    try {
      await bindAiOpsMissAlias({
        norm_query: selectedMiss.norm_query,
        exercise_id: exerciseId,
        alias: alias || selectedMiss.display_query || selectedMiss.norm_query,
      })
      await loadMisses()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '绑定失败')
    } finally {
      setBusy(false)
    }
  }

  async function onResolve(status: 'created_sku' | 'ignored', exerciseId?: string) {
    if (!selectedMiss) return
    setBusy(true)
    setError('')
    try {
      await resolveAiOpsMiss({
        norm_query: selectedMiss.norm_query,
        status,
        bound_exercise_id: exerciseId,
      })
      await loadMisses()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setBusy(false)
    }
  }

  async function onDiagnoseFb() {
    if (!selectedFb) return
    setBusy(true)
    setError('')
    try {
      const res = await diagnoseAiOpsFeedback(selectedFb.id)
      setFbDiagnosis(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '诊断失败')
    } finally {
      setBusy(false)
    }
  }

  async function onExportFb() {
    if (!selectedFb) return
    setBusy(true)
    setError('')
    try {
      const res = await exportAiOpsFeedback(selectedFb.id, {
        write_file: true,
        format: 'auto',
      })
      setYamlText(res.yaml)
      await loadFeedbacks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  async function onDiscardFb() {
    if (!selectedFb) return
    setBusy(true)
    setError('')
    try {
      await discardAiOpsFeedback(selectedFb.id)
      await loadFeedbacks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '忽略失败')
    } finally {
      setBusy(false)
    }
  }

  async function copyYaml() {
    if (!yamlText) return
    try {
      await navigator.clipboard.writeText(yamlText)
    } catch {
      setError('复制失败')
    }
  }

  return (
    <div className="ai-ops">
      <div className="head">
        <div>
          <div className="eyebrow">AI Operations</div>
          <h1>未命中与反馈追踪</h1>
          <div className="sub">系统记未命中 · 审差评 · 进评测 inbox</div>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={tab === 'misses' ? 'on' : ''} onClick={() => setTab('misses')}>
          未命中动作池
        </button>
        <button
          type="button"
          className={tab === 'feedbacks' ? 'on' : ''}
          onClick={() => setTab('feedbacks')}
        >
          差评与评测收件箱
        </button>
      </div>

      {planGaps.length ? (
        <div className="gap-banner">
          <div className="gap-banner-main">
            <strong>近期高频求计划但库空</strong>
            <span className="muted">荐模板 0 命中 · 可去工坊补内容</span>
          </div>
          <ul className="gap-list">
            {planGaps.map((g) => (
              <li key={g.key}>
                <span>
                  <b>{g.label}</b>
                  <span className="muted num"> · {g.count} 次</span>
                  {g.examples[0] ? <span className="muted"> · 「{g.examples[0]}」</span> : null}
                </span>
                <Link className="gap-link" to="/studio">
                  去工坊
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? <div className="state">加载中…</div> : null}
      {error ? <div className="state error">{error}</div> : null}

      {tab === 'misses' ? (
        <>
          <div className="filter-row">
            <button
              type="button"
              className={missFilter === 'pending' ? 'on' : ''}
              onClick={() => setMissFilter('pending')}
            >
              待处理
            </button>
            <button
              type="button"
              className={missFilter === 'done' ? 'on' : ''}
              onClick={() => setMissFilter('done')}
            >
              已处理
            </button>
          </div>
          <div className="layout">
            <section className="panel">
              <div className="panel-head">
                <strong>未命中词</strong>
                <span className="muted num">{misses.length}</span>
              </div>
              <div className="list">
                {misses.map((item) => (
                  <button
                    key={item.norm_query}
                    type="button"
                    className={`row ${selectedMiss?.norm_query === item.norm_query ? 'on' : ''}`}
                    onClick={() => setSelectedMiss(item)}
                  >
                    <div>
                      <div className="row-title">{item.display_query}</div>
                      <div className="row-meta num">
                        {item.count} 次 · {item.examples[0] || '—'}
                      </div>
                    </div>
                    <span className={`badge ${item.status === 'pending' ? 'wait' : ''}`}>
                      {item.status}
                    </span>
                  </button>
                ))}
                {!misses.length && !loading ? <div className="empty">暂无未命中</div> : null}
              </div>
            </section>

            <section className="panel">
              {!selectedMiss ? (
                <div className="empty">选择左侧一条处理</div>
              ) : (
                <>
                  <div className="detail-block">
                    <h3>原句示例</h3>
                    <ul>
                      {(selectedMiss.examples.length ? selectedMiss.examples : [selectedMiss.display_query]).map(
                        (ex) => (
                          <li key={ex}>{ex}</li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="detail-block">
                    <h3>系统 near_miss</h3>
                    {selectedMiss.near_miss.length ? (
                      <ul>
                        {selectedMiss.near_miss.map((n, idx) => (
                          <li key={`${n.name_zh}-${idx}`}>
                            {n.name_zh}
                            {n.exercise_id ? ` · ${n.exercise_id}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">无</p>
                    )}
                  </div>

                  <div className="actions" style={{ marginBottom: 16 }}>
                    <button type="button" className="primary" disabled={busy} onClick={() => void onDiagnoseMiss()}>
                      AI 判别
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => setCreateOpen(true)}
                    >
                      新建 SKU
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      disabled={busy}
                      onClick={() => void onResolve('ignored')}
                    >
                      忽略
                    </button>
                  </div>

                  {diagnosis ? (
                    <div className="detail-block">
                      <h3>AI 结论</h3>
                      <p>
                        <strong>{VERDICT_LABEL[diagnosis.verdict] || diagnosis.verdict}</strong>
                        {' · '}
                        {diagnosis.reason}
                      </p>
                      <div className="cand" style={{ marginTop: 10 }}>
                        {diagnosis.suggested_candidates.map((c) => (
                          <div className="cand-item" key={`${c.exercise_id}-${c.name_zh}`}>
                            <div>
                              <div>{c.name_zh}</div>
                              <div className="muted num">
                                {c.exercise_id || '—'}
                                {c.confidence != null ? ` · ${(c.confidence * 100).toFixed(0)}%` : ''}
                              </div>
                            </div>
                            {c.exercise_id ? (
                              <button
                                type="button"
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  void onBind(
                                    c.exercise_id!,
                                    diagnosis.suggested_alias || selectedMiss.display_query,
                                  )
                                }
                              >
                                绑别名
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="detail-block">
                    <h3>搜库绑定</h3>
                    <div className="search-box">
                      <input
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="搜动作名"
                        onKeyDown={(e) => e.key === 'Enter' && void onSearch()}
                      />
                      <button type="button" className="ghost" disabled={busy} onClick={() => void onSearch()}>
                        搜索
                      </button>
                    </div>
                    <div className="cand">
                      {searchHits.map((hit) => (
                        <div className="cand-item" key={hit.id}>
                          <div>
                            <div>{hit.name_zh}</div>
                            <div className="muted num">{hit.id}</div>
                          </div>
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={() => void onBind(hit.id)}
                          >
                            绑别名
                          </button>
                        </div>
                      ))}
                      {selectedMiss.near_miss
                        .filter((n) => n.exercise_id)
                        .map((n) => (
                          <div className="cand-item" key={`nm-${n.exercise_id}`}>
                            <div>
                              <div>{n.name_zh}</div>
                              <div className="muted num">{n.exercise_id}</div>
                            </div>
                            <button
                              type="button"
                              className="primary"
                              disabled={busy}
                              onClick={() => void onBind(String(n.exercise_id))}
                            >
                              绑别名
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="filter-row">
            {(
              [
                ['pending', '待处理'],
                ['exported', '已导出'],
                ['discarded', '已忽略'],
                ['all', '全部'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={fbFilter === value ? 'on' : ''}
                onClick={() => setFbFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="layout">
            <section className="panel">
              <div className="panel-head">
                <strong>差评</strong>
                <span className="muted num">{feedbacks.length}</span>
              </div>
              <div className="list">
                {feedbacks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`row ${selectedFb?.id === item.id ? 'on' : ''}`}
                    onClick={() => setSelectedFb(item)}
                  >
                    <div>
                      <div className="row-title">{item.question || `FB-${item.id}`}</div>
                      <div className="row-meta">
                        {(item.tags || []).join('+') || 'other'}
                        {item.created_at ? ` · ${item.created_at.slice(0, 16).replace('T', ' ')}` : ''}
                      </div>
                    </div>
                    <span className={`badge ${item.export_status === 'pending' ? 'wait' : ''}`}>
                      {item.export_status}
                    </span>
                  </button>
                ))}
                {!feedbacks.length && !loading ? <div className="empty">暂无差评</div> : null}
              </div>
            </section>

            <section className="panel">
              {!selectedFb ? (
                <div className="empty">选择左侧一条处理</div>
              ) : (
                <>
                  <div className="detail-block">
                    <h3>问答</h3>
                    <p>
                      <strong>Q</strong> {selectedFb.question}
                    </p>
                    <p style={{ marginTop: 8 }}>
                      <strong>A</strong> {selectedFb.answer}
                    </p>
                    {selectedFb.note ? <p className="muted" style={{ marginTop: 8 }}>备注：{selectedFb.note}</p> : null}
                  </div>

                  <div className="detail-block">
                    <h3>快照</h3>
                    <p className="muted">
                      route={String(selectedFb.snapshot?.route || '—')} · branch=
                      {String(selectedFb.snapshot?.branch || '—')} · trace=
                      {selectedFb.trace_id ?? '—'}
                    </p>
                    {historyLines.length ? (
                      <ul style={{ marginTop: 8 }}>
                        {historyLines.map((h, idx) => (
                          <li key={idx}>
                            [{h.role || '?'}] {h.text || ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">无多轮 history</p>
                    )}
                  </div>

                  <div className="actions" style={{ marginBottom: 16 }}>
                    <button type="button" className="primary" disabled={busy} onClick={() => void onDiagnoseFb()}>
                      AI 诊断
                    </button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => void onExportFb()}>
                      导出 Eval
                    </button>
                    <button type="button" className="ghost" disabled={!yamlText} onClick={() => void copyYaml()}>
                      复制 YAML
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      disabled={busy}
                      onClick={() => void onDiscardFb()}
                    >
                      忽略
                    </button>
                  </div>

                  {fbDiagnosis ? (
                    <div className="detail-block">
                      <h3>归因</h3>
                      <p>
                        <strong>{fbDiagnosis.root_cause}</strong>
                        {fbDiagnosis.fix_hint ? ` · ${fbDiagnosis.fix_hint}` : ''}
                      </p>
                      {fbDiagnosis.assert_draft ? (
                        <pre className="yaml" style={{ marginTop: 8 }}>
                          {fbDiagnosis.assert_draft}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  {yamlText ? (
                    <div className="detail-block">
                      <h3>Eval YAML</h3>
                      <pre className="yaml">{yamlText}</pre>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </>
      )}

      {createOpen && selectedMiss ? (
        <CreateExerciseModal
          initialNameZh={selectedMiss.display_query}
          initialAliases={selectedMiss.display_query}
          onCancel={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            void onResolve('created_sku', id).then(() => navigate(`/exercises/${id}`))
          }}
        />
      ) : null}
    </div>
  )
}
