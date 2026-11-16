import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import { fetchAdminHealth, type AdminHealth } from '../lib/api'
import { clearSession, getUsername } from '../lib/auth'
import './AdminShell.css'

const NAV = [
  { to: '/dashboard', label: '资产大盘' },
  { to: '/exercises', label: '动作 SKU' },
  { to: '/plans', label: '计划模板' },
  { to: '/media-pool', label: '媒体池' },
  { to: '/video-studio', label: '高光切片台' },
  { to: '/ai-ops', label: 'AI Ops' },
]

export function AdminShell() {
  const navigate = useNavigate()
  const [health, setHealth] = useState<AdminHealth | null>(null)
  const [healthError, setHealthError] = useState('')
  const [search, setSearch] = useState('')
  const username = getUsername() || 'admin'

  useEffect(() => {
    let alive = true
    fetchAdminHealth()
      .then((data) => {
        if (alive) setHealth(data)
      })
      .catch((err: unknown) => {
        if (alive) setHealthError(err instanceof Error ? err.message : 'health 失败')
      })
    return () => {
      alive = false
    }
  }, [])

  function logout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  function onSearch(event: FormEvent) {
    event.preventDefault()
    const q = search.trim()
    navigate(q ? `/exercises?q=${encodeURIComponent(q)}` : '/exercises')
  }

  return (
    <div className="app-shell">
      <aside className="side">
        <div className="brand">
          <span className="mark">GC</span>
          <span>
            GymCoach
            <small>ASSET OS</small>
          </span>
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'on' : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-status">
          {healthError ? (
            <span className="bad">● health 异常 · {healthError}</span>
          ) : health ? (
            <span className="ok">
              ● 系统正常 · <span className="num">{health.exercises.toLocaleString()}</span> SKU
            </span>
          ) : (
            <span>● 连接 API…</span>
          )}
        </div>
      </aside>
      <section className="workspace">
        <header className="top">
          <form className="global-search" onSubmit={onSearch}>
            <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                d="M16.5 16.5 21 21"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索动作、别名或 ID…"
            />
          </form>
          <div className="operator">
            <span className="num">
              {health
                ? `${health.coach_core} 主力 · ${health.with_image_start} 有起势图`
                : '同步中'}
            </span>
            <button type="button" className="avatar" onClick={logout} title="退出登录">
              {username.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <div className="view-host">
          <Outlet />
        </div>
      </section>
    </div>
  )
}
