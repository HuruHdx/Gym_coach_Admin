import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { loginAdmin } from '../lib/api'
import { isAuthed, setSession } from '../lib/auth'
import './LoginPage.css'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthed()) {
    return <Navigate to="/dashboard" replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await loginAdmin(username.trim() || 'admin', password)
      setSession(result.access_token, result.username)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login">
      <section className="brand-side">
        <div className="top-brand">
          <span className="mark">GC</span>
          <span>GymCoach · Asset OS</span>
        </div>
        <div className="hero">
          <div className="eyebrow">Content Engineering Console</div>
          <h1>把每个动作，打磨成标准资产。</h1>
          <p className="lead">
            管理动作 SKU、多模态素材、训练教案与 AI 反馈，让每一次内容更新即时抵达训练现场。
          </p>
        </div>
        <div className="signal">
          <span>
            <i />
            API 正常
          </span>
          <span>
            <i />
            媒体流水线在线
          </span>
          <span className="num">v0.9.2</span>
        </div>
      </section>
      <section className="form-side">
        <form className="form-wrap" onSubmit={onSubmit}>
          <div className="form-kicker">Authorized Access</div>
          <h2>进入工作台</h2>
          <p className="form-sub">仅限 GymCoach 内容与运营成员</p>
          <div className="field">
            <label htmlFor="account">账号</label>
            <input
              id="account"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="默认与 APP_TOKEN 相同（dev-token）"
            />
          </div>
          <div className="form-meta">
            <span>保持登录 7 天</span>
            <span>无注册入口</span>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary" type="submit" disabled={loading || !password}>
            {loading ? '登录中…' : '安全登录 →'}
          </button>
          <div className="security">
            登录行为将记录到审计日志
            <br />
            生产环境建议启用 TOTP 二次验证
          </div>
        </form>
      </section>
    </main>
  )
}
