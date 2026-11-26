import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import uPlot from 'uplot'
import type XCloudPlayer from 'xbox-xcloud-player'
import type { SharedStreamStatsSnapshot } from '../../lib/streamStats'

const sampleIntervalMs = 1000
const historyLength = 40

const chartOptions = {
    class: 'debug-chart',
    width: 600,
    height: 230,
    scales: { x: { time: false } },
}

export default function StreamDebug({
    player,
    sharedSnapshot,
    useSharedStats = false,
}: {
    player: XCloudPlayer
    sharedSnapshot?: SharedStreamStatsSnapshot
    useSharedStats?: boolean
}) {
    const { t } = useTranslation()
    const jitterHost = useRef<HTMLDivElement>(null)
    const dropsHost = useRef<HTMLDivElement>(null)
    const [report, setReport] = useState<RTCInboundRtpStreamStats>()
    const plotSeriesRef = useRef<{
        time: number[]
        jitter: number[]
        packets: number[]
        frames: number[]
        jitterData: uPlot.AlignedData
        dropsData: uPlot.AlignedData
        jitterPlot: uPlot
        dropsPlot: uPlot
        previous?: RTCInboundRtpStreamStats
        previousConnection?: RTCPeerConnection
    } | null>(null)

    useEffect(() => {
        const time: number[] = []
        const jitter: number[] = []
        const packets: number[] = []
        const frames: number[] = []
        const jitterData: uPlot.AlignedData = [time, jitter]
        const dropsData: uPlot.AlignedData = [time, packets, frames]

        const jitterPlot = new uPlot({
            ...chartOptions,
            title: 'Jitter (ms)',
            series: [{}, { label: 'Jitter', stroke: 'red', width: 2, fill: 'rgba(255, 0, 0, 0.3)' }],
            axes: [{}, { size: 50, stroke: 'red', values: (_, values) => values.map(value => value.toFixed(1)) }],
        }, jitterData, jitterHost.current)
        const dropsPlot = new uPlot({
            ...chartOptions,
            title: 'Packets lost / Frames dropped',
            series: [
                {},
                { label: 'Packets lost', stroke: 'green', width: 2, fill: 'rgba(0, 255, 0, 0.3)' },
                { label: 'Frames dropped', stroke: 'blue', width: 2, fill: 'rgba(0, 0, 255, 0.3)' },
            ],
            axes: [{}, { size: 50, values: (_, values) => values.map(value => value.toFixed(0)) }],
        }, dropsData, dropsHost.current)

        const state = {
            time,
            jitter,
            packets,
            frames,
            jitterData,
            dropsData,
            jitterPlot,
            dropsPlot,
            previous: undefined as RTCInboundRtpStreamStats | undefined,
            previousConnection: undefined as RTCPeerConnection | undefined,
        }
        plotSeriesRef.current = state

        const pushVideoSample = (video: RTCInboundRtpStreamStats, connection?: RTCPeerConnection) => {
            if (time.length === historyLength) {
                time.shift()
                jitter.shift()
                packets.shift()
                frames.shift()
            }
            const sameStream = state.previousConnection === connection && state.previous?.id === video.id
            time.push(performance.now() / 1000)
            jitter.push((video.jitter ?? 0) * 1000)
            packets.push(sameStream ? Math.max(0, (video.packetsLost ?? 0) - (state.previous!.packetsLost ?? 0)) : 0)
            frames.push(sameStream ? Math.max(0, (video.framesDropped ?? 0) - (state.previous!.framesDropped ?? 0)) : 0)
            state.previous = video
            state.previousConnection = connection

            jitterPlot.setData(jitterData)
            dropsPlot.setData(dropsData)
            setReport(video)
        }

        if (useSharedStats) {
            return () => {
                plotSeriesRef.current = null
                jitterPlot.destroy()
                dropsPlot.destroy()
            }
        }

        let timer: ReturnType<typeof setTimeout> | undefined
        let stopped = false

        async function sample() {
            try {
                const connection = player._webrtcClient
                const stats = await connection?.getStats()
                if (stopped || !stats || connection !== player._webrtcClient) return

                let video: RTCInboundRtpStreamStats | undefined
                stats.forEach(entry => {
                    if (entry.type === 'inbound-rtp' && entry.kind === 'video' &&
                        (!video || (entry.framesDecoded ?? 0) > (video.framesDecoded ?? 0))) {
                        video = entry
                    }
                })
                if (!video) return

                pushVideoSample(video, connection)
            } catch {
                // The peer connection may close between samples.
            } finally {
                if (!stopped) timer = setTimeout(sample, sampleIntervalMs)
            }
        }

        void sample()
        return () => {
            stopped = true
            plotSeriesRef.current = null
            if (timer !== undefined) clearTimeout(timer)
            jitterPlot.destroy()
            dropsPlot.destroy()
        }
    }, [player, useSharedStats])

    useEffect(() => {
        if (!useSharedStats || !sharedSnapshot?.video || !plotSeriesRef.current) {
            return
        }
        const state = plotSeriesRef.current
        const video = sharedSnapshot.video
        const connection = player._webrtcClient
        if (state.time.length === historyLength) {
            state.time.shift()
            state.jitter.shift()
            state.packets.shift()
            state.frames.shift()
        }
        const sameStream = state.previousConnection === connection && state.previous?.id === video.id
        state.time.push(performance.now() / 1000)
        state.jitter.push((video.jitter ?? 0) * 1000)
        state.packets.push(sameStream ? Math.max(0, (video.packetsLost ?? 0) - (state.previous!.packetsLost ?? 0)) : 0)
        state.frames.push(sameStream ? Math.max(0, (video.framesDropped ?? 0) - (state.previous!.framesDropped ?? 0)) : 0)
        state.previous = video
        state.previousConnection = connection

        state.jitterPlot.setData(state.jitterData)
        state.dropsPlot.setData(state.dropsData)
        setReport(video)
    }, [useSharedStats, sharedSnapshot, player])

    return (
        <div id="component_streamcomponent_debug">
            <p>{t('streamWindow.debugTitle')}:</p>
            <div id="component_streamcomponent_debug_webrtc_jitter" ref={jitterHost} />
            <div id="component_streamcomponent_debug_webrtc_dropped" ref={dropsHost} />
            <div id="component_streamcomponent_debug_text">
                {report && Object.entries(report).map(([name, value]) => (
                    <div key={name}><strong>{name}:</strong> {String(value)}</div>
                ))}
            </div>
        </div>
    )
}
