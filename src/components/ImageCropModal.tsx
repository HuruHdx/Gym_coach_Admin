import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import './ImageCropModal.css'

type Props = {
  file: File
  title?: string
  onCancel: () => void
  onConfirm: (file: File) => void
}

async function cropToFile(imageSrc: string, area: Area, fileName: string): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  const size = Math.max(1, Math.round(Math.min(area.width, area.height)))
  const out = Math.min(1024, size)
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    out,
    out,
  )
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('裁剪失败'))),
      'image/jpeg',
      0.9,
    )
  })
  const base = fileName.replace(/\.[^.]+$/, '') || 'crop'
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
}

export function ImageCropModal({ file, title = '裁剪素材', onCancel, onConfirm }: Props) {
  const [zoom, setZoom] = useState(1)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const src = URL.createObjectURL(file)

  const onCropComplete = useCallback((_: Area, cropped: Area) => {
    setArea(cropped)
  }, [])

  async function confirm() {
    if (!area) return
    setBusy(true)
    setError('')
    try {
      const next = await cropToFile(src, area, file.name)
      URL.revokeObjectURL(src)
      onConfirm(next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '裁剪失败')
      setBusy(false)
    }
  }

  function cancel() {
    URL.revokeObjectURL(src)
    onCancel()
  }

  return (
    <div className="crop-modal" role="dialog" aria-modal="true">
      <div className="crop-card">
        <div className="crop-head">
          <strong>{title}</strong>
          <span>拖动/缩放选区，输出 1:1</span>
        </div>
        <div className="crop-stage">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
            showGrid
          />
        </div>
        <label className="crop-zoom">
          缩放
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        {error ? <div className="crop-error">{error}</div> : null}
        <div className="crop-actions">
          <button type="button" className="ghost" onClick={cancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="primary" onClick={confirm} disabled={busy || !area}>
            {busy ? '处理中…' : '确认裁剪并上传'}
          </button>
        </div>
      </div>
    </div>
  )
}
