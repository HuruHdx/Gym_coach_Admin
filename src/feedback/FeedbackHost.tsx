import { useSyncExternalStore } from 'react'
import { getFeedbackSnapshot, loading, subscribeFeedback, toast } from './store'
import { Spinner } from './Spinner'
import './feedback.css'

export function FeedbackHost() {
  const snap = useSyncExternalStore(subscribeFeedback, getFeedbackSnapshot, getFeedbackSnapshot)

  return (
    <>
      <div className="fb-toast-host" aria-live="polite" aria-relevant="additions">
        {snap.toasts.map((t) => (
          <div key={t.id} className={`fb-toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button type="button" className="fb-toast-x" onClick={() => toast.dismiss(t.id)} aria-label="关闭">
              ✕
            </button>
          </div>
        ))}
      </div>

      {snap.loading ? (
        <div className="fb-loading-mask" role="status" aria-live="assertive" aria-busy="true">
          <div className="fb-loading-card">
            <Spinner size={20} />
            <span>{snap.loadingText}</span>
            <button type="button" className="fb-toast-x" onClick={() => loading.hide()} aria-label="关闭遮罩">
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
