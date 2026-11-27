import {
    CAS_FRAGMENT_SHADER,
    clampSharpness,
    computeOutputViewport,
    FSR1_EASU_FRAGMENT_SHADER,
    FSR1_RCAS_FRAGMENT_SHADER,
    FULLSCREEN_VERTEX_SHADER,
    normalizeUpscalerMode,
    shouldRunEasuPass,
    WebGLVideoUpscaler,
} from '../../lib/videoUpscaler'

describe('videoUpscaler', () => {
    it('normalizes upscaler modes and falls back to clarity when legacy strength > 0', () => {
        expect(normalizeUpscalerMode('fsr1')).toBe('fsr1')
        expect(normalizeUpscalerMode('cas')).toBe('cas')
        expect(normalizeUpscalerMode('rtx_vsr')).toBe('rtx_vsr')
        expect(normalizeUpscalerMode('clarity')).toBe('clarity')
        expect(normalizeUpscalerMode('off')).toBe('off')

        expect(normalizeUpscalerMode(undefined, 0.4)).toBe('clarity')
        expect(normalizeUpscalerMode('', 0.25)).toBe('clarity')
        expect(normalizeUpscalerMode('invalid', 0)).toBe('off')
        expect(normalizeUpscalerMode(undefined, 0)).toBe('off')
    })

    it('clamps sharpness safely between 0 and 1', () => {
        expect(clampSharpness(-0.5)).toBe(0)
        expect(clampSharpness(1.8)).toBe(1)
        expect(clampSharpness(0.65)).toBe(0.65)
        expect(clampSharpness(NaN)).toBe(0.5)
        expect(clampSharpness(undefined)).toBe(0.5)
    })

    it('computes output viewports for default (aspect-fit), stretch, and zoom', () => {
        expect(computeOutputViewport(1280, 720, 2560, 1440, 'default')).toEqual({
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        })

        // 16:9 inside 16:10 (2560x1600) -> letterboxed vertically
        expect(computeOutputViewport(1920, 1080, 2560, 1600, 'default')).toEqual({
            x: 0,
            y: 80,
            width: 2560,
            height: 1440,
        })

        // 16:9 inside 21:9 (3440x1440) -> pillarboxed horizontally
        expect(computeOutputViewport(1920, 1080, 3440, 1440, 'default')).toEqual({
            x: 440,
            y: 0,
            width: 2560,
            height: 1440,
        })

        expect(computeOutputViewport(1280, 720, 3440, 1440, 'stretch')).toEqual({
            x: 0,
            y: 0,
            width: 3440,
            height: 1440,
        })

        // zoom crops 16:9 to fill 16:10 height
        const zoom = computeOutputViewport(1920, 1080, 2560, 1600, 'zoom')
        expect(zoom.height).toBe(1600)
        expect(zoom.width).toBeGreaterThan(2560)
        expect(zoom.x).toBeLessThan(0)
    })

    it('exports valid GLSL ES 3.00 shaders with expected uniforms', () => {
        expect(FULLSCREEN_VERTEX_SHADER).toContain('#version 300 es')
        expect(FULLSCREEN_VERTEX_SHADER).toContain('uniform float u_flipY;')

        for (const frag of [CAS_FRAGMENT_SHADER, FSR1_EASU_FRAGMENT_SHADER, FSR1_RCAS_FRAGMENT_SHADER]) {
            expect(frag).toContain('#version 300 es')
            expect(frag).toContain('uniform sampler2D u_tex;')
            expect(frag).toContain('uniform vec2 u_srcSize;')
            expect(frag).toContain('uniform vec2 u_dstSize;')
            expect(frag).toContain('uniform float u_sharpness;')
            expect(frag).toContain('out vec4 fragColor;')
        }
    })

    it('falls back gracefully in non-DOM/no-WebGL2 environments and cleans up without throwing', () => {
        const fakeVideo: any = { style: { filter: '', opacity: '' } }
        const fakeContainer: any = {}
        const upscaler = new WebGLVideoUpscaler(fakeContainer, fakeVideo, {
            mode: 'fsr1',
            sharpness: 0.7,
        })
        expect(upscaler.isActive()).toBe(false)
        upscaler.updateConfig({ mode: 'cas', sharpness: 0.5 })
        upscaler.destroy()
        expect(fakeVideo.style.opacity).toBe('')
    })

    it('runs EASU pass only when upscaling above source dimensions', () => {
        expect(shouldRunEasuPass(1280, 720, 2560, 1440)).toBe(true)
        expect(shouldRunEasuPass(1920, 1080, 2560, 1440)).toBe(true)
        expect(shouldRunEasuPass(2560, 1440, 2560, 1440)).toBe(false)
        expect(shouldRunEasuPass(2560, 1440, 1920, 1080)).toBe(false)
    })
})
