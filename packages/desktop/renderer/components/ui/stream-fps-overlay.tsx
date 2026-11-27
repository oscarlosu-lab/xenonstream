import React from 'react'
import type { StreamHudMetrics } from '../../lib/streamStats'

export interface FpsOverlayPosition {
    x: number
    y: number
}

export const DEFAULT_FPS_OVERLAY_POS: FpsOverlayPosition = { x: 16, y: 78 }

export function clampOverlayPosition(
    pos: FpsOverlayPosition,
    viewportWidth: number,
    viewportHeight: number,
    elementWidth = 140,
    elementHeight = 44,
): FpsOverlayPosition {
    const maxX = Math.max(0, viewportWidth - elementWidth)
    const maxY = Math.max(0, viewportHeight - elementHeight)
    return {
        x: Math.round(Math.min(Math.max(0, pos.x), maxX)),
        y: Math.round(Math.min(Math.max(0, pos.y), maxY)),
    }
}

interface StreamFpsOverlayProps {
    metrics?: StreamHudMetrics
    position?: FpsOverlayPosition
    onPositionChange?: (pos: FpsOverlayPosition) => void
}

function clampToCurrentViewport(pos: FpsOverlayPosition): FpsOverlayPosition {
    if (typeof window === 'undefined') {
        return pos
    }
    return clampOverlayPosition(pos, window.innerWidth, window.innerHeight)
}

export default function StreamFpsOverlay({ metrics, position, onPositionChange }: StreamFpsOverlayProps) {
    const fpsText = metrics ? `${metrics.fps}FPS` : '--FPS'
    const initial = clampToCurrentViewport(
        position && typeof position.x === 'number' && typeof position.y === 'number'
            ? position
            : DEFAULT_FPS_OVERLAY_POS,
    )

    const [coords, setCoords] = React.useState<FpsOverlayPosition>(initial)
    const [dragging, setDragging] = React.useState(false)
    const dragRef = React.useRef<{
        active: boolean
        pointerId: number
        offsetX: number
        offsetY: number
        width: number
        height: number
    } | null>(null)
    const coordsRef = React.useRef(coords)
    coordsRef.current = coords

    React.useEffect(() => {
        if (position && typeof position.x === 'number' && typeof position.y === 'number' && !dragRef.current?.active) {
            setCoords(clampToCurrentViewport(position))
        }
    }, [position?.x, position?.y])

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }
        const handleResize = () => {
            if (dragRef.current?.active) {
                return
            }
            setCoords(prev => {
                const next = clampToCurrentViewport(prev)
                if (next.x === prev.x && next.y === prev.y) {
                    return prev
                }
                coordsRef.current = next
                return next
            })
        }
        window.addEventListener('resize', handleResize)
        return () => {
            window.removeEventListener('resize', handleResize)
        }
    }, [])

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
            return
        }
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        dragRef.current = {
            active: true,
            pointerId: e.pointerId,
            offsetX: e.clientX - coordsRef.current.x,
            offsetY: e.clientY - coordsRef.current.y,
            width: rect.width || 140,
            height: rect.height || 44,
        }
        setDragging(true)
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
            // Ignore if pointer capture is unsupported
        }
    }

    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current
        if (!drag || !drag.active || drag.pointerId !== e.pointerId) {
            return
        }
        e.stopPropagation()
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
        const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
        const next = clampOverlayPosition(
            { x: e.clientX - drag.offsetX, y: e.clientY - drag.offsetY },
            vw,
            vh,
            drag.width,
            drag.height,
        )
        coordsRef.current = next
        setCoords(next)
    }

    function finishDrag(e: React.PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current
        if (!drag || !drag.active || drag.pointerId !== e.pointerId) {
            return
        }
        e.stopPropagation()
        dragRef.current = null
        setDragging(false)
        try {
            if (typeof e.currentTarget.hasPointerCapture === 'function' && e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
            }
        } catch {
            // Ignore if already released
        }
        onPositionChange?.(coordsRef.current)
    }

    return (
        <div
            id="component_streamcomponent_fps_overlay"
            aria-hidden="true"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            style={{
                position: 'fixed',
                top: coords.y,
                left: coords.x,
                zIndex: 100,
                pointerEvents: 'auto',
                touchAction: 'none',
                userSelect: 'none',
                cursor: dragging ? 'grabbing' : 'grab',
                color: '#4ade80',
                textShadow: '0 2px 6px rgba(0, 0, 0, 0.9)',
                fontFamily: 'Consolas, "Cascadia Mono", monospace',
                fontSize: 36,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
            }}
        >
            {fpsText}
        </div>
    )
}
