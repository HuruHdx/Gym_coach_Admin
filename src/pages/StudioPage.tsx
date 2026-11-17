import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  confirmStudioPlan,
  fetchExercises,
  fetchStudioCookies,
  fetchStudioTask,
  fetchStudioTasks,
  ingestStudioBatch,
  mediaSrc,
  previewStudioClip,
  quickCreateStudioExercise,
  saveStudioCookies,
  saveStudioDraft,
  uploadStudioFallback,
  uploadStudioTaskCover,
  type ExerciseListItem,
  type StudioDraft,
  type StudioExerciseDraft,
  type StudioTask,
} from '../lib/api'
import './StudioPage.css'

const TARGET_MUSCLES = ['胸', '背', '肩', '腿', '臂', '核心'] as const

function asDraft(raw: StudioTask['draft_json']): StudioDraft {
  const d = (raw || {}) as StudioDraft
  return {
    plan_title: d.plan_title || '',
    scene_tag: d.scene_tag || '博主同款',
    cover_url: d.cover_url || '',
    mode: d.mode,
    blocks: Array.isArray(d.blocks) ? d.blocks : [],
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    queued: '排队中',
    downloading: '下载中',
    transcribing: '转字幕',
    parsing: '拆计划',
    done: '待审核',
    needs_manual_upload: '需补传',
    failed: '失败',
  }
  return map[s] || s
}

export function StudioPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [task, setTask] = useState<StudioTask | null>(null)
  const [draft, setDraft] = useState<StudioDraft>({ plan_title: '', blocks: [] })
  const [mode, setMode] = useState<'plan_single' | 'plan_merge' | 'exercise_only'>('plan_single')
  const [ingestText, setIngestText] = useState('')
  const [planTitle, setPlanTitle] = useState('')
  const [merge, setMerge] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showIngest, setShowIngest] = useState(false)
  const [showCookies, setShowCookies] = useState(false)
  const [cookies, setCookies] = useState({ bilibili: '', douyin: '', youtube: '' })
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(5)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [activeBlockIdx, setActiveBlockIdx] = useState(0)
  const [pickerQ, setPickerQ] = useState('')
  const [pickerHits, setPickerHits] = useState<ExerciseListItem[]>([])
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)
  const [appendPlanId, setAppendPlanId] = useState('')

  const reloadList = useCallback(async () => {
    const res = await fetchStudioTasks(80)
    setTasks(res.items)
    return res.items
  }, [])

  const selectTask = useCallback(async (id: number) => {
    const detail = await fetchStudioTask(id)
    setActiveId(id)
    setTask(detail)
    const d = asDraft(detail.draft_json)
    setDraft(d)
    setActiveBlockIdx(0)
    const first = d.blocks[0]?.exercises?.[0]
    const snip = first?.snippet
    setClipStart(Number(snip?.start ?? 0))
    setClipEnd(Number(snip?.end ?? 5))
    setPreviewUrl(null)
  }, [])

  useEffect(() => {
    let alive = true
    reloadList()
      .then((items) => {
        if (!alive || !items.length) return
        if (activeId == null) void selectTask(items[0].id)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 轮询进行中任务
  useEffect(() => {
    const ticking = tasks.some((t) =>
      ['queued', 'downloading', 'transcribing', 'parsing'].includes(t.status),
    )
    if (!ticking) return
    const timer = window.setInterval(() => {
      void reloadList().then((items) => {
        if (activeId != null) {
          const hit = items.find((t) => t.id === activeId)
          if (hit && hit.status === 'done') void selectTask(activeId)
        }
      })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [tasks, activeId, reloadList, selectTask])

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
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [pickerQ])

  const activeBlock = draft.blocks[activeBlockIdx] || null
  const isExerciseOnly =
    task?.mode === 'exercise_only' || draft.mode === 'exercise_only' || mode === 'exercise_only'
  const redRows = useMemo(() => {
    const rows: StudioExerciseDraft[] = []
    for (const b of draft.blocks) {
      for (const ex of b.exercises || []) {
        if (ex.traffic === 'red' || !ex.exercise_id) rows.push(ex)
      }
    }
    return rows
  }, [draft])
  const amberRows = useMemo(() => {
    const rows: StudioExerciseDraft[] = []
    for (const b of draft.blocks) {
      for (const ex of b.exercises || []) {
        if (ex.traffic === 'amber' && ex.exercise_id) rows.push(ex)
      }
    }
    return rows
  }, [draft])
  const greenRows = useMemo(() => {
    const rows: StudioExerciseDraft[] = []
    for (const b of draft.blocks) {
      for (const ex of b.exercises || []) {
        if (ex.traffic === 'green' && ex.exercise_id) rows.push(ex)
      }
    }
    return rows
  }, [draft])
  const allRows = useMemo(() => {
    const rows: StudioExerciseDraft[] = []
    for (const b of draft.blocks) {
      for (const ex of b.exercises || []) rows.push(ex)
    }
    return rows
  }, [draft])

  function patchExercise(rowId: string, patch: Partial<StudioExerciseDraft>) {
    setDraft((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => ({
        ...b,
        exercises: (b.exercises || []).map((ex) =>
          ex.id === rowId ? { ...ex, ...patch } : ex,
        ),
      })),
    }))
  }

  function focusRow(ex: StudioExerciseDraft) {
    const start = Number(ex.snippet?.start ?? 0)
    const end = Number(ex.snippet?.end ?? start + 5)
    setClipStart(start)
    setClipEnd(end)
    const el = videoRef.current
    if (el) {
      el.currentTime = start
      void el.play().catch(() => undefined)
    }
  }

  async function onIngest() {
    setBusy(true)
    setError('')
    try {
      const files = fileRef.current?.files ? Array.from(fileRef.current.files) : []
      const res = await ingestStudioBatch({
        text: ingestText,
        mode: merge ? 'plan_merge' : mode,
        merge_into_one_plan: merge,
        plan_title: planTitle || undefined,
        files,
      })
      setShowIngest(false)
      setIngestText('')
      setPlanTitle('')
      if (fileRef.current) fileRef.current.value = ''
      await reloadList()
      if (res.items[0]) await selectTask(res.items[0].id)
      setNotice(`已提交 ${res.items.length} 个任务`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '入库失败')
    } finally {
      setBusy(false)
    }
  }

  async function onFallback(file: File | null) {
    if (!file || activeId == null) return
    setBusy(true)
    try {
      await uploadStudioFallback(activeId, file)
      await reloadList()
      await selectTask(activeId)
      setNotice('已补传，流水线继续')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '补传失败')
    } finally {
      setBusy(false)
      if (fallbackRef.current) fallbackRef.current.value = ''
    }
  }

  async function onSaveDraft() {
    if (activeId == null) return
    setBusy(true)
    try {
      const next = await saveStudioDraft(activeId, draft)
      setTask(next)
      setNotice('草稿已保存')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function onPreviewClip() {
    if (activeId == null) return
    setBusy(true)
    try {
      const res = await previewStudioClip(activeId, clipStart, clipEnd)
      setPreviewUrl(mediaSrc(res.demo_url))
      setNotice('预览切片已生成')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '切片失败（需 ffmpeg）')
    } finally {
      setBusy(false)
    }
  }

  async function onQuickCreate(ex: StudioExerciseDraft) {
    if (activeId == null) return
    setBusy(true)
    try {
      const res = await quickCreateStudioExercise({
        task_id: activeId,
        spoken_name: ex.spoken_name || ex.exercise_name || '新动作',
        muscle: ex.target_muscle || '胸',
        role: ex.role || 'isolation',
        start: ex.snippet?.start,
        end: ex.snippet?.end,
        attach_demo: true,
      })
      patchExercise(ex.id, {
        exercise_id: res.exercise.id,
        exercise_name: res.exercise.name_zh,
        traffic: 'green',
        match_confidence: 1,
      })
      setNotice(`已新建 SKU：${res.exercise.name_zh}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新建失败')
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm(publish: boolean) {
    if (activeId == null) return
    const exerciseOnly = isExerciseOnly
    const msg = exerciseOnly
      ? '确认把勾选的示范写入动作库？（不建计划）'
      : publish
        ? '确认发布计划上线？'
        : '确认存为草稿计划？'
    if (!window.confirm(msg)) return
    setBusy(true)
    setError('')
    try {
      const res = await confirmStudioPlan({
        task_id: activeId,
        draft: { ...draft, mode: exerciseOnly ? 'exercise_only' : draft.mode },
        append_to_plan_id: exerciseOnly ? null : appendPlanId.trim() || null,
        publish: exerciseOnly ? false : publish,
      })
      if (exerciseOnly) {
        setNotice(`已写入动作库示范 ${res.attached ?? 0} 条`)
      } else if (res.plan_id) {
        setNotice(`已写入计划 ${res.plan_id}`)
        navigate(`/plans/${encodeURIComponent(res.plan_id)}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发布失败')
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
      setNotice('封面已上传')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '封面上传失败')
    } finally {
      setBusy(false)
      if (coverRef.current) coverRef.current.value = ''
    }
  }

  function renderRowOps(ex: StudioExerciseDraft) {
    return (
      <>
        <div className="ex-ops">
          <button type="button" onClick={() => void onQuickCreate(ex)}>
            ＋ 一键新建 SKU
          </button>
          <button
            type="button"
            onClick={() => {
              setPickerRowId(ex.id)
              setPickerQ(ex.spoken_name || '')
            }}
          >
            搜库换绑
          </button>
          <select
            value={ex.target_muscle || '全身'}
            onChange={(e) => patchExercise(ex.id, { target_muscle: e.target.value })}
          >
            {['全身', ...TARGET_MUSCLES].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {pickerRowId === ex.id ? (
          <div className="picker">
            <input
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
              placeholder="搜动作"
              autoFocus
            />
            <ul>
              {pickerHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      patchExercise(ex.id, {
                        exercise_id: hit.id,
                        exercise_name: hit.name_zh,
                        traffic: ex.sets_from_transcript === false ? 'amber' : 'green',
                        match_confidence: 1,
                        target_muscle: hit.muscle || ex.target_muscle,
                      })
                      setPickerRowId(null)
                    }}
                  >
                    {hit.name_zh}
                    <span>{hit.muscle}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(ex.attach_demo || ex.replace_demo)}
            onChange={(e) =>
              patchExercise(ex.id, {
                attach_demo: e.target.checked,
                replace_demo: e.target.checked,
              })
            }
          />
          用这段画面补/换动作库示范
        </label>
      </>
    )
  }

  async function openCookies() {
    setShowCookies(true)
    try {
      const data = await fetchStudioCookies()
      setCookies({
        bilibili: data.bilibili || '',
        douyin: data.douyin || '',
        youtube: data.youtube || '',
      })
    } catch {
      /* ignore */
    }
  }

  const playSrc = mediaSrc(task?.play_url || task?.stored_path)

  return (
    <div className="studio">
      <div className="studio-top">
        <div>
          <div className="eyebrow">Content Studio</div>
          <h1>内容工坊</h1>
          <p className="sub">贴口令/上传 → 字幕拆计划 → 审核绑定 → 发布到计划模板 & 动作库</p>
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setShowIngest(true)}>
            ＋ 批量贴口令/链接
          </button>
          <button type="button" onClick={() => void openCookies()}>
            平台 Cookie
          </button>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="plan_single">模式：拆计划</option>
            <option value="exercise_only">模式：仅存动作素材</option>
            <option value="plan_merge">模式：多条合成</option>
          </select>
        </div>
      </div>

      {error ? <div className="banner err">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="studio-grid">
        {/* 左栏队列 */}
        <aside className="col queue">
          <div className="col-head">任务队列</div>
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={t.id === activeId ? 'on' : ''}
                  onClick={() => void selectTask(t.id)}
                >
                  <strong>
                    #{t.id}
                    {t.batch_id ? ` · 合集` : ''}
                  </strong>
                  <span>
                    {statusLabel(t.status)}
                    {t.score?.red_count ? ` · ⚠${t.score.red_count}` : ''}
                    {t.progress < 100 && t.status !== 'done' ? ` · ${t.progress}%` : ''}
                  </span>
                  <em>{t.source_url || t.source_text || t.mode}</em>
                </button>
              </li>
            ))}
            {!tasks.length ? <li className="empty">暂无任务，点上方入库</li> : null}
          </ul>
        </aside>

        {/* 中栏视频 */}
        <section className="col mid">
          <div className="col-head">视频预览 / 切片</div>
          {!task ? (
            <div className="empty">选择左侧任务</div>
          ) : (
            <>
              {task.status === 'needs_manual_upload' ? (
                <div className="fallback">
                  <p>下载失败或需人工补传：{task.error}</p>
                  <button type="button" onClick={() => fallbackRef.current?.click()}>
                    补传本地 MP4
                  </button>
                  <input
                    ref={fallbackRef}
                    type="file"
                    hidden
                    accept="video/*"
                    onChange={(e) => void onFallback(e.target.files?.[0] || null)}
                  />
                </div>
              ) : null}

              <div className="video-box">
                {playSrc ? (
                  <video ref={videoRef} src={playSrc} controls playsInline />
                ) : (
                  <div className="empty">等待视频就绪…（{statusLabel(task.status)}）</div>
                )}
              </div>

              <div className="clip-bar">
                <label>
                  起
                  <input
                    className="num"
                    type="number"
                    step="0.1"
                    value={clipStart}
                    onChange={(e) => setClipStart(Number(e.target.value) || 0)}
                  />
                </label>
                <label>
                  止
                  <input
                    className="num"
                    type="number"
                    step="0.1"
                    value={clipEnd}
                    onChange={(e) => setClipEnd(Number(e.target.value) || 0)}
                  />
                </label>
                <button type="button" disabled={busy} onClick={() => void onPreviewClip()}>
                  预览 3~6s 静音切片
                </button>
              </div>
              {previewUrl ? (
                <video className="preview-loop" src={previewUrl} muted loop autoPlay playsInline />
              ) : null}

              <div className="transcript">
                <div className="col-head">时间戳字幕</div>
                {(task.transcript_json?.segments || []).length ? (
                  <ul>
                    {(task.transcript_json.segments || []).map((seg, i) => (
                      <li key={`${seg.start}-${i}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setClipStart(seg.start)
                            setClipEnd(Math.max(seg.end, seg.start + 3))
                            if (videoRef.current) {
                              videoRef.current.currentTime = seg.start
                            }
                          }}
                        >
                          <span className="num">
                            {seg.start.toFixed(1)}–{seg.end.toFixed(1)}
                          </span>
                          {seg.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty">
                    {task.transcript_json?.warning ||
                      (task.status === 'done'
                        ? '无字幕（可仍审核草稿；安装 faster-whisper 后可重跑）'
                        : `处理中：${statusLabel(task.status)}`)}
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {/* 右栏审核 */}
        <section className="col right">
          <div className="col-head">{isExerciseOnly ? '动作素材审核' : '计划 & 动作库审核'}</div>
          {!task ? (
            <div className="empty">选择任务</div>
          ) : isExerciseOnly ? (
            <>
              <p className="hint">仅存动作素材：绑 SKU → 勾示范 → 写入动作库（不建计划）</p>
              <div className="review-section red">
                <h3>待绑定 · {redRows.length}</h3>
                {allRows.map((ex) => (
                  <div key={ex.id} className="ex-card">
                    <button type="button" className="ex-title" onClick={() => focusRow(ex)}>
                      {ex.exercise_id ? '✓' : '!'} {ex.spoken_name || ex.exercise_name || '未命名'}
                      <span>
                        {ex.target_muscle} · {ex.snippet?.start ?? 0}s–{ex.snippet?.end ?? 5}s
                      </span>
                    </button>
                    {renderRowOps(ex)}
                  </div>
                ))}
                {!allRows.length ? <p className="empty">无动作行</p> : null}
              </div>
              <div className="footer-actions">
                <button type="button" disabled={busy} onClick={() => void onSaveDraft()}>
                  存草稿
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void onConfirm(false)}
                >
                  写入动作库示范
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                计划名
                <input
                  value={draft.plan_title || ''}
                  onChange={(e) => setDraft({ ...draft, plan_title: e.target.value })}
                />
              </label>
              <label className="field">
                场景标签
                <select
                  value={draft.scene_tag || ''}
                  onChange={(e) => setDraft({ ...draft, scene_tag: e.target.value })}
                >
                  <option value="博主同款">博主同款</option>
                  <option value="三分化">三分化</option>
                  <option value="四分化">四分化</option>
                  <option value="单部位专项">单部位专项</option>
                  <option value="新手入门">新手入门</option>
                </select>
              </label>
              <label className="field">
                计划封面
                <div className="cover-row">
                  <input
                    value={draft.cover_url || ''}
                    onChange={(e) => setDraft({ ...draft, cover_url: e.target.value })}
                    placeholder="https://… 或上传"
                  />
                  <button type="button" disabled={busy} onClick={() => coverRef.current?.click()}>
                    上传
                  </button>
                  <input
                    ref={coverRef}
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => void onUploadCover(e.target.files?.[0] || null)}
                  />
                </div>
                {draft.cover_url ? (
                  <img className="cover-preview" src={mediaSrc(draft.cover_url) || ''} alt="" />
                ) : null}
              </label>

              {draft.blocks.length > 1 ? (
                <div className="block-tabs">
                  {draft.blocks.map((b, i) => (
                    <button
                      key={i}
                      type="button"
                      className={i === activeBlockIdx ? 'on' : ''}
                      onClick={() => setActiveBlockIdx(i)}
                    >
                      {i + 1}.{b.title}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="review-section red">
                <h3>必审红灯 · {redRows.length}</h3>
                {redRows.map((ex) => (
                  <div key={ex.id} className="ex-card">
                    <button type="button" className="ex-title" onClick={() => focusRow(ex)}>
                      ! {ex.spoken_name || ex.exercise_name || '未命名'}
                      <span>
                        {ex.target_muscle} · {ex.role} · {ex.target_sets ?? '?'}×
                        {ex.target_reps || '?'}
                      </span>
                    </button>
                    {renderRowOps(ex)}
                  </div>
                ))}
                {!redRows.length ? <p className="empty">无红灯</p> : null}
              </div>

              <div className="review-section amber">
                <h3>黄灯 · 组次为默认建议 · {amberRows.length}</h3>
                {amberRows.map((ex) => (
                  <div key={ex.id} className="ex-card">
                    <button type="button" className="ex-title" onClick={() => focusRow(ex)}>
                      ~ {ex.exercise_name || ex.spoken_name}
                      <span>
                        {ex.target_muscle} · {ex.role} · {ex.target_sets ?? '?'}×
                        {ex.target_reps || '?'}（建议值）
                      </span>
                    </button>
                    {renderRowOps(ex)}
                    <button
                      type="button"
                      onClick={() =>
                        patchExercise(ex.id, { traffic: 'green', sets_from_transcript: true })
                      }
                    >
                      组次已核对 → 转绿灯
                    </button>
                  </div>
                ))}
                {!amberRows.length ? <p className="empty">无黄灯</p> : null}
              </div>

              <div className="review-section green">
                <h3>高分绿灯 · {greenRows.length}</h3>
                {greenRows.map((ex) => (
                  <div key={ex.id} className="ex-card">
                    <button type="button" className="ex-title" onClick={() => focusRow(ex)}>
                      ✓ {ex.exercise_name || ex.spoken_name}
                      <span>
                        {ex.target_muscle} · {ex.role} · {ex.target_sets ?? '?'}×
                        {ex.target_reps || '?'}
                      </span>
                    </button>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={Boolean(ex.attach_demo || ex.replace_demo)}
                        onChange={(e) =>
                          patchExercise(ex.id, {
                            attach_demo: e.target.checked,
                            replace_demo: e.target.checked,
                          })
                        }
                      />
                      用这段画面补/换动作库示范
                    </label>
                  </div>
                ))}
              </div>

              {activeBlock ? (
                <p className="hint">
                  当前板块：{activeBlock.title} · {(activeBlock.muscles || []).join('、')} ·{' '}
                  {(activeBlock.exercises || []).length} 动作
                </p>
              ) : null}

              <label className="field">
                并入已有计划 ID（可选）
                <input
                  value={appendPlanId}
                  placeholder="例如 three-split-classic"
                  onChange={(e) => setAppendPlanId(e.target.value)}
                />
              </label>

              <div className="footer-actions">
                <button type="button" disabled={busy} onClick={() => void onSaveDraft()}>
                  存草稿
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void onConfirm(true)}
                >
                  一键发布上线
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {showIngest ? (
        <div className="modal-mask">
          <div className="modal">
            <h2>批量入库</h2>
            <textarea
              rows={6}
              placeholder="粘贴 1～10 条抖音/B站分享口令或链接…"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
            />
            <label className="field">
              计划名（合成时必填更清晰）
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={merge}
                onChange={(e) => setMerge(e.target.checked)}
              />
              合成为同一套计划（多链接 → 多板块）
            </label>
            <label className="field">
              本地上传兜底
              <input ref={fileRef} type="file" accept="video/*" multiple />
            </label>
            <div className="footer-actions">
              <button type="button" onClick={() => setShowIngest(false)}>
                取消
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void onIngest()}>
                开始处理
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCookies ? (
        <div className="modal-mask">
          <div className="modal">
            <h2>平台 Cookie</h2>
            <p className="hint">存本机 api/data/studio_cookies.json，不进 Git。用于 yt-dlp 拉高清。</p>
            {(['douyin', 'bilibili', 'youtube'] as const).map((k) => (
              <label key={k} className="field">
                {k}
                <textarea
                  rows={3}
                  value={cookies[k]}
                  onChange={(e) => setCookies({ ...cookies, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="footer-actions">
              <button type="button" onClick={() => setShowCookies(false)}>
                关闭
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void saveStudioCookies(cookies)
                    .then(() => {
                      setNotice('Cookie 已保存')
                      setShowCookies(false)
                    })
                    .catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : '保存失败'),
                    )
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
