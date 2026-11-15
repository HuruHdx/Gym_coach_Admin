type Props = {
  eyebrow: string
  title: string
  note: string
}

export function PlaceholderPage({ eyebrow, title, note }: Props) {
  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--accent-text)', fontSize: 'var(--fs-label)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        {eyebrow}
      </div>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-display)', letterSpacing: '-0.04em' }}>
        {title}
      </h1>
      <p style={{ marginTop: 12, color: 'var(--text-2)', fontSize: 'var(--fs-meta)' }}>{note}</p>
      <div
        style={{
          marginTop: 24,
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: 24,
          color: 'var(--text-3)',
          fontSize: 'var(--fs-meta)',
        }}
      >
        路由占位 · A0 仅壳子，本页功能在后续阶段实现。
      </div>
    </div>
  )
}
