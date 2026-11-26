import { useEffect, useState } from 'react'

export interface StreamStatsSample {
    videoId: string
    timestampMs: number
    bytesReceived: number
    packetsReceived: number
    packetsLost: number
}

export interface StreamHudMetrics {
    fps: number
    width: number
    height: number
    bitrateMbps: number
    rttMs: number | null
    lossPercent: number
    codec: string
}

export interface SharedStreamStatsSnapshot {
    video?: RTCInboundRtpStreamStats
    hud: StreamHudMetrics
    sampleTimestamp: number
}

function formatCodecName(mimeType?: string): string {
    if (!mimeType) {
        return '--'
    }
    const parts = mimeType.split('/')
    return (parts[1] || mimeType).toUpperCase()
}

function normalizeTimestampMs(rawTimestamp: unknown, fallbackNowMs: number): number {
    if (typeof rawTimestamp !== 'number' || !Number.isFinite(rawTimestamp) || rawTimestamp <= 0) {
        return fallbackNowMs
    }
    return rawTimestamp
}

function extractRttMs(stats: RTCStatsReport): number | null {
    let selectedPairId: string | undefined
    stats.forEach((entry: any) => {
        if (entry?.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
            selectedPairId = entry.selectedCandidatePairId
        }
    })

    if (selectedPairId) {
        const pair: any = stats.get(selectedPairId)
        if (pair && typeof pair.currentRoundTripTime === 'number') {
            return Math.round(pair.currentRoundTripTime * 1000)
        }
    }

    let fallbackRtt: number | null = null
    stats.forEach((entry: any) => {
        if (
            entry?.type === 'candidate-pair'
            && (entry.nominated === true || entry.state === 'succeeded')
            && typeof entry.currentRoundTripTime === 'number'
        ) {
            fallbackRtt = Math.round(entry.currentRoundTripTime * 1000)
        }
    })
    return fallbackRtt
}

export function computeStreamHudMetrics(
    stats: RTCStatsReport,
    previous?: StreamStatsSample,
    fallbackNowMs = Date.now(),
): { video?: RTCInboundRtpStreamStats, hud: StreamHudMetrics, sample?: StreamStatsSample } {
    let video: RTCInboundRtpStreamStats | undefined
    stats.forEach((entry: any) => {
        if (
            entry?.type === 'inbound-rtp'
            && entry.kind === 'video'
            && (!video || (entry.framesDecoded ?? 0) > (video.framesDecoded ?? 0))
        ) {
            video = entry
        }
    })

    const rttMs = extractRttMs(stats)
    if (!video) {
        return {
            video: undefined,
            hud: { fps: 0, width: 0, height: 0, bitrateMbps: 0, rttMs, lossPercent: 0, codec: '--' },
            sample: undefined,
        }
    }

    const v: any = video
    const timestampMs = normalizeTimestampMs(v.timestamp, fallbackNowMs)
    const bytesReceived = typeof v.bytesReceived === 'number' ? v.bytesReceived : 0
    const packetsReceived = typeof v.packetsReceived === 'number' ? v.packetsReceived : 0
    const packetsLost = typeof v.packetsLost === 'number' ? v.packetsLost : 0

    let bitrateMbps = 0
    let lossPercent = 0

    if (previous && previous.videoId === v.id) {
        const dtSec = (timestampMs - previous.timestampMs) / 1000
        const bytesDelta = Math.max(0, bytesReceived - previous.bytesReceived)
        if (dtSec > 0) {
            bitrateMbps = (bytesDelta * 8) / dtSec / 1_000_000
        }

        const lostDelta = Math.max(0, packetsLost - previous.packetsLost)
        const recvDelta = Math.max(0, packetsReceived - previous.packetsReceived)
        const totalDelta = lostDelta + recvDelta
        if (totalDelta > 0) {
            lossPercent = (lostDelta / totalDelta) * 100
        }
    }

    const codecEntry: any = v.codecId ? stats.get(v.codecId) : undefined
    const codec = formatCodecName(codecEntry?.mimeType)

    return {
        video,
        hud: {
            fps: typeof v.framesPerSecond === 'number' ? Math.round(v.framesPerSecond) : 0,
            width: typeof v.frameWidth === 'number' ? v.frameWidth : 0,
            height: typeof v.frameHeight === 'number' ? v.frameHeight : 0,
            bitrateMbps,
            rttMs,
            lossPercent,
            codec,
        },
        sample: {
            videoId: String(v.id || 'video'),
            timestampMs,
            bytesReceived,
            packetsReceived,
            packetsLost,
        },
    }
}

export function useSharedStreamStats(player: any, active: boolean): SharedStreamStatsSnapshot | undefined {
    const [snapshot, setSnapshot] = useState<SharedStreamStatsSnapshot | undefined>(undefined)

    useEffect(() => {
        if (!active || !player) {
            setSnapshot(undefined)
            return
        }

        let stopped = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let previousSample: StreamStatsSample | undefined
        let previousConnection: any

        async function sample() {
            try {
                const connection = player._webrtcClient
                const stats: RTCStatsReport | undefined = await connection?.getStats?.()
                if (stopped || !stats || connection !== player._webrtcClient) {
                    return
                }
                const prev = previousConnection === connection ? previousSample : undefined
                const result = computeStreamHudMetrics(stats, prev, Date.now())
                previousConnection = connection
                previousSample = result.sample
                if (result.video) {
                    setSnapshot({
                        video: result.video,
                        hud: result.hud,
                        sampleTimestamp: Date.now(),
                    })
                }
            } catch {
                // Ignore transient errors while peer connection closes.
            } finally {
                if (!stopped) {
                    timer = setTimeout(sample, 1000)
                }
            }
        }

        void sample()

        return () => {
            stopped = true
            if (timer !== undefined) {
                clearTimeout(timer)
            }
        }
    }, [player, active])

    return snapshot
}
