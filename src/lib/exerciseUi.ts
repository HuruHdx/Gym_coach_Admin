export const MUSCLES = ['胸', '背', '肩', '腿', '臂', '核心', '全身'] as const

export const SUB_REGIONS: Record<string, string[]> = {
  胸: ['上胸', '中胸', '下胸', '胸中缝/内侧', '胸部整体'],
  背: ['背阔肌/背宽', '中上背/背厚', '下背/竖脊肌', '斜方肌'],
  肩: ['肩前束', '肩中束', '肩后束', '肩袖/稳定', '肩部整体'],
  腿: ['股四头肌(前侧)', '腘绳肌(后侧)', '臀部', '内收/外展肌', '小腿', '腿部整体'],
  臂: ['肱二头肌', '肱三头肌', '前臂'],
  核心: ['上腹/腹直肌', '下腹', '腹斜肌(侧腹)', '核心抗旋/稳定'],
  全身: ['心肺有氧', '全身爆发/HIIT', '全身拉伸/灵活'],
}

export const MOVEMENT_PATTERNS = [
  '水平推',
  '垂直推',
  '水平拉',
  '垂直拉',
  '膝主导(蹲)',
  '髋主导(铰链)',
  '肘屈伸(弯举/臂屈伸)',
  '肩孤立(平举)',
  '核心卷曲/稳定',
  '全身心肺/综合',
  '拉伸/灵活',
] as const

export const GEARS = ['自由重量', '器械', '绳索', '自重'] as const

export const MODALITIES = ['抗阻', '有氧', 'HIIT', '灵活性'] as const

export const JOINT_KEYS = ['waist', 'knee', 'shoulder', 'wrist', 'elbow'] as const

export const MEDIA_STATES = [
  { value: 'complete', label: '槽位完整' },
  { value: 'has_dynamic', label: '有动态素材' },
  { value: 'frames_only', label: '仅起止图' },
  { value: 'none', label: '无素材' },
] as const

export const ROLE_LABELS: Record<string, string> = {
  start: '起始',
  end: '结束',
  demo: '动图',
  highlight_video: '高光',
  tip: '纠错',
}

export const ROLE_KEYS = ['start', 'end', 'demo', 'highlight_video', 'tip'] as const

/** 计划槽位角色（写 Exercise.slot_roles，勿与肌群 roles 混淆） */
export const PLAN_SLOT_ROLES = [
  { value: 'main', label: '主项' },
  { value: 'assist', label: '辅助' },
  { value: 'isolation', label: '孤立' },
  { value: 'warmup', label: '热身' },
] as const

export const PLAN_GEAR_TAGS = [
  '杠铃',
  '哑铃',
  '壶铃',
  '绳索',
  '史密斯',
  '固定器械',
  '自重',
  '弹力带',
] as const

export const JOINT_LABELS: Record<string, string> = {
  waist: '腰',
  knee: '膝',
  shoulder: '肩',
  wrist: '腕',
  elbow: '肘',
}

export const LEVEL_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

export function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} min`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} h`
  const day = Math.floor(hour / 24)
  if (day < 7) return day === 1 ? '昨天' : `${day} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export function mediaStateLabel(state: string): string {
  return MEDIA_STATES.find((item) => item.value === state)?.label || state
}

export function parseBoolParam(value: string | null): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** 靶区可多选，入库用顿号拼接，例如「肩中束、肩后束」 */
export function parseSubRegions(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[、,/，|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function joinSubRegions(values: string[]): string {
  return values.filter(Boolean).join('、')
}

export function toggleSubRegion(current: string, option: string): string {
  const selected = parseSubRegions(current)
  const next = selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option]
  return joinSubRegions(next)
}
