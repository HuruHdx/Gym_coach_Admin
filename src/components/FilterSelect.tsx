import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './FilterSelect.css'

type Option = { value: string; label: string }

type Props = {
  value: string
  options: Option[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}

type MenuPos = { top: number; left: number; width: number }

export function FilterSelect({
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const selected = options.find((item) => item.value === value)
  const label = selected?.label || placeholder

  function updatePos() {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 160),
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePos()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onReposition() {
      updatePos()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  const menu =
    open && !disabled && pos
      ? createPortal(
          <ul
            className="filter-select-menu"
            id={listId}
            role="listbox"
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <li>
              <button
                type="button"
                className={!value ? 'on' : ''}
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                {placeholder}
              </button>
            </li>
            {options.map((item) => (
              <li key={item.value}>
                <button
                  type="button"
                  className={item.value === value ? 'on' : ''}
                  role="option"
                  aria-selected={item.value === value}
                  onClick={() => {
                    onChange(item.value)
                    setOpen(false)
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null

  return (
    <div className={`filter-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="filter-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? 'has-value' : 'placeholder'}>{label}</span>
        <svg className="caret" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M5 7.5 10 12.5 15 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menu}
    </div>
  )
}
