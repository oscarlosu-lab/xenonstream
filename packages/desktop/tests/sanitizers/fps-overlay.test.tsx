import { defaultSettings } from '../../renderer/context/userContext.defaults'
import StreamFpsOverlay, { clampOverlayPosition } from '../../renderer/components/ui/stream-fps-overlay'
import { computeStreamHudMetrics, useSharedStreamStats } from '../../renderer/lib/streamStats'
import { createHookHarness, flushMicrotasks } from './testhelper'

function makeStatsReport(entries: Array<[string, any]>): RTCStatsReport {
    const map = new Map<string, any>(entries)
    return {
        get: (id: string) => map.get(id),
        forEach: (cb: (val: any, key: string) => void) => map.forEach(cb),
    } as unknown as RTCStatsReport
}

describe('Real-time FPS & stream metrics overlay', () => {
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('stream_fps_overlay is disabled by default', () => {
        expect(defaultSettings.stream_fps_overlay).toBe(false)
    })

    test('computeStreamHudMetrics computes instantaneous bitrate (Mbps) and packet loss (%) from deltas', () => {
        const s1 = makeStatsReport([
            ['codec-1', { type: 'codec', mimeType: 'video/H265' }],
            ['pair-1', { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.008 }],
            ['transport-1', { type: 'transport', selectedCandidatePairId: 'pair-1' }],
            ['video-1', {
                id: 'video-1',
                type: 'inbound-rtp',
                kind: 'video',
                timestamp: 1000,
                framesPerSecond: 60,
                frameWidth: 2560,
                frameHeight: 1440,
                framesDecoded: 100,
                bytesReceived: 1_000_000,
                packetsReceived: 1000,
                packetsLost: 10,
                codecId: 'codec-1',
            }],
        ])

        const first = computeStreamHudMetrics(s1)
        expect(first.hud).toEqual({
            fps: 60,
            width: 2560,
            height: 1440,
            bitrateMbps: 0,
            rttMs: 8,
            lossPercent: 0,
            codec: 'H265',
        })

        // 1 second later: +2,500,000 bytes (= 20.0 Mbps), +98 packetsReceived, +2 packetsLost (= 2.0% loss)
        const s2 = makeStatsReport([
            ['codec-1', { type: 'codec', mimeType: 'video/H265' }],
            ['pair-1', { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.006 }],
            ['transport-1', { type: 'transport', selectedCandidatePairId: 'pair-1' }],
            ['video-1', {
                id: 'video-1',
                type: 'inbound-rtp',
                kind: 'video',
                timestamp: 2000,
                framesPerSecond: 60,
                frameWidth: 2560,
                frameHeight: 1440,
                framesDecoded: 160,
                bytesReceived: 3_500_000,
                packetsReceived: 1098,
                packetsLost: 12,
                codecId: 'codec-1',
            }],
        ])

        const second = computeStreamHudMetrics(s2, first.sample)
        expect(second.hud.bitrateMbps).toBeCloseTo(20.0, 4)
        expect(second.hud.lossPercent).toBeCloseTo(2.0, 4)
        expect(second.hud.rttMs).toBe(6)
        expect(second.hud.codec).toBe('H265')
    })

    test('useSharedStreamStats creates 0 timers when inactive and cleans interval on deactivate/unmount', async () => {
        const harness = createHookHarness()
        const getStats = jest.fn(async () => makeStatsReport([
            ['video-1', { id: 'video-1', type: 'inbound-rtp', kind: 'video', timestamp: 1000, framesPerSecond: 60, frameWidth: 1920, frameHeight: 1080, framesDecoded: 10, bytesReceived: 1000, packetsReceived: 10, packetsLost: 0 }],
        ]))
        const player = { _webrtcClient: { getStats } }

        function HookHost({ active }: { active: boolean }) {
            useSharedStreamStats(player, active)
            return null
        }

        // Inactive: 0 timers and 0 getStats calls
        const mounted = harness.mount(HookHost, { active: false })
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(0)
        expect(getStats).toHaveBeenCalledTimes(0)

        // Activate: single 1 Hz poller
        mounted.rerender({ active: true })
        await flushMicrotasks()
        expect(getStats).toHaveBeenCalledTimes(1)
        expect(jest.getTimerCount()).toBe(1)

        jest.advanceTimersByTime(1000)
        await flushMicrotasks()
        expect(getStats).toHaveBeenCalledTimes(2)

        // Deactivate / unmount: 0 timers left
        mounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
        harness.dispose()
    })

    test('StreamFpsOverlay renders large green draggable FPS-only HUD and clamps bounds', () => {
        const harness = createHookHarness()
        const mounted = harness.mount(StreamFpsOverlay, {
            metrics: {
                fps: 60,
                width: 2560,
                height: 1440,
                bitrateMbps: 27.4,
                rttMs: 5,
                lossPercent: 0,
                codec: 'H264',
            },
            position: { x: 100, y: 120 },
        })
        const tree: any = mounted.getOutput()
        expect(tree.props.id).toBe('component_streamcomponent_fps_overlay')
        expect(tree.props.style.zIndex).toBeGreaterThanOrEqual(100)
        expect(tree.props.style.fontSize).toBeGreaterThanOrEqual(36)
        expect(tree.props.style.color).toBe('#4ade80')
        expect(tree.props.style.left).toBe(100)
        expect(tree.props.style.top).toBe(120)
        expect(tree.props.style.cursor).toBe('grab')
        expect(tree.props.children).toBe('60FPS')
        expect(tree.props['aria-hidden']).toBe('true')

        expect(clampOverlayPosition({ x: -50, y: -10 }, 1920, 1080, 140, 44)).toEqual({ x: 0, y: 0 })
        expect(clampOverlayPosition({ x: 5000, y: 5000 }, 1920, 1080, 140, 44)).toEqual({ x: 1780, y: 1036 })

        mounted.unmount()
        harness.dispose()
    })
})
