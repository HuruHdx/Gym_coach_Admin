import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchOverview, mediaSrc, type OverviewStats } from '../lib/api'
import './DashboardPage.css'

const ROLE_LABELS: Record<string, string> = {
  start: '起始',
  end: '结束',
  demo: '动图',
  highlight_video: '高光',
  tip: '纠错',
}

function heatClass(pct: number) {
  if (pct >= 85) return 'heat hot'
  if (pct >= 55) return 'heat mid'
  return 'heat'
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchOverview()
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
  }, [])

  const t = data?.totals

  return (
    <div className="dash">
      <div className="head">
        <div>
          <div className="eyebrow">Content Engineering Console</div>
          <h1>动作资产控制台</h1>
          <div className="sub">清洗入库后的真实库存 · 点击指标可下钻到 SKU 列表</div>
        </div>
      </div>

      {loading ? <div className="state">加载大盘…</div> : null}
      {error ? <div className="state error">{error}</div> : null}

      {t ? (
        <section className="stats" aria-label="关键指标">
          <button type="button" className="stat" onClick={() => navigate('/exercises')}>
            <div className="stat-label">动作 SKU</div>
            <div className="stat-value num">{t.exercises.toLocaleString()}</div>
            <div className="stat-meta">全部入库</div>
          </button>
          <button
            type="button"
            className="stat"
            onClick={() => navigate('/exercises?coach_core=true')}
          >
            <div className="stat-label">主力动作</div>
            <div className="stat-value num">{t.coach_core.toLocaleString()}</div>
            <div className="stat-meta">coach_core</div>
          </button>
          <button
            type="button"
            className="stat"
            onClick={() => navigate('/exercises?media_state=frames_only')}
          >
            <div className="stat-label">有起势图占比</div>
            <div className="stat-value num">{t.with_media_rate}%</div>
            <div className="stat-meta num">{t.with_image_start.toLocaleString()} 条有图</div>
          </button>
          <button
            type="button"
            className="stat"
            onClick={() => navigate('/exercises?coach_core=true')}
          >
            <div className="stat-label">主力精洗完成率</div>
            <div className="stat-value num">{t.enrich_rate}%</div>
            <div className="stat-meta num">
              {t.enriched_core} / {t.coach_core}
            </div>
          </button>
          <button
            type="button"
            className="stat"
            onClick={() => navigate('/exercises?needs_review=true')}
          >
            <div className="stat-label">待复核</div>
            <div className="stat-value num">{t.needs_review.toLocaleString()}</div>
            <div className={`stat-meta ${t.needs_review ? 'alert' : ''}`}>标记待修清单</div>
          </button>
        </section>
      ) : null}

      {data ? (
        <div className="main-grid">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  部位 × 素材覆盖 <span className="panel-note">主力动作 5 槽位</span>
                </div>
                <Link className="link-btn" to="/exercises?coach_core=true">
                  查看主力清单 →
                </Link>
              </div>
              <div className="coverage">
                <div className="matrix-head">
                  <span />
                  {Object.keys(ROLE_LABELS).map((role) => (
                    <span key={role}>{ROLE_LABELS[role]}</span>
                  ))}
                </div>
                {data.coverage.map((row) => (
                  <div className="matrix-row" key={row.muscle}>
                    <button
                      type="button"
                      className="matrix-name"
                      onClick={() => navigate(`/exercises?muscle=${encodeURIComponent(row.muscle)}&coach_core=true`)}
                    >
                      {row.muscle}
                      <small className="num">{row.count}</small>
                    </button>
                    {Object.keys(ROLE_LABELS).map((role) => {
                      const pct = row.slots[role] ?? 0
                      return (
                        <button
                          key={role}
                          type="button"
                          className={heatClass(pct)}
                          onClick={() =>
                            navigate(
                              `/exercises?muscle=${encodeURIComponent(row.muscle)}&coach_core=true`,
                            )
                          }
                        >
                          <span className="num">{pct}%</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">最近更新的动作</div>
                <Link className="link-btn" to="/exercises">
                  打开 SKU 库 →
                </Link>
              </div>
              <table className="asset-table">
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>靶区 / 器械</th>
                    <th>风险</th>
                    <th>素材槽位</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((item) => (
                    <tr key={item.id} onClick={() => navigate(`/exercises/${item.id}`)}>
                      <td>
                        <div className="exercise">
                          <span className="thumb">
                            {mediaSrc(item.thumb_url) ? (
                              <img src={mediaSrc(item.thumb_url)!} alt="" />
                            ) : (
                              '—'
                            )}
                          </span>
                          <div>
                            {item.name_zh}
                            <div className="task-meta num">SKU #{item.id}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="tag">{item.sub_region || item.muscle}</span>{' '}
                        <span className="tag">{item.gear}</span>
                      </td>
                      <td>{item.risk?.label || '—'}</td>
                      <td>
                        <span className="slots">
                          {['start', 'end', 'demo', 'highlight_video', 'tip'].map((role) => (
                            <i key={role} className={`slot ${item.slots[role] ? 'on' : ''}`} />
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className={`task-state ${item.needs_review ? 'wait' : ''}`}>
                          {item.needs_review ? '待复核' : item.coach_core ? '主力' : '已入库'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">内容健康度</div>
                <span className="panel-note">主力精洗</span>
              </div>
              <div className="health">
                <div
                  className="health-ring"
                  style={{ ['--ring-pct' as string]: `${t?.enrich_rate ?? 0}%` }}
                >
                  <strong className="num">{t?.enrich_rate ?? 0}%</strong>
                </div>
                <div className="health-copy">
                  <div className="health-row">
                    <span>精洗通过</span>
                    <b className="num">{t?.enriched_core ?? 0}</b>
                  </div>
                  <div className="health-row">
                    <span>待人工复核</span>
                    <b className="num">{t?.needs_review ?? 0}</b>
                  </div>
                  <div className="health-row">
                    <span>有起势图</span>
                    <b className="num">{t?.with_image_start ?? 0}</b>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
