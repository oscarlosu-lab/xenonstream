import { CLARITY_SVG_FILTER_ID, getClaritySharpenKernel, getClarityVideoFilter } from '../../lib/clarityBoost'
import { applyLowLatencyReceivers, filterIceCandidates } from '../../renderer/lib/streamPath'

describe('Wave LAN-Q: LAN image quality engine', () => {
    test('getClaritySharpenKernel returns null at 0 and a normalized sum=1.0 3x3 kernel for (0, 1]', () => {
        expect(getClaritySharpenKernel(0)).toBeNull()
        expect(getClaritySharpenKernel(-1)).toBeNull()

        for (const strength of [0.1, 0.25, 0.5, 0.75, 1.0]) {
            const kernel = getClaritySharpenKernel(strength)
            expect(kernel).not.toBeNull()
            const nums = kernel!.split(/\s+/).map(Number)
            expect(nums).toHaveLength(9)
            const sum = nums.reduce((a, b) => a + b, 0)
            expect(sum).toBeCloseTo(1.0, 4)
            expect(nums[4]).toBeGreaterThan(1.0)
        }
    })

    test('getClarityVideoFilter prepends SVG unsharp filter when enabled and returns empty string at 0', () => {
        expect(getClarityVideoFilter(0, true)).toBe('')
        expect(getClarityVideoFilter(0.5, true)).toBe(`url(#${CLARITY_SVG_FILTER_ID}) contrast(1.10) saturate(1.05)`)
        expect(getClarityVideoFilter(0.5, false)).toBe('contrast(1.10) saturate(1.05)')
    })

    test('filterIceCandidates sorts private LAN host UDP candidates before srflx and relay', () => {
        const result = filterIceCandidates([
            { candidate: 'candidate:3 1 udp 16777215 203.0.113.5 40000 typ relay', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
            { candidate: 'candidate:2 1 udp 1686052607 198.51.100.2 50000 typ srflx', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
            { candidate: 'candidate:1 1 udp 2122260223 10.0.0.45 51234 typ host', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
        ])
        expect(result.candidates).toHaveLength(3)
        expect(result.candidates[0].candidate).toContain('10.0.0.45')
        expect(result.candidates[1].candidate).toContain('typ srflx')
        expect(result.candidates[2].candidate).toContain('typ relay')
    })

    test('applyLowLatencyReceivers sets playoutDelayHint=0, jitterBufferTarget=0, and contentHint=motion on video receiver', () => {
        const videoReceiver: any = {
            track: { kind: 'video', contentHint: '' },
            playoutDelayHint: 0.5,
            jitterBufferTarget: 100,
        }
        const audioReceiver: any = {
            track: { kind: 'audio' },
            playoutDelayHint: 0.5,
            jitterBufferTarget: 100,
        }
        const fakePeer: any = {
            getReceivers: () => [videoReceiver, audioReceiver],
        }

        applyLowLatencyReceivers(fakePeer, true)

        expect(videoReceiver.playoutDelayHint).toBe(0)
        expect(videoReceiver.jitterBufferTarget).toBe(0)
        expect(videoReceiver.track.contentHint).toBe('motion')
        expect(audioReceiver.playoutDelayHint).toBe(0.02)
        expect(audioReceiver.jitterBufferTarget).toBe(20)
    })
})
