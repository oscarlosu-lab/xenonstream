import { getDpadDirection, getStickAxes } from '../../lib/touchGestures'

describe('touchGestures', () => {
    it('returns (0, 0) at stick center and clamps normalized axes to [-1, 1]', () => {
        expect(getStickAxes(100, 100, 100, 100, 50)).toEqual({ x: 0, y: 0 })
        expect(getStickAxes(100, 100, 150, 100, 50)).toEqual({ x: 1, y: 0 })
        expect(getStickAxes(100, 100, 50, 100, 50)).toEqual({ x: -1, y: 0 })

        const clamped = getStickAxes(100, 100, 300, 100, 50)
        expect(clamped.x).toBeLessThanOrEqual(1)
        expect(clamped.x).toBeGreaterThanOrEqual(-1)
        expect(clamped.y).toBe(0)
    })

    it('detects cardinal D-pad directions outside center deadzone', () => {
        expect(getDpadDirection(100, 100, 100, 100)).toEqual({ up: false, down: false, left: false, right: false })
        expect(getDpadDirection(100, 100, 100, 60)).toEqual({ up: true, down: false, left: false, right: false })
        expect(getDpadDirection(100, 100, 100, 140)).toEqual({ up: false, down: true, left: false, right: false })
        expect(getDpadDirection(100, 100, 60, 100)).toEqual({ up: false, down: false, left: true, right: false })
        expect(getDpadDirection(100, 100, 140, 100)).toEqual({ up: false, down: false, left: false, right: true })
    })
})
