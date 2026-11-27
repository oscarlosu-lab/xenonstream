export type VideoUpscalerMode = 'off' | 'rtx_vsr' | 'clarity' | 'cas' | 'fsr1'

export type VideoSizeMode = 'default' | 'stretch' | 'zoom'

export interface VideoUpscalerConfig {
    mode: VideoUpscalerMode
    sharpness: number
    videoSize?: VideoSizeMode
}

export interface OutputViewport {
    x: number
    y: number
    width: number
    height: number
}

export const UPSCALER_CANVAS_ID = 'xenonstream-upscaler-canvas'
const MAX_RENDER_WIDTH = 3840
const MAX_RENDER_HEIGHT = 2160

const VALID_MODES = new Set<VideoUpscalerMode>(['off', 'rtx_vsr', 'clarity', 'cas', 'fsr1'])

export function normalizeUpscalerMode(raw: unknown, legacyClarityStrength?: number): VideoUpscalerMode {
    if (typeof raw === 'string' && VALID_MODES.has(raw as VideoUpscalerMode)) {
        return raw as VideoUpscalerMode
    }
    if (typeof legacyClarityStrength === 'number' && Number.isFinite(legacyClarityStrength) && legacyClarityStrength > 0) {
        return 'clarity'
    }
    return 'off'
}

export function clampSharpness(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 0.5
    }
    return Math.min(1, Math.max(0, raw))
}

export function shouldRunEasuPass(srcW: number, srcH: number, dstW: number, dstH: number): boolean {
    return dstW > srcW || dstH > srcH
}

export function computeOutputViewport(
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    videoSize: VideoSizeMode = 'default',
): OutputViewport {
    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
        return { x: 0, y: 0, width: Math.max(1, dstW), height: Math.max(1, dstH) }
    }

    if (videoSize === 'stretch') {
        return { x: 0, y: 0, width: dstW, height: dstH }
    }

    const srcAspect = srcW / srcH
    const dstAspect = dstW / dstH

    if (videoSize === 'zoom') {
        if (srcAspect > dstAspect) {
            const width = Math.round(dstH * srcAspect)
            return { x: Math.round((dstW - width) / 2), y: 0, width, height: dstH }
        }
        const height = Math.round(dstW / srcAspect)
        return { x: 0, y: Math.round((dstH - height) / 2), width: dstW, height }
    }

    // 'default' -> aspect-fit letterbox/pillarbox
    if (srcAspect > dstAspect) {
        const height = Math.round(dstW / srcAspect)
        return { x: 0, y: Math.round((dstH - height) / 2), width: dstW, height }
    }
    const width = Math.round(dstH * srcAspect)
    return { x: Math.round((dstW - width) / 2), y: 0, width, height: dstH }
}

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;
uniform float u_flipY;
out vec2 v_uv;

void main() {
    vec2 pos = vec2(
        float((gl_VertexID & 1) << 2) - 1.0,
        float((gl_VertexID & 2) << 1) - 1.0
    );
    vec2 uv = pos * 0.5 + 0.5;
    v_uv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flipY));
    gl_Position = vec4(pos, 0.0, 1.0);
}
`

// AMD FidelityFX CAS (Contrast Adaptive Sharpening) 5-tap cross with anti-ringing clamp.
export const CAS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_srcSize;
uniform vec2 u_dstSize;
uniform float u_sharpness;
in vec2 v_uv;
out vec4 fragColor;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 invSrc = 1.0 / max(u_srcSize, vec2(1.0));
    vec3 c = texture(u_tex, v_uv).rgb;
    vec3 n = texture(u_tex, v_uv + vec2(0.0, -invSrc.y)).rgb;
    vec3 s = texture(u_tex, v_uv + vec2(0.0, invSrc.y)).rgb;
    vec3 w = texture(u_tex, v_uv + vec2(-invSrc.x, 0.0)).rgb;
    vec3 e = texture(u_tex, v_uv + vec2(invSrc.x, 0.0)).rgb;

    vec3 minRGB = min(c, min(min(n, s), min(w, e)));
    vec3 maxRGB = max(c, max(max(n, s), max(w, e)));

    float minL = luma(minRGB);
    float maxL = luma(maxRGB);
    float amp = clamp(min(minL, 1.0 - maxL) / max(maxL, 1e-5), 0.0, 1.0);
    amp = sqrt(amp);

    float peak = -1.0 / mix(8.0, 5.0, clamp(u_sharpness, 0.0, 1.0));
    float wTap = amp * peak;
    vec3 sharpened = (c + (n + s + w + e) * wTap) / (1.0 + 4.0 * wTap);
    fragColor = vec4(clamp(sharpened, minRGB, maxRGB), 1.0);
}
`

// AMD FidelityFX FSR 1.0 Pass 1: EASU (Edge Adaptive Spatial Upsampling) 12-tap Lanczos2 directional kernel.
export const FSR1_EASU_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_srcSize;
uniform vec2 u_dstSize;
uniform float u_sharpness;
in vec2 v_uv;
out vec4 fragColor;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void easuSet(inout vec2 dir, inout float len, vec2 pp, bool biS, bool biT, bool biU, bool biV,
             float lA, float lB, float lC, float lD, float lE) {
    float w = 0.0;
    if (biS) w = (1.0 - pp.x) * (1.0 - pp.y);
    if (biT) w = pp.x * (1.0 - pp.y);
    if (biU) w = (1.0 - pp.x) * pp.y;
    if (biV) w = pp.x * pp.y;

    float dc = lD - lC;
    float cb = lC - lB;
    float lenX = max(abs(dc), abs(cb));
    lenX = lenX > 0.0 ? 1.0 / lenX : 0.0;
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
    lenX *= lenX;
    len += lenX * w;

    float ec = lE - lC;
    float ca = lC - lA;
    float lenY = max(abs(ec), abs(ca));
    lenY = lenY > 0.0 ? 1.0 / lenY : 0.0;
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
    lenY *= lenY;
    len += lenY * w;
}

void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x)));
    v *= len2;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    wB = 1.5625 * wB - 0.5625;
    float w = wB * wA;
    aC += c * w;
    aW += w;
}

void main() {
    vec2 invSrc = 1.0 / max(u_srcSize, vec2(1.0));
    vec2 ip = v_uv * u_srcSize - 0.5;
    vec2 fp = floor(ip);
    vec2 pp = ip - fp;
    vec2 baseUv = (fp + 0.5) * invSrc;

    // 12-tap circular neighborhood: b, c, e, f, g, h, i, j, k, l, n, o
    vec3 b = texture(u_tex, baseUv + vec2( 0.0, -1.0) * invSrc).rgb;
    vec3 c = texture(u_tex, baseUv + vec2( 1.0, -1.0) * invSrc).rgb;
    vec3 e = texture(u_tex, baseUv + vec2(-1.0,  0.0) * invSrc).rgb;
    vec3 f = texture(u_tex, baseUv).rgb;
    vec3 g = texture(u_tex, baseUv + vec2( 1.0,  0.0) * invSrc).rgb;
    vec3 h = texture(u_tex, baseUv + vec2( 2.0,  0.0) * invSrc).rgb;
    vec3 i = texture(u_tex, baseUv + vec2(-1.0,  1.0) * invSrc).rgb;
    vec3 j = texture(u_tex, baseUv + vec2( 0.0,  1.0) * invSrc).rgb;
    vec3 k = texture(u_tex, baseUv + vec2( 1.0,  1.0) * invSrc).rgb;
    vec3 l = texture(u_tex, baseUv + vec2( 2.0,  1.0) * invSrc).rgb;
    vec3 n = texture(u_tex, baseUv + vec2( 0.0,  2.0) * invSrc).rgb;
    vec3 o = texture(u_tex, baseUv + vec2( 1.0,  2.0) * invSrc).rgb;

    float lb = luma(b), lc = luma(c), le = luma(e), lf = luma(f);
    float lg = luma(g), lh = luma(h), li = luma(i), lj = luma(j);
    float lk = luma(k), ll = luma(l), ln = luma(n), lo = luma(o);

    vec2 dir = vec2(0.0);
    float len = 0.0;
    easuSet(dir, len, pp, true,  false, false, false, lb, le, lf, lg, lj);
    easuSet(dir, len, pp, false, true,  false, false, lc, lf, lg, lh, lk);
    easuSet(dir, len, pp, false, false, true,  false, lf, li, lj, lk, ln);
    easuSet(dir, len, pp, false, false, false, true,  lg, lj, lk, ll, lo);

    float dirR = dot(dir, dir);
    bool zro = dirR < (1.0 / 32768.0);
    dirR = zro ? 1.0 : inversesqrt(dirR);
    dir = zro ? vec2(1.0, 0.0) : dir * dirR;

    len = len * 0.5;
    len *= len;
    float stretch = (dir.x * dir.x + dir.y * dir.y) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    float clp = 1.0 / lob;

    vec3 min4 = min(min(f, g), min(j, k));
    vec3 max4 = max(max(f, g), max(j, k));

    vec3 aC = vec3(0.0);
    float aW = 0.0;
    easuTap(aC, aW, vec2( 0.0, -1.0) - pp, dir, len2, lob, clp, b);
    easuTap(aC, aW, vec2( 1.0, -1.0) - pp, dir, len2, lob, clp, c);
    easuTap(aC, aW, vec2(-1.0,  1.0) - pp, dir, len2, lob, clp, i);
    easuTap(aC, aW, vec2( 0.0,  1.0) - pp, dir, len2, lob, clp, j);
    easuTap(aC, aW, vec2( 0.0,  0.0) - pp, dir, len2, lob, clp, f);
    easuTap(aC, aW, vec2(-1.0,  0.0) - pp, dir, len2, lob, clp, e);
    easuTap(aC, aW, vec2( 1.0,  1.0) - pp, dir, len2, lob, clp, k);
    easuTap(aC, aW, vec2( 2.0,  1.0) - pp, dir, len2, lob, clp, l);
    easuTap(aC, aW, vec2( 2.0,  0.0) - pp, dir, len2, lob, clp, h);
    easuTap(aC, aW, vec2( 1.0,  0.0) - pp, dir, len2, lob, clp, g);
    easuTap(aC, aW, vec2( 1.0,  2.0) - pp, dir, len2, lob, clp, o);
    easuTap(aC, aW, vec2( 0.0,  2.0) - pp, dir, len2, lob, clp, n);

    vec3 pix = clamp(aC / max(aW, 1e-5), min4, max4);
    fragColor = vec4(pix, 1.0);
}
`

// AMD FidelityFX FSR 1.0 Pass 2: RCAS (Robust Contrast Adaptive Sharpening) with noise suppression.
export const FSR1_RCAS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_srcSize;
uniform vec2 u_dstSize;
uniform float u_sharpness;
in vec2 v_uv;
out vec4 fragColor;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 invDst = 1.0 / max(u_dstSize, vec2(1.0));
    vec3 e = texture(u_tex, v_uv).rgb;
    vec3 b = texture(u_tex, v_uv + vec2(0.0, -invDst.y)).rgb;
    vec3 d = texture(u_tex, v_uv + vec2(-invDst.x, 0.0)).rgb;
    vec3 f = texture(u_tex, v_uv + vec2(invDst.x, 0.0)).rgb;
    vec3 h = texture(u_tex, v_uv + vec2(0.0, invDst.y)).rgb;

    float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
    float nz = 0.25 * (bL + dL + fL + hL) - eL;
    float rangeL = max(max(bL, dL), max(fL, max(hL, eL))) - min(min(bL, dL), min(fL, min(hL, eL)));
    nz = clamp(abs(nz) / max(rangeL, 1e-5), 0.0, 1.0);
    nz = -0.5 * nz + 1.0;

    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));

    vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1e-5));
    vec3 hitMax = (1.0 - max(mx4, e)) / max(4.0 * mn4 - 4.0, vec3(-1e-5));
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0));
    float sharpScale = mix(0.25, 1.0, clamp(u_sharpness, 0.0, 1.0));
    lobe *= sharpScale * nz;

    vec3 rcas = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
    fragColor = vec4(clamp(rcas, min(mn4, e), max(mx4, e)), 1.0);
}
`

interface ShaderProgramHandles {
    program: WebGLProgram
    uTex: WebGLUniformLocation | null
    uSrcSize: WebGLUniformLocation | null
    uDstSize: WebGLUniformLocation | null
    uSharpness: WebGLUniformLocation | null
    uFlipY: WebGLUniformLocation | null
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[XenonStream Upscaler] Shader compile failed:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
    }
    return shader
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): ShaderProgramHandles | null {
    const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
    if (!vert || !frag) {
        if (vert) gl.deleteShader(vert)
        if (frag) gl.deleteShader(frag)
        return null
    }
    const program = gl.createProgram()
    if (!program) {
        gl.deleteShader(vert)
        gl.deleteShader(frag)
        return null
    }
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    gl.deleteShader(vert)
    gl.deleteShader(frag)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[XenonStream Upscaler] Program link failed:', gl.getProgramInfoLog(program))
        gl.deleteProgram(program)
        return null
    }

    return {
        program,
        uTex: gl.getUniformLocation(program, 'u_tex'),
        uSrcSize: gl.getUniformLocation(program, 'u_srcSize'),
        uDstSize: gl.getUniformLocation(program, 'u_dstSize'),
        uSharpness: gl.getUniformLocation(program, 'u_sharpness'),
        uFlipY: gl.getUniformLocation(program, 'u_flipY'),
    }
}

export class WebGLVideoUpscaler {
    private container: HTMLElement
    private video: HTMLVideoElement
    private config: VideoUpscalerConfig
    private canvas: HTMLCanvasElement | null = null
    private gl: WebGL2RenderingContext | null = null
    private vao: WebGLVertexArrayObject | null = null
    private videoTex: WebGLTexture | null = null
    private easuTex: WebGLTexture | null = null
    private easuFbo: WebGLFramebuffer | null = null
    private easuW = 0
    private easuH = 0
    private casProg: ShaderProgramHandles | null = null
    private easuProg: ShaderProgramHandles | null = null
    private rcasProg: ShaderProgramHandles | null = null
    private resizeObserver: ResizeObserver | null = null
    private windowResizeListener: (() => void) | null = null
    private canvasW = 0
    private canvasH = 0
    private uploadedSrcW = 0
    private uploadedSrcH = 0
    private vfcId: number | null = null
    private rafId: number | null = null
    private destroyed = false
    private contextLost = false

    constructor(container: HTMLElement, video: HTMLVideoElement, config: VideoUpscalerConfig) {
        this.container = container
        this.video = video
        this.config = {
            mode: normalizeUpscalerMode(config.mode),
            sharpness: clampSharpness(config.sharpness),
            videoSize: config.videoSize ?? 'default',
        }
        this.init()
    }

    public isActive(): boolean {
        return !this.destroyed && !this.contextLost && this.gl !== null
    }

    public updateConfig(config: VideoUpscalerConfig): void {
        this.config = {
            mode: normalizeUpscalerMode(config.mode),
            sharpness: clampSharpness(config.sharpness),
            videoSize: config.videoSize ?? 'default',
        }
        if (this.isActive()) {
            this.renderFrame()
        }
    }

    private init(): void {
        if (typeof document === 'undefined') return
        const existing = document.getElementById(UPSCALER_CANVAS_ID)
        if (existing) existing.remove()

        const canvas = document.createElement('canvas')
        canvas.id = UPSCALER_CANVAS_ID
        canvas.style.position = 'absolute'
        canvas.style.inset = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.zIndex = '96'
        canvas.style.pointerEvents = 'none'

        const gl = canvas.getContext('webgl2', {
            antialias: false,
            alpha: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            desynchronized: true,
            powerPreference: 'high-performance',
        })
        if (!gl) {
            console.warn('[XenonStream Upscaler] WebGL2 unavailable; falling back to native <video>.')
            return
        }

        const casProg = createProgram(gl, FULLSCREEN_VERTEX_SHADER, CAS_FRAGMENT_SHADER)
        const easuProg = createProgram(gl, FULLSCREEN_VERTEX_SHADER, FSR1_EASU_FRAGMENT_SHADER)
        const rcasProg = createProgram(gl, FULLSCREEN_VERTEX_SHADER, FSR1_RCAS_FRAGMENT_SHADER)
        if (!casProg || !easuProg || !rcasProg) {
            if (casProg) gl.deleteProgram(casProg.program)
            if (easuProg) gl.deleteProgram(easuProg.program)
            if (rcasProg) gl.deleteProgram(rcasProg.program)
            return
        }

        const vao = gl.createVertexArray()
        const videoTex = gl.createTexture()
        if (!vao || !videoTex) {
            if (vao) gl.deleteVertexArray(vao)
            if (videoTex) gl.deleteTexture(videoTex)
            gl.deleteProgram(casProg.program)
            gl.deleteProgram(easuProg.program)
            gl.deleteProgram(rcasProg.program)
            return
        }

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
        gl.bindTexture(gl.TEXTURE_2D, videoTex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

        canvas.addEventListener('webglcontextlost', this.onContextLost, false)

        this.canvas = canvas
        this.gl = gl
        this.vao = vao
        this.videoTex = videoTex
        this.casProg = casProg
        this.easuProg = easuProg
        this.rcasProg = rcasProg

        this.container.appendChild(canvas)
        this.video.style.filter = ''
        this.video.style.opacity = '0.001'

        this.syncCanvasSize()
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize())
            this.resizeObserver.observe(this.container)
        }
        if (typeof window !== 'undefined') {
            this.windowResizeListener = () => this.syncCanvasSize()
            window.addEventListener('resize', this.windowResizeListener)
        }

        this.scheduleNextFrame()
    }

    private onContextLost = (e: Event): void => {
        e.preventDefault()
        this.contextLost = true
        this.video.style.opacity = ''
    }

    private syncCanvasSize(): void {
        if (!this.canvas || !this.gl) return
        const rect = this.container.getBoundingClientRect()
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
        const w = Math.min(MAX_RENDER_WIDTH, Math.max(1, Math.round(rect.width * dpr)))
        const h = Math.min(MAX_RENDER_HEIGHT, Math.max(1, Math.round(rect.height * dpr)))
        if (this.canvasW !== w || this.canvasH !== h) {
            this.canvasW = w
            this.canvasH = h
            this.canvas.width = w
            this.canvas.height = h
        }
    }

    private ensureEasuTarget(w: number, h: number): boolean {
        const gl = this.gl
        if (!gl) return false
        if (this.easuFbo && this.easuTex && this.easuW === w && this.easuH === h) {
            return true
        }
        if (this.easuFbo) gl.deleteFramebuffer(this.easuFbo)
        if (this.easuTex) gl.deleteTexture(this.easuTex)

        const tex = gl.createTexture()
        const fbo = gl.createFramebuffer()
        if (!tex || !fbo) {
            if (tex) gl.deleteTexture(tex)
            if (fbo) gl.deleteFramebuffer(fbo)
            this.easuTex = null
            this.easuFbo = null
            return false
        }

        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)

        this.easuTex = tex
        this.easuFbo = fbo
        this.easuW = w
        this.easuH = h
        return true
    }

    private scheduleNextFrame(): void {
        if (this.destroyed || this.contextLost) return
        const anyVideo = this.video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number
        }
        if (typeof anyVideo.requestVideoFrameCallback === 'function') {
            this.vfcId = anyVideo.requestVideoFrameCallback(() => {
                this.vfcId = null
                this.renderFrame()
                this.scheduleNextFrame()
            })
        } else if (typeof requestAnimationFrame === 'function') {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null
                this.renderFrame()
                this.scheduleNextFrame()
            })
        }
    }

    private renderFrame(): void {
        if (this.destroyed || this.contextLost || !this.gl || !this.canvas || !this.vao || !this.videoTex) {
            return
        }
        if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
            return
        }

        const gl = this.gl
        const srcW = this.video.videoWidth
        const srcH = this.video.videoHeight
        const dstW = this.canvasW || this.canvas.width
        const dstH = this.canvasH || this.canvas.height
        const vp = computeOutputViewport(srcW, srcH, dstW, dstH, this.config.videoSize ?? 'default')

        gl.bindVertexArray(this.vao)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
        if (this.uploadedSrcW !== srcW || this.uploadedSrcH !== srcH) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video)
            this.uploadedSrcW = srcW
            this.uploadedSrcH = srcH
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.video)
        }

        const runEasu = this.config.mode === 'fsr1' && shouldRunEasuPass(srcW, srcH, vp.width, vp.height)
        if (runEasu && this.easuProg && this.rcasProg && this.ensureEasuTarget(vp.width, vp.height)) {
            // Pass 1: EASU -> offscreen FBO at viewport resolution
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.easuFbo)
            gl.viewport(0, 0, vp.width, vp.height)
            gl.useProgram(this.easuProg.program)
            gl.uniform1i(this.easuProg.uTex, 0)
            gl.uniform2f(this.easuProg.uSrcSize, srcW, srcH)
            gl.uniform2f(this.easuProg.uDstSize, vp.width, vp.height)
            gl.uniform1f(this.easuProg.uSharpness, this.config.sharpness)
            gl.uniform1f(this.easuProg.uFlipY, 0.0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)

            // Pass 2: RCAS -> default framebuffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0, 0, dstW, dstH)
            gl.clearColor(0, 0, 0, 1)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.viewport(vp.x, vp.y, vp.width, vp.height)
            gl.bindTexture(gl.TEXTURE_2D, this.easuTex)
            gl.useProgram(this.rcasProg.program)
            gl.uniform1i(this.rcasProg.uTex, 0)
            gl.uniform2f(this.rcasProg.uSrcSize, vp.width, vp.height)
            gl.uniform2f(this.rcasProg.uDstSize, vp.width, vp.height)
            gl.uniform1f(this.rcasProg.uSharpness, this.config.sharpness)
            gl.uniform1f(this.rcasProg.uFlipY, 1.0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        } else if (this.config.mode === 'fsr1' && this.rcasProg) {
            // Native 1:1 fast-path: skip EASU + FBO and run single-pass RCAS directly
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0, 0, dstW, dstH)
            gl.clearColor(0, 0, 0, 1)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.viewport(vp.x, vp.y, vp.width, vp.height)
            gl.useProgram(this.rcasProg.program)
            gl.uniform1i(this.rcasProg.uTex, 0)
            gl.uniform2f(this.rcasProg.uSrcSize, srcW, srcH)
            gl.uniform2f(this.rcasProg.uDstSize, vp.width, vp.height)
            gl.uniform1f(this.rcasProg.uSharpness, this.config.sharpness)
            gl.uniform1f(this.rcasProg.uFlipY, 1.0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        } else if (this.casProg) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0, 0, dstW, dstH)
            gl.clearColor(0, 0, 0, 1)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.viewport(vp.x, vp.y, vp.width, vp.height)
            gl.useProgram(this.casProg.program)
            gl.uniform1i(this.casProg.uTex, 0)
            gl.uniform2f(this.casProg.uSrcSize, srcW, srcH)
            gl.uniform2f(this.casProg.uDstSize, vp.width, vp.height)
            gl.uniform1f(this.casProg.uSharpness, this.config.sharpness)
            gl.uniform1f(this.casProg.uFlipY, 1.0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        }

        gl.bindVertexArray(null)
    }

    public destroy(): void {
        if (this.destroyed) return
        this.destroyed = true

        const anyVideo = this.video as HTMLVideoElement & {
            cancelVideoFrameCallback?: (id: number) => void
        }
        if (this.vfcId !== null && typeof anyVideo.cancelVideoFrameCallback === 'function') {
            anyVideo.cancelVideoFrameCallback(this.vfcId)
            this.vfcId = null
        }
        if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }
        if (this.windowResizeListener && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.windowResizeListener)
            this.windowResizeListener = null
        }

        const gl = this.gl
        if (gl) {
            if (this.easuFbo) gl.deleteFramebuffer(this.easuFbo)
            if (this.easuTex) gl.deleteTexture(this.easuTex)
            if (this.videoTex) gl.deleteTexture(this.videoTex)
            if (this.vao) gl.deleteVertexArray(this.vao)
            if (this.casProg) gl.deleteProgram(this.casProg.program)
            if (this.easuProg) gl.deleteProgram(this.easuProg.program)
            if (this.rcasProg) gl.deleteProgram(this.rcasProg.program)
            gl.getExtension('WEBGL_lose_context')?.loseContext()
        }

        if (this.canvas) {
            this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false)
            this.canvas.remove()
            this.canvas = null
        }

        this.video.style.opacity = ''
        this.gl = null
    }
}
