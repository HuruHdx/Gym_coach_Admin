import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/AdminShell'
import { isAuthed } from './lib/auth'
import { DashboardPage } from './pages/DashboardPage'
import { ExerciseDetailPage } from './pages/ExerciseDetailPage'
import { ExercisesPage } from './pages/ExercisesPage'
import { LoginPage } from './pages/LoginPage'
import { MediaPoolPage } from './pages/MediaPoolPage'
import { PlanDetailPage } from './pages/PlanDetailPage'
import { PlansPage } from './pages/PlansPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

function RequireAuth() {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AdminShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
          <Route path="/exercises/:id" element={<ExerciseDetailPage />} />
          <Route path="/media-pool" element={<MediaPoolPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlanDetailPage />} />
          <Route
            path="/video-studio"
            element={
              <PlaceholderPage
                eyebrow="Video Intelligence"
                title="高光切片工作台"
                note="A4：本地视频 → 字幕 → 高光切片。"
              />
            }
          />
          <Route
            path="/ai-ops"
            element={
              <PlaceholderPage
                eyebrow="AI Operations"
                title="未命中与反馈追踪"
                note="A5：未命中聚合与别名绑定。"
              />
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
