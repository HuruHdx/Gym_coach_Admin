import type { ReactNode } from 'react'
import { Spinner } from './Spinner'
import './feedback.css'

type Kind = 'loading' | 'empty' | 'error'

type Props = {
  kind: Kind
  title?: string
  desc?: ReactNode
  action?: ReactNode
  className?: string
}

const DEFAULTS: Record<Kind, string> = {
  loading: '加载中…',
  empty: '暂无内容',
  error: '出了点问题',
}

/** 页面 / 列表区的加载、空态、错误占位 */
export function PageState({ kind, title, desc, action, className = '' }: Props) {
  return (
    <div className={`fb-page-state ${kind} ${className}`.trim()} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' ? <Spinner size={18} /> : null}
      <strong>{title || DEFAULTS[kind]}</strong>
      {desc ? <span className="fb-page-desc">{desc}</span> : null}
      {action ? <div className="fb-page-action">{action}</div> : null}
    </div>
  )
}
