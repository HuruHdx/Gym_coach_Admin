const KEY = 'gym-admin:exercises-return'
const SCROLL_KEY = 'gym-admin:exercises-scroll'

export function rememberExercisesReturn(search: string, scrollTop = 0) {
  const path = search ? `/exercises?${search.replace(/^\?/, '')}` : '/exercises'
  sessionStorage.setItem(KEY, path)
  sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.floor(scrollTop))))
}

export function peekExercisesReturn(): string {
  return sessionStorage.getItem(KEY) || '/exercises'
}

export function takeExercisesScroll(): number {
  const raw = sessionStorage.getItem(SCROLL_KEY)
  sessionStorage.removeItem(SCROLL_KEY)
  const n = Number(raw || 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}
