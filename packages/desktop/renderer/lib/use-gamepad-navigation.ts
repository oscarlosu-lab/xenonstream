import { useEffect } from 'react'

type Direction = 'up' | 'down' | 'left' | 'right'
type NavigationInput = Direction | 'activate'

const focusable = 'a[href], button, input, select, textarea, [tabindex]'
const focusMarker = 'data-gamepad-focus'
const stickThreshold = 0.6

function readInput(gamepad: Gamepad): NavigationInput | undefined {
    if (gamepad.buttons[0]?.pressed) return 'activate'
    if (gamepad.buttons[12]?.pressed) return 'up'
    if (gamepad.buttons[13]?.pressed) return 'down'
    if (gamepad.buttons[14]?.pressed) return 'left'
    if (gamepad.buttons[15]?.pressed) return 'right'

    const [x = 0, y = 0] = gamepad.axes
    if (Math.abs(x) > Math.abs(y) && Math.abs(x) >= stickThreshold) {
        return x < 0 ? 'left' : 'right'
    }
    if (Math.abs(y) >= stickThreshold) return y < 0 ? 'up' : 'down'
}

function elementsInMenu(): HTMLElement[] {
    const scope = document.querySelector('[role="dialog"][aria-modal="true"]') ?? document
    return Array.from(scope.querySelectorAll<HTMLElement>(focusable)).filter(element =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled, [aria-disabled="true"]') &&
        !element.closest('[inert], [aria-hidden="true"]') &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === 'visible')
}

function closestInDirection(from: HTMLElement, elements: HTMLElement[], direction: Direction) {
    const origin = from.getBoundingClientRect()
    const horizontal = direction === 'left' || direction === 'right'
    const sign = direction === 'left' || direction === 'up' ? -1 : 1
    let closest: HTMLElement | undefined
    let best = Infinity

    for (const element of elements) {
        if (element === from) continue
        const rect = element.getBoundingClientRect()
        const dx = rect.left + rect.width / 2 - (origin.left + origin.width / 2)
        const dy = rect.top + rect.height / 2 - (origin.top + origin.height / 2)
        const forward = (horizontal ? dx : dy) * sign
        const side = Math.abs(horizontal ? dy : dx)
        const score = forward + 3 * side
        if (forward > 1 && score < best) {
            closest = element
            best = score
        }
    }

    return closest
}

export default function useGamepadNavigation(enabled: boolean) {
    useEffect(() => {
        if (!enabled || !navigator.getGamepads) return

        let previous: NavigationInput | undefined
        let nextRepeat = 0
        let marked: HTMLElement | undefined

        function clearMarker() {
            marked?.removeAttribute(focusMarker)
            marked = undefined
        }

        function focus(element: HTMLElement) {
            clearMarker()
            element.focus({ preventScroll: true })
            element.setAttribute(focusMarker, '')
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            marked = element
        }

        function poll() {
            if (document.hidden || !document.hasFocus()) {
                previous = undefined
                return
            }

            let input: NavigationInput | undefined
            for (const gamepad of navigator.getGamepads()) {
                if (!gamepad?.connected || (gamepad.mapping !== 'standard' && gamepad.buttons.length < 16)) continue
                input = readInput(gamepad)
                if (input) break
            }

            const now = performance.now()
            const firstPress = input !== previous
            previous = input
            if (!input || (!firstPress && (input === 'activate' || now < nextRepeat))) return
            nextRepeat = now + (firstPress ? 340 : 115)

            const items = elementsInMenu()
            const current = items.find(element => element === document.activeElement)
            if (!current) {
                if (items[0]) focus(items[0])
            } else if (input === 'activate') {
                current.click()
            } else {
                const next = closestInDirection(current, items, input)
                if (next) focus(next)
            }
        }

        const timer = window.setInterval(poll, 32)
        window.addEventListener('pointerdown', clearMarker)
        window.addEventListener('keydown', clearMarker)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('pointerdown', clearMarker)
            window.removeEventListener('keydown', clearMarker)
            clearMarker()
        }
    }, [enabled])
}
