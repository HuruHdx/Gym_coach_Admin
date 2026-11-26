import { useMemo, useState, type FormEvent } from 'react'
import { createExercise } from '../lib/api'
import {
  GEARS,
  MODALITIES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  SUB_REGIONS,
  parseSubRegions,
  toggleSubRegion,
} from '../lib/exerciseUi'
import './CreateExerciseModal.css'

type Props = {
  onCancel: () => void
  onCreated: (id: string) => void
  initialNameZh?: string
  initialAliases?: string
}

export function CreateExerciseModal({
  onCancel,
  onCreated,
  initialNameZh = '',
  initialAliases = '',
}: Props) {
  const [nameZh, setNameZh] = useState(initialNameZh)
  const [nameEn, setNameEn] = useState('')
  const [muscle, setMuscle] = useState<string>('胸')
  const [subRegion, setSubRegion] = useState('')
  const [pattern, setPattern] = useState('')
  const [gear, setGear] = useState<string>('自由重量')
  const [modality, setModality] = useState<string>('抗阻')
  const [coachCore, setCoachCore] = useState(false)
  const [aliases, setAliases] = useState(initialAliases)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const subOptions = useMemo(() => SUB_REGIONS[muscle] || [], [muscle])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const name = nameZh.trim()
    if (!name) {
      setError('请填写中文名')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await createExercise({
        name_zh: name,
        name_en: nameEn.trim() || undefined,
        muscle,
        sub_region: subRegion || null,
        movement_pattern: pattern || null,
        gear,
        modality,
        coach_core: coachCore,
        needs_review: true,
        aliases: aliases
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      onCreated(created.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
      setBusy(false)
    }
  }

  return (
    <div className="create-modal" role="dialog" aria-modal="true">
      <form className="create-card" onSubmit={onSubmit}>
        <div className="create-head">
          <strong>新建动作 SKU</strong>
          <span>创建后进入精修台补教案与素材</span>
        </div>

        <div className="create-grid">
          <label>
            中文名 *
            <input
              value={nameZh}
              onChange={(e) => setNameZh(e.target.value)}
              placeholder="例如：上斜哑铃飞鸟"
              autoFocus
            />
          </label>
          <label>
            英文名
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="可选，默认用中文名"
            />
          </label>
          <label>
            部位
            <select
              value={muscle}
              onChange={(e) => {
                setMuscle(e.target.value)
                setSubRegion('')
              }}
            >
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="create-span-2">
            靶区（可多选）
            <div className="create-chips">
              {subOptions.map((s) => {
                const on = parseSubRegions(subRegion).includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    className={`create-chip ${on ? 'on' : ''}`}
                    onClick={() => setSubRegion(toggleSubRegion(subRegion, s))}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <span className="create-hint">
              {subRegion ? `已选：${subRegion}` : '不确定可选「××整体」；中后束可一起勾'}
            </span>
          </label>
          <label>
            动作模式
            <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="">未指定</option>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            器械
            <select value={gear} onChange={(e) => setGear(e.target.value)}>
              {GEARS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            模态
            <select value={modality} onChange={(e) => setModality(e.target.value)}>
              {MODALITIES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            是否主力
            <select
              value={coachCore ? '1' : '0'}
              onChange={(e) => setCoachCore(e.target.value === '1')}
            >
              <option value="0">否 · 普通入库</option>
              <option value="1">是 · 主力</option>
            </select>
          </label>
        </div>

        <label className="create-aliases">
          别名（每行一个，可选）
          <textarea
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="飞鸟&#10;上斜飞鸟"
          />
        </label>

        {error ? <div className="create-error">{error}</div> : null}

        <div className="create-actions">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" className="primary" disabled={busy || !nameZh.trim()}>
            {busy ? '创建中…' : '创建并进入精修'}
          </button>
        </div>
      </form>
    </div>
  )
}
