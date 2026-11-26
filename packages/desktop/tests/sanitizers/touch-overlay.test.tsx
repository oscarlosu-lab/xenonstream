import { defaultSettings } from '../../renderer/context/userContext.defaults'
import TouchOverlay, { createEmptyTouchFrame, hasPhysicalGamepadConnected } from '../../renderer/components/ui/touchoverlay'
import { createHookHarness } from './testhelper'

describe('TouchOverlay opt-in, gamepad contention, and listener/timer cleanup', () => {
    const origWindow = (global as any).window
    const origNavigator = (global as any).navigator

    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
        Object.defineProperty(global, 'window', { configurable: true, value: origWindow })
        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
    })

    test('input_touch is disabled by default (opt-in)', () => {
        expect(defaultSettings.input_touch).toBe(false)
        expect(defaultSettings.touch_layout_preset).toBe('standard')
    })

    test('hasPhysicalGamepadConnected ignores <4-button HIDs and detects real controllers', () => {
        const fakeButtons = (n: number) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }))
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: {
                getGamepads: jest.fn(() => [
                    null,
                    { id: 'USB Headset', connected: true, buttons: fakeButtons(2), axes: [] },
                ]),
            },
        })
        expect(hasPhysicalGamepadConnected()).toBe(false)

        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: {
                getGamepads: jest.fn(() => [
                    { id: 'Xbox Controller', connected: true, buttons: fakeButtons(17), axes: [0, 0, 0, 0] },
                ]),
            },
        })
        expect(hasPhysicalGamepadConnected()).toBe(true)
    })

    test('skips dispatch while physical controller is connected, sends release frame and cleans blur listener + timer on unmount', () => {
        const harness = createHookHarness()
        const addListener = jest.fn()
        const removeListener = jest.fn()
        let pads: any[] = []

        Object.defineProperty(global, 'window', {
            configurable: true,
            value: { addEventListener: addListener, removeEventListener: removeListener },
        })
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: { getGamepads: jest.fn(() => pads) },
        })

        const queueGamepadState = jest.fn()
        const mockPlayer = {
            getChannelProcessor: () => ({ queueGamepadState }),
        }

        const mounted = harness.mount(TouchOverlay, { xPlayer: mockPlayer, preset: 'standard' })

        expect(addListener).toHaveBeenCalledWith('blur', expect.any(Function))
        expect(jest.getTimerCount()).toBe(1)

        // No physical gamepad: dispatches touch frames
        jest.advanceTimersByTime(32)
        expect(queueGamepadState).toHaveBeenCalledTimes(2)

        // Physical gamepad plugged in: suppresses touch frames (zero double input)
        pads = [{ id: 'Xbox Controller', connected: true, buttons: new Array(17).fill({ pressed: false, value: 0 }) }]
        jest.advanceTimersByTime(48)
        expect(queueGamepadState).toHaveBeenCalledTimes(2)

        // Unplug physical gamepad and unmount: sends final zeroed release frame, clears interval, removes blur listener
        pads = []
        mounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
        expect(removeListener).toHaveBeenCalledWith('blur', expect.any(Function))
        expect(queueGamepadState).toHaveBeenLastCalledWith(createEmptyTouchFrame())

        harness.dispose()
    })
})
