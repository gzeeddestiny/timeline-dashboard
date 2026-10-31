import { useState, useRef, useEffect, useCallback } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus"
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus"
import { avatarBlobFromCanvas } from "../lib/teamAvatar"

/**
 * Simple circular image cropper — drag to pan, scroll/slider to zoom.
 * No external dependencies, uses Canvas API.
 *
 * @param {string} imageSrc — base64 or URL of the image to crop
 * @param {function} onCrop — (croppedBlob) => void
 * @param {function} onCancel — () => void
 */
export default function ImageCropper({ imageSrc, onCrop, onCancel, saving = false }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const stateRef = useRef({ x: 0, y: 0, scale: 1, dragging: false, lastX: 0, lastY: 0 })

  const CANVAS_SIZE = 220
  const OUTPUT_SIZE = 128

  const [zoom, setZoom] = useState(0.26)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")

  const clampPosition = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const state = stateRef.current
    const width = img.width * state.scale
    const height = img.height * state.scale
    state.x = Math.min(0, Math.max(CANVAS_SIZE - width, state.x))
    state.y = Math.min(0, Math.max(CANVAS_SIZE - height, state.y))
  }, [])

  // Load image
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      // Fit image so shorter side fills the circle
      const minDim = Math.min(img.width, img.height)
      const fitScale = CANVAS_SIZE / minDim
      stateRef.current.scale = fitScale
      stateRef.current.x = (CANVAS_SIZE - img.width * fitScale) / 2
      stateRef.current.y = (CANVAS_SIZE - img.height * fitScale) / 2
      setZoom(0)
      setLoaded(true)
    }
    img.onerror = () => setError("เปิดรูปไม่สำเร็จ กรุณาเลือกรูปใหม่")
    img.src = imageSrc
  }, [imageSrc])

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext("2d")
    const s = stateRef.current

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Draw image
    ctx.save()
    ctx.beginPath()
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, s.x, s.y, img.width * s.scale, img.height * s.scale)
    ctx.restore()

    // Circle border
    ctx.beginPath()
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 1, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(147, 51, 234, 0.5)"
    ctx.lineWidth = 2
    ctx.stroke()
  }, [])

  useEffect(() => {
    if (loaded) draw()
  }, [loaded, draw])

  // Pointer drag
  const onPointerDown = (e) => {
    e.preventDefault()
    stateRef.current.dragging = true
    stateRef.current.lastX = e.clientX
    stateRef.current.lastY = e.clientY
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (!stateRef.current.dragging) return
    const dx = e.clientX - stateRef.current.lastX
    const dy = e.clientY - stateRef.current.lastY
    stateRef.current.x += dx
    stateRef.current.y += dy
    stateRef.current.lastX = e.clientX
    stateRef.current.lastY = e.clientY
    clampPosition()
    draw()
  }

  const onPointerUp = () => {
    stateRef.current.dragging = false
  }

  // Zoom with wheel
  const onWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    applyZoom(delta)
  }

  const applyZoom = (delta) => {
    const img = imgRef.current
    if (!img) return
    const s = stateRef.current
    const minDim = Math.min(img.width, img.height)
    const minScale = CANVAS_SIZE / minDim
    const maxScale = (CANVAS_SIZE * 3) / minDim

    const cx = CANVAS_SIZE / 2
    const cy = CANVAS_SIZE / 2

    const oldScale = s.scale
    const newScale = Math.max(minScale, Math.min(maxScale, s.scale + delta * (CANVAS_SIZE / minDim)))

    // Zoom toward center
    s.x = cx - (cx - s.x) * (newScale / oldScale)
    s.y = cy - (cy - s.y) * (newScale / oldScale)
    s.scale = newScale
    clampPosition()
    setZoom((newScale - minScale) / (maxScale - minScale))
    draw()
  }

  // Slider change
  const onSliderChange = (e) => {
    const img = imgRef.current
    if (!img) return
    const minDim = Math.min(img.width, img.height)
    const minScale = CANVAS_SIZE / minDim
    const maxScale = (CANVAS_SIZE * 3) / minDim
    const val = parseFloat(e.target.value)
    const newScale = minScale + (maxScale - minScale) * val

    const s = stateRef.current
    const cx = CANVAS_SIZE / 2
    const cy = CANVAS_SIZE / 2
    const oldScale = s.scale
    s.x = cx - (cx - s.x) * (newScale / oldScale)
    s.y = cy - (cy - s.y) * (newScale / oldScale)
    s.scale = newScale
    clampPosition()
    setZoom(val)
    draw()
  }

  // Crop & output
  const handleCrop = async () => {
    const img = imgRef.current
    if (!img) return
    const s = stateRef.current

    const out = document.createElement("canvas")
    out.width = OUTPUT_SIZE
    out.height = OUTPUT_SIZE
    const ctx = out.getContext("2d")

    // Scale ratio from display to output
    const ratio = OUTPUT_SIZE / CANVAS_SIZE

    ctx.beginPath()
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, s.x * ratio, s.y * ratio, img.width * s.scale * ratio, img.height * s.scale * ratio)

    try {
      setError("")
      await onCrop(await avatarBlobFromCanvas(out))
    } catch (cropError) {
      setError(cropError.message || "สร้างไฟล์รูปไม่สำเร็จ กรุณาเลือกรูปใหม่")
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-alert)] bg-black/45" />
        <Dialog.Popup className="ui-popover ui-modal-enter fixed left-1/2 top-1/2 z-[calc(var(--z-alert)+1)] w-72 -translate-x-1/2 -translate-y-1/2 space-y-4 p-5">
        <Dialog.Title id="crop-photo-title" className="text-center text-sm font-bold text-[var(--ui-text)]">Crop Photo</Dialog.Title>
        {error && <p className="text-center text-xs text-red-600">{error}</p>}

        {/* Canvas */}
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="rounded-full cursor-grab active:cursor-grabbing bg-gray-100"
            style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          />
        </div>

        <p className="text-[10px] text-gray-400 text-center">ลากเพื่อขยับ · เลื่อน slider เพื่อซูม</p>

        {/* Zoom slider */}
        <div className="flex items-center gap-2 px-2">
          <MagnifyingGlassMinusIcon aria-hidden="true" className="shrink-0 text-gray-400" size={16} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={zoom}
            onChange={onSliderChange}
            className="flex-1 h-1.5 accent-purple-500"
          />
          <MagnifyingGlassPlusIcon aria-hidden="true" className="shrink-0 text-gray-400" size={16} />
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="ui-button ui-button-secondary flex-1 px-3 py-2 text-xs font-medium"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCrop}
            disabled={saving || !loaded || Boolean(error)}
            className="ui-button ui-button-primary flex-1 px-3 py-2 text-xs font-semibold"
          >
            {saving ? "กำลังบันทึก…" : "ใช้รูปนี้"}
          </button>
        </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
