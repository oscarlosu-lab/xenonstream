import { getTouchLayoutPreset } from '../../lib/touchLayouts'

describe('touchLayouts', () => {
    it('returns non-empty layouts for standard, racing, and minimal presets', () => {
        for (const name of ['standard', 'racing', 'minimal']) {
            const layout = getTouchLayoutPreset(name)
            const allControls = Object.values(layout).flat()
            expect(allControls.length).toBeGreaterThan(0)
        }
    })

    it('standard preset includes full controller parity (sticks, dpad, face buttons, shoulders, triggers, thumbs, menu/view)', () => {
        const standard = getTouchLayoutPreset('standard')
        const allControls = Object.values(standard).flat()
        const inputs = allControls.map((c) => c.input)
        expect(allControls.some((c) => c.type === 'dpad')).toBe(true)
        expect(inputs).toEqual(expect.arrayContaining([
            'left', 'right',
            'A', 'B', 'X', 'Y',
            'LeftShoulder', 'RightShoulder',
            'LeftTrigger', 'RightTrigger',
            'LeftThumb', 'RightThumb',
            'Menu', 'View',
        ]))
    })

    it('falls back to standard preset for unknown names', () => {
        expect(getTouchLayoutPreset('nonexistent')).toEqual(getTouchLayoutPreset('standard'))
    })
})
