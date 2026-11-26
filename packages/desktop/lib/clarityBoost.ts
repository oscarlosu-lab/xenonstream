export const CLARITY_SVG_FILTER_ID = 'xenonstream-clarity-sharpen'

/**
 * Computes a CSS `filter` value approximating Better xCloud's "Clarity Boost"
 * for a plain <video> element. `strength` is 0 (off) to 1 (max).
 * Contrast scales 1.00-1.20, saturation scales 1.00-1.10.
 */
export function getClarityBoostFilter(strength: number): string {
    const clamped = Math.min(1, Math.max(0, strength))

    if (clamped === 0) {
        return ''
    }

    const contrast = (1 + 0.2 * clamped).toFixed(2)
    const saturate = (1 + 0.1 * clamped).toFixed(2)

    return `contrast(${contrast}) saturate(${saturate})`
}

/**
 * Computes a normalized 3x3 unsharp-mask convolution kernel for SVG
 * `<feConvolveMatrix order="3">` with exact sum = 1.0 (zero brightness shift).
 * Returns null when strength <= 0.
 */
export function getClaritySharpenKernel(strength: number): string | null {
    const clamped = Math.min(1, Math.max(0, strength))
    if (clamped === 0) {
        return null
    }

    const k = clamped * 0.45
    const neg = (-k).toFixed(4)
    const center = (1 + 4 * k).toFixed(4)
    return `0 ${neg} 0 ${neg} ${center} ${neg} 0 ${neg} 0`
}

/**
 * Returns the full CSS `filter` string for the stream <video> element,
 * optionally prepending the GPU-accelerated SVG unsharp mask filter.
 */
export function getClarityVideoFilter(strength: number, useSvgSharpen = true): string {
    const css = getClarityBoostFilter(strength)
    if (!css) {
        return ''
    }
    if (!useSvgSharpen) {
        return css
    }
    return `url(#${CLARITY_SVG_FILTER_ID}) ${css}`
}
