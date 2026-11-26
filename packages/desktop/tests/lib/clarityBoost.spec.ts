import { getClarityBoostFilter } from '../../lib/clarityBoost'

describe('getClarityBoostFilter', () => {
    it('returns an empty string (no filter) at strength 0', () => {
        expect(getClarityBoostFilter(0)).toBe('')
    })

    it('returns a mid-strength filter at strength 0.5', () => {
        expect(getClarityBoostFilter(0.5)).toBe('contrast(1.10) saturate(1.05)')
    })

    it('returns the max-strength filter at strength 1', () => {
        expect(getClarityBoostFilter(1)).toBe('contrast(1.20) saturate(1.10)')
    })

    it('clamps negative strength to 0 (no filter)', () => {
        expect(getClarityBoostFilter(-0.5)).toBe('')
    })

    it('clamps strength above 1 to the max-strength filter', () => {
        expect(getClarityBoostFilter(1.5)).toBe('contrast(1.20) saturate(1.10)')
    })
})
