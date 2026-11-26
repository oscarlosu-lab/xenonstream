import React from 'react'
import { getTouchLayoutPreset, InputFrameKey, TouchControl, ZoneName } from '../../../lib/touchLayouts'
import { getStickAxes, getDpadDirection } from '../../../lib/touchGestures'

interface TouchOverlayProps {
    xPlayer: any
    preset: string
}

const ZONES: ZoneName[] = ['left-inner', 'left-outer', 'right-inner', 'right-outer', 'top-right']

export function createEmptyTouchFrame() {
    return {
        GamepadIndex: 0,
        Nexus: 0, Menu: 0, View: 0,
        A: 0, B: 0, X: 0, Y: 0,
        DPadUp: 0, DPadDown: 0, DPadLeft: 0, DPadRight: 0,
        LeftShoulder: 0, RightShoulder: 0,
        LeftThumb: 0, RightThumb: 0,
        LeftThumbXAxis: 0, LeftThumbYAxis: 0,
        RightThumbXAxis: 0, RightThumbYAxis: 0,
        LeftTrigger: 0, RightTrigger: 0,
    }
}

// Match CompactGamepadDriver's physical gamepad criterion (connected with >=4 buttons)
// so a USB headset/volume HID does not falsely block touch input, while any real
// physical controller (single-player or local co-op) suppresses touch frames to
// prevent double-input contention on slot 0.
export function hasPhysicalGamepadConnected(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
        return false
    }
    const pads = navigator.getGamepads()
    if (!pads) {
        return false
    }
    for (let i = 0; i < pads.length; i++) {
        const g = pads[i]
        if (g && g.connected && Array.isArray(g.buttons) && g.buttons.length >= 4) {
            return true
        }
    }
    return false
}

function safeReleasePointerCapture(target: EventTarget & HTMLElement, pointerId: number) {
    try {
        if (typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId)
        }
    } catch {
        // Ignore if pointer capture was already released by the browser
    }
}

function TouchOverlay({ xPlayer, preset }: TouchOverlayProps) {
    const frameRef = React.useRef(createEmptyTouchFrame())
    const layout = getTouchLayoutPreset(preset)

    React.useEffect(() => {
        const resetFrame = () => {
            frameRef.current = createEmptyTouchFrame()
        }

        const interval = setInterval(() => {
            if (hasPhysicalGamepadConnected()) {
                return
            }
            xPlayer?.getChannelProcessor('input')?.queueGamepadState({ ...frameRef.current })
        }, 16)

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('blur', resetFrame)
        }

        return () => {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('blur', resetFrame)
            }
            resetFrame()
            if (!hasPhysicalGamepadConnected()) {
                xPlayer?.getChannelProcessor('input')?.queueGamepadState(createEmptyTouchFrame())
            }
            clearInterval(interval)
        }
    }, [xPlayer])

    function handleButtonStart(input: InputFrameKey) {
        frameRef.current[input] = 1
    }

    function handleButtonEnd(input: InputFrameKey) {
        frameRef.current[input] = 0
    }

    function handleStickMove(side: 'left' | 'right', e: React.PointerEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const { x, y } = getStickAxes(centerX, centerY, e.clientX, e.clientY, rect.width / 2)

        if (side === 'left') {
            frameRef.current.LeftThumbXAxis = x
            frameRef.current.LeftThumbYAxis = y
        } else {
            frameRef.current.RightThumbXAxis = x
            frameRef.current.RightThumbYAxis = y
        }
    }

    function handleStickEnd(side: 'left' | 'right') {
        if (side === 'left') {
            frameRef.current.LeftThumbXAxis = 0
            frameRef.current.LeftThumbYAxis = 0
        } else {
            frameRef.current.RightThumbXAxis = 0
            frameRef.current.RightThumbYAxis = 0
        }
    }

    function handleDpadMove(e: React.PointerEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const direction = getDpadDirection(centerX, centerY, e.clientX, e.clientY)

        frameRef.current.DPadUp = direction.up ? 1 : 0
        frameRef.current.DPadDown = direction.down ? 1 : 0
        frameRef.current.DPadLeft = direction.left ? 1 : 0
        frameRef.current.DPadRight = direction.right ? 1 : 0
    }

    function handleDpadEnd() {
        frameRef.current.DPadUp = 0
        frameRef.current.DPadDown = 0
        frameRef.current.DPadLeft = 0
        frameRef.current.DPadRight = 0
    }

    function renderControl(control: TouchControl, key: string) {
        if (control.type === 'stick') {
            const side = control.input
            return (
                <div
                    key={key}
                    className='touch-control touch-stick'
                    title={control.label}
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleStickMove(side, e) }}
                    onPointerMove={(e) => { if (e.buttons > 0) handleStickMove(side, e) }}
                    onPointerUp={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleStickEnd(side) }}
                    onPointerCancel={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleStickEnd(side) }}
                ><div className='touch-stick-nub'></div></div>
            )
        }

        if (control.type === 'dpad') {
            return (
                <div
                    key={key}
                    className='touch-control touch-dpad'
                    title={control.label}
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleDpadMove(e) }}
                    onPointerMove={(e) => { if (e.buttons > 0) handleDpadMove(e) }}
                    onPointerUp={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleDpadEnd() }}
                    onPointerCancel={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleDpadEnd() }}
                ><i className='fa-solid fa-arrows-up-down-left-right'></i></div>
            )
        }

        return (
            <div
                key={key}
                className='touch-control touch-button'
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleButtonStart(control.input) }}
                onPointerUp={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleButtonEnd(control.input) }}
                onPointerCancel={(e) => { safeReleasePointerCapture(e.currentTarget, e.pointerId); handleButtonEnd(control.input) }}
            >{control.label}</div>
        )
    }

    return (
        <div className='touch-overlay'>
            {ZONES.map((zone) => (
                <div key={zone} className={'touch-zone touch-zone-' + zone}>
                    {(layout[zone] || []).map((control, i) => renderControl(control, zone + '-' + i))}
                </div>
            ))}
        </div>
    )
}

export default TouchOverlay
