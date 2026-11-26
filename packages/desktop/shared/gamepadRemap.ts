export const REMAPPABLE_BUTTONS = [
    'A',
    'B',
    'X',
    'Y',
    'LeftShoulder',
    'RightShoulder',
    'LeftTrigger',
    'RightTrigger',
    'View',
    'Menu',
    'LeftThumb',
    'RightThumb',
    'DPadUp',
    'DPadDown',
    'DPadLeft',
    'DPadRight',
] as const

export type RemappableButton = typeof REMAPPABLE_BUTTONS[number]
export type GamepadButtonMap = Partial<Record<RemappableButton, RemappableButton>>

const VALID_BUTTONS = new Set<string>(REMAPPABLE_BUTTONS)

export function isRemappableButton(value: unknown): value is RemappableButton {
    return typeof value === 'string' && VALID_BUTTONS.has(value)
}

export function sanitizeButtonRemap(raw: unknown): GamepadButtonMap {
    const clean: GamepadButtonMap = {}
    if (!raw || typeof raw !== 'object') {
        return clean
    }
    for (const [source, target] of Object.entries(raw as Record<string, unknown>)) {
        if (isRemappableButton(source) && isRemappableButton(target) && source !== target) {
            clean[source] = target
        }
    }
    return clean
}

// Applies a source -> target button remap on top of a mapped Xbox InputFrame state.
// Uses a snapshot of original values so swaps (e.g. A <-> B) never clobber each other,
// and combines multiple physical buttons targeting the same virtual button via Math.max.
export function applyButtonRemap<T extends Record<string, any>>(state: T, remap: GamepadButtonMap): T {
    const entries = Object.entries(remap)
    if (entries.length === 0) {
        return state
    }

    const original: Record<string, number> = {}
    for (const btn of REMAPPABLE_BUTTONS) {
        original[btn] = typeof state[btn] === 'number' ? state[btn] : 0
    }

    const remapped: Record<string, any> = { ...state }
    for (const btn of REMAPPABLE_BUTTONS) {
        remapped[btn] = 0
    }

    for (const btn of REMAPPABLE_BUTTONS) {
        const target = remap[btn] ?? btn
        const val = original[btn]
        if (val > remapped[target]) {
            remapped[target] = val
        }
    }

    return remapped as T
}
