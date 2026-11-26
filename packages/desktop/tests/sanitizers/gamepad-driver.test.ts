import CompactGamepadDriver from '../../renderer/lib/gamepaddriver'
import { applyButtonRemap, sanitizeButtonRemap } from '../../shared/gamepadRemap'

describe('CompactGamepadDriver sanitizers', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('stop() cancels the 60Hz run loop and active-gamepad polling interval leaving 0 timers', () => {
        const origWindow = (global as any).window
        const origNavigator = (global as any).navigator
        const addListener = jest.fn()
        const removeListener = jest.fn()
        Object.defineProperty(global, 'window', {
            configurable: true,
            value: { addEventListener: addListener, removeEventListener: removeListener },
        })
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: { getGamepads: jest.fn(() => []) },
        })

        const driver = new CompactGamepadDriver()
        driver.setApplication({
            getChannelProcessor: () => ({
                _inputFps: { count: jest.fn() },
                queueGamepadStates: jest.fn(),
                sendGamepadAdded: jest.fn(),
                sendGamepadRemoved: jest.fn(),
                onMessage: jest.fn(),
            }),
        } as any)

        driver.start()
        driver.run()
        expect(jest.getTimerCount()).toBeGreaterThan(0)

        driver.stop()
        expect(jest.getTimerCount()).toBe(0)
        expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function))
        expect(removeListener).toHaveBeenCalledWith('keyup', expect.any(Function))

        Object.defineProperty(global, 'window', { configurable: true, value: origWindow })
        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
    })

    test('connectedGamepads() compacts empty slots, drops <4-button HIDs, and prioritizes standard controllers first', () => {
        const origNavigator = (global as any).navigator
        const fakeButtons = (n: number) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }))
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: {
                getGamepads: jest.fn(() => [
                    null,
                    { id: 'Headset HID', connected: true, mapping: '', buttons: fakeButtons(2), axes: [] },
                    { id: 'Wheel HID', connected: true, mapping: '', buttons: fakeButtons(8), axes: [0] },
                    { id: 'Xbox Wireless Controller', connected: true, mapping: 'standard', buttons: fakeButtons(17), axes: [0, 0, 0, 0] },
                ]),
            },
        })

        const driver = new CompactGamepadDriver()
        const ordered = driver.connectedGamepads()
        expect(ordered.map((g) => g.id)).toEqual(['Xbox Wireless Controller', 'Wheel HID'])

        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
    })

    test('localCoopEnabled defaults to false (single controller) and announces controllers 1..3 only when enabled', () => {
        const origWindow = (global as any).window
        const origNavigator = (global as any).navigator
        const fakeButtons = (n: number) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }))
        const twoPads = [
            { id: 'Pad 1', connected: true, mapping: 'standard', buttons: fakeButtons(17), axes: [0, 0, 0, 0] },
            { id: 'Pad 2', connected: true, mapping: 'standard', buttons: fakeButtons(17), axes: [0, 0, 0, 0] },
        ]

        Object.defineProperty(global, 'window', {
            configurable: true,
            value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
        })
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: { getGamepads: jest.fn(() => twoPads) },
        })

        const sendGamepadAdded = jest.fn()
        const sendGamepadRemoved = jest.fn()
        const mockApp: any = {
            getChannelProcessor: () => ({
                _inputFps: { count: jest.fn() },
                queueGamepadStates: jest.fn(),
                sendGamepadAdded,
                sendGamepadRemoved,
                onMessage: jest.fn(),
            }),
        }

        // Default: localCoopEnabled = false
        const singleDriver = new CompactGamepadDriver()
        singleDriver.setApplication(mockApp)
        singleDriver.start()
        jest.advanceTimersByTime(600)
        expect(sendGamepadAdded).not.toHaveBeenCalled()
        expect(singleDriver.requestStates()).toHaveLength(1)
        singleDriver.stop()

        // Opt-in: localCoopEnabled = true
        const coopDriver = new CompactGamepadDriver({ localCoopEnabled: true })
        coopDriver.setApplication(mockApp)
        coopDriver.start()
        jest.advanceTimersByTime(600)
        expect(sendGamepadAdded).toHaveBeenCalledWith(1)
        expect(coopDriver.requestStates()).toHaveLength(2)
        coopDriver.stop()

        expect(jest.getTimerCount()).toBe(0)
        Object.defineProperty(global, 'window', { configurable: true, value: origWindow })
        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
    })

    test('buttonRemap swaps buttons without clobbering, merges many-to-one, sanitizes invalid entries, and applies in requestStates()', () => {
        const origNavigator = (global as any).navigator

        // Sanitizer strips identity mappings and invalid keys/values
        expect(sanitizeButtonRemap({ A: 'B', B: 'A', X: 'X', Evil: 'A', Y: 'NotAButton' })).toEqual({ A: 'B', B: 'A' })

        // Pure swap A <-> B without clobbering
        const swapped = applyButtonRemap({ A: 1, B: 0, X: 0, Y: 0 }, { A: 'B', B: 'A' })
        expect(swapped.A).toBe(0)
        expect(swapped.B).toBe(1)

        // Many-to-one merge (LeftShoulder -> A while A is unpressed)
        const merged = applyButtonRemap({ A: 0, LeftShoulder: 1 }, { LeftShoulder: 'A' })
        expect(merged.A).toBe(1)
        expect(merged.LeftShoulder).toBe(0)

        // End-to-end inside CompactGamepadDriver.requestStates()
        const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })) // button 0 = A
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: {
                getGamepads: jest.fn(() => [
                    { id: 'Xbox Controller', connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] },
                ]),
            },
        })

        const driver = new CompactGamepadDriver({ buttonRemap: { A: 'B', B: 'A' } })
        const states = driver.requestStates()
        expect(states).toHaveLength(1)
        expect(states[0].A).toBe(0)
        expect(states[0].B).toBe(1)

        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
    })
})
