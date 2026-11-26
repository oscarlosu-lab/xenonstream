import { describeIceCandidate, pathVerdict } from '../../shared/iceLog'
import Ipc from './ipc'

function emit(line: string) {
    console.log(line)
    try {
        const pending = Ipc.send('streaming', 'logPath', { message: line })
        if(pending && typeof pending.catch === 'function'){
            pending.catch(() => {})
        }
    } catch {
        // The main process writes the file. Ignore a failed send during reload.
    }
}

export function logStreamPath(line: string) {
    emit(line.startsWith('[stream-path]') ? line : `[stream-path] ${line}`)
}

export interface FilteredIceCandidatesResult {
    candidates: Array<{ candidate: string; sdpMLineIndex: number | null; sdpMid: string | null }>
    skippedTcp: number
    usedTcpFallback: boolean
}

function iceCandidateLanRank(candidateLine: string): number {
    const parts = candidateLine.trim().split(/\s+/)
    const ip = parts[4] || ''
    const typeIdx = parts.indexOf('typ')
    const typ = typeIdx >= 0 ? (parts[typeIdx + 1] || '') : ''
    const isPrivateIpv4 =
        /^10\./.test(ip) ||
        /^192\.168\./.test(ip) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)

    if (typ === 'host' && isPrivateIpv4) return 0
    if (typ === 'host') return 1
    if (typ === 'prflx' || typ === 'srflx') return 2
    if (typ === 'relay') return 3
    return 4
}

export function filterIceCandidates(iceCandidates: ArrayLike<RTCIceCandidate>): FilteredIceCandidatesResult {
    const udpCandidates: Array<{ candidate: string; sdpMLineIndex: number | null; sdpMid: string | null }> = []
    const tcpCandidates: Array<{ candidate: string; sdpMLineIndex: number | null; sdpMid: string | null }> = []

    for (const key in iceCandidates) {
        if (!Object.prototype.hasOwnProperty.call(iceCandidates, key)) {
            continue
        }
        const item = iceCandidates[key]
        if (!item) {
            continue
        }
        const line = item.candidate || ''
        const entry = {
            candidate: line,
            sdpMLineIndex: item.sdpMLineIndex,
            sdpMid: item.sdpMid,
        }
        if (/\stcp\s/i.test(line)) {
            tcpCandidates.push(entry)
        } else {
            udpCandidates.push(entry)
        }
    }

    if (udpCandidates.length > 0) {
        udpCandidates.sort((a, b) => iceCandidateLanRank(a.candidate) - iceCandidateLanRank(b.candidate))
        return {
            candidates: udpCandidates,
            skippedTcp: tcpCandidates.length,
            usedTcpFallback: false,
        }
    }

    return {
        candidates: tcpCandidates,
        skippedTcp: 0,
        usedTcpFallback: tcpCandidates.length > 0,
    }
}

export function applyLowLatencyReceivers(peer: RTCPeerConnection | undefined, quiet = false) {
    if(!peer || typeof peer.getReceivers !== 'function'){
        return
    }
    let applied = 0
    peer.getReceivers().forEach((receiver) => {
        const kind = receiver.track?.kind
        if(kind !== 'video' && kind !== 'audio'){
            return
        }
        const rtp = receiver as RTCRtpReceiver & { playoutDelayHint?: number, jitterBufferTarget?: number }
        try {
            if(kind === 'video'){
                rtp.playoutDelayHint = 0
                rtp.jitterBufferTarget = 0
                if (receiver.track && 'contentHint' in receiver.track) {
                    (receiver.track as MediaStreamTrack & { contentHint: string }).contentHint = 'motion'
                }
            } else {
                rtp.playoutDelayHint = 0.02
                rtp.jitterBufferTarget = 20
            }
            applied++
        } catch (error) {
            emit(`[stream-path] low-latency hint failed for ${kind}: ${error}`)
        }
    })
    if(!quiet && applied > 0){
        emit(`[stream-path] low-latency hints applied to ${applied} receivers`)
    }
}

export function logIceList(direction: 'local' | 'remote', candidates: Array<{ candidate?: string }>) {
    emit(`[stream-path] ${direction} candidates: ${candidates.length}`)
    candidates.forEach((item, index) => {
        emit(`[stream-path] ${direction} #${index + 1} ${describeIceCandidate(item?.candidate || '')}`)
    })
}

export function waitForLocalIce(
    peer: RTCPeerConnection | undefined,
    readCandidates: () => RTCIceCandidate[],
    timeoutMs = 4000,
    signal?: { cancelled: boolean },
): Promise<RTCIceCandidate[]> {
    if (!peer || typeof peer.addEventListener !== 'function') {
        return Promise.resolve(readCandidates())
    }
    return new Promise((resolve) => {
        let done = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (reason: string) => {
            if (done) {
                return
            }
            done = true
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
            peer.removeEventListener('icegatheringstatechange', onState)
            const candidates = readCandidates()
            if (!signal?.cancelled) {
                emit(`[stream-path] sending ${candidates.length} local candidates (${reason}, gathering=${peer.iceGatheringState})`)
                logIceList('local', candidates)
            }
            resolve(candidates)
        }

        const onState = () => {
            if (signal?.cancelled) {
                finish('cancelled')
                return
            }
            emit(`[stream-path] iceGatheringState=${peer.iceGatheringState}`)
            if (peer.iceGatheringState === 'complete') {
                finish('gathering complete')
            }
        }

        if (peer.iceGatheringState === 'complete' || signal?.cancelled) {
            finish('gathering already complete')
            return
        }

        timer = setTimeout(() => finish('timed out waiting for gathering'), timeoutMs)
        peer.addEventListener('icegatheringstatechange', onState)
    })
}

export async function logSelectedIcePath(peer: RTCPeerConnection | undefined) {
    if (!peer || typeof peer.getStats !== 'function') {
        return
    }
    const stats = await peer.getStats()
    logPlaybackTiming(stats)
    let selectedPairId = ''

    stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
            selectedPairId = report.selectedCandidatePairId
        }
    })

    const succeeded: string[] = []
    stats.forEach((report) => {
        if (report.type !== 'candidate-pair' || report.state !== 'succeeded') {
            return
        }
        const local = stats.get(report.localCandidateId)
        const remote = stats.get(report.remoteCandidateId)
        const summary = formatPair(local, remote, report)
        succeeded.push(summary)
        if (!selectedPairId && report.nominated) {
            selectedPairId = report.id
        }
    })

    emit(`[stream-path] succeeded pairs: ${succeeded.length || 0}`)
    succeeded.forEach((line) => emit(`[stream-path] pair ${line}`))

    const selected = selectedPairId ? stats.get(selectedPairId) : undefined
    if (!selected) {
        emit('[stream-path] VERDICT: no selected candidate pair yet')
        return
    }

    const local = stats.get(selected.localCandidateId)
    const remote = stats.get(selected.remoteCandidateId)
    const verdict = pathVerdict(
        local?.candidateType || '',
        candidateAddress(local),
        remote?.candidateType || '',
        candidateAddress(remote),
    )
    emit(`[stream-path] SELECTED ${formatPair(local, remote, selected)}`)
    emit(`[stream-path] VERDICT: ${verdict}`)
}

const lastTimingSample = new Map<string, { delay: number, emitted: number }>()

function logPlaybackTiming(stats: RTCStatsReport) {
    stats.forEach((report) => {
        if(report.type !== 'inbound-rtp'){
            return
        }
        const kind = report.kind || report.mediaType
        if(kind !== 'video' && kind !== 'audio'){
            return
        }
        const bufferMs = averageMs(report.jitterBufferDelay, report.jitterBufferEmittedCount)
        // The counters are cumulative since the start: the difference with the previous sample gives the current value
        const previous = lastTimingSample.get(report.id)
        const bufferNowMs = previous
            ? averageMs((report.jitterBufferDelay ?? 0) - previous.delay, (report.jitterBufferEmittedCount ?? 0) - previous.emitted)
            : null
        lastTimingSample.set(report.id, { delay: report.jitterBufferDelay ?? 0, emitted: report.jitterBufferEmittedCount ?? 0 })
        const decodeMs = kind === 'video' ? averageMs(report.totalDecodeTime, report.framesDecoded) : null
        const processingMs = kind === 'video' ? averageMs(report.totalProcessingDelay, report.framesDecoded) : null
        const jitterMs = typeof report.jitter === 'number' ? Math.round(report.jitter * 1000) : null
        const parts = [
            `[stream-path] ${kind} timing`,
            bufferNowMs !== null ? `jitterBufferNow=${bufferNowMs}ms` : '',
            bufferMs !== null ? `jitterBufferAvg=${bufferMs}ms` : '',
            jitterMs !== null ? `jitter=${jitterMs}ms` : '',
            decodeMs !== null ? `decode=${decodeMs}ms` : '',
            processingMs !== null ? `processing=${processingMs}ms` : '',
            typeof report.framesDecoded === 'number' ? `decoded=${report.framesDecoded}` : '',
            typeof report.framesDropped === 'number' ? `dropped=${report.framesDropped}` : '',
            typeof report.freezeCount === 'number' ? `freezes=${report.freezeCount}` : '',
            report.codecId && stats.get(report.codecId)?.mimeType ? `codec=${stats.get(report.codecId).mimeType}` : '',
            typeof report.frameWidth === 'number' ? `size=${report.frameWidth}x${report.frameHeight}` : '',
            typeof report.framesPerSecond === 'number' ? `fps=${report.framesPerSecond}` : '',
            typeof report.packetsLost === 'number' ? `lost=${report.packetsLost}/${(report.packetsReceived || 0) + report.packetsLost}` : '',
            typeof report.nackCount === 'number' ? `nack=${report.nackCount}` : '',
            typeof report.bytesReceived === 'number' ? `bytes=${report.bytesReceived}` : '',
        ].filter(Boolean)
        emit(parts.join(' '))
    })
}

type ConsolePlayer = {
    getEventBus: () => {
        on: (name: string, listener: (event) => void) => void
        off?: (name: string, listener: (event) => void) => void
        removeListener?: (name: string, listener: (event) => void) => void
    }
    getChannelProcessor: (name: string) => { requestKeyframeRequest?: () => void, sendTransaction?: (id: string, data) => void }
    _webrtcClient?: RTCPeerConnection
    _videoComponent?: { _videoRender?: HTMLVideoElement }
}

// The console keeps the last dashboard frame when a game takes over the screen.
// Ask for a new keyframe, and acknowledge the title change so the stream can follow it.
export function followConsolePicture(player: ConsolePlayer): () => void {
    let lastDecoded = -1
    let lastProgress = performance.now()
    let lastRequest = 0
    let sawFrames = false
    let reattached = false

    const requestKeyframe = (reason: string) => {
        try {
            player.getChannelProcessor('control')?.requestKeyframeRequest?.()
            logStreamPath(`requested a fresh video frame (${reason})`)
        } catch (error) {
            logStreamPath(`could not request a fresh video frame: ${error}`)
        }
    }

    const onMessage = (event) => {
        const type = String(event?.type || 'message')
        const target = String(event?.target || '')
        logStreamPath(`console ${type} ${target || '(no target)'}`)

        const titleChange = /titleinfo|titlechanged|ShowApplication/i.test(target)
        const needsReply = type === 'Transaction' || type === 'ReceiverRequest'
        const leaveForUser = /purchase|ShowMessageDialog/i.test(target)
        if(needsReply && event?.id && titleChange && !leaveForUser){
            try {
                player.getChannelProcessor('message')?.sendTransaction?.(event.id, { Result: 0 })
                logStreamPath(`acknowledged console request ${target}`)
            } catch (error) {
                logStreamPath(`could not acknowledge ${target}: ${error}`)
            }
        }
        if(titleChange){
            requestKeyframe('the console opened a game')
        }
    }

    player.getEventBus().on('message', onMessage)

    const timer = setInterval(async () => {
        const peer = player._webrtcClient
        if(!peer || peer.connectionState !== 'connected'){
            return
        }
        let decoded = 0
        try {
            const stats = await peer.getStats()
            stats.forEach((report) => {
                const sample = report as RTCInboundRtpStreamStats
                if(sample.type === 'inbound-rtp' && sample.kind === 'video'){
                    decoded = sample.framesDecoded || 0
                }
            })
        } catch {
            return
        }

        const now = performance.now()
        if(decoded > lastDecoded){
            lastDecoded = decoded
            lastProgress = now
            reattached = false
            if(decoded > 0){
                sawFrames = true
            }
            return
        }
        if(!sawFrames || now - lastProgress < 1500 || now - lastRequest < 3000){
            return
        }

        lastRequest = now
        const stalled = Math.round((now - lastProgress) / 1000)
        requestKeyframe(`picture frozen for ${stalled}s`)

        const video = player._videoComponent?._videoRender
        if(video && stalled >= 4 && !reattached && video.srcObject){
            reattached = true
            const source = video.srcObject
            video.srcObject = null
            video.srcObject = source
            video.play().catch(() => {})
            logStreamPath('reattached the video picture after it stayed on the previous screen')
        }
    }, 500)

    return () => {
        clearInterval(timer)
        const bus = player.getEventBus()
        if (typeof bus.off === 'function') {
            bus.off('message', onMessage)
        } else if (typeof bus.removeListener === 'function') {
            bus.removeListener('message', onMessage)
        }
    }
}

function averageMs(totalSeconds: number | undefined, count: number | undefined): number | null {
    if(typeof totalSeconds !== 'number' || typeof count !== 'number' || count <= 0){
        return null
    }
    return Math.round((totalSeconds / count) * 1000)
}

function formatPair(local, remote, pair): string {
    const rtt = typeof pair?.currentRoundTripTime === 'number' ? ` rtt=${Math.round(pair.currentRoundTripTime * 1000)}ms` : ''
    const bytes = typeof pair?.bytesReceived === 'number' ? ` in=${pair.bytesReceived}B` : ''
    return `${candidateLabel(local)} -> ${candidateLabel(remote)}${rtt}${bytes} nominated=${pair?.nominated === true}`
}

function candidateLabel(report): string {
    if (!report) {
        return '?'
    }
    const relay = report.relayProtocol ? `/${report.relayProtocol}` : ''
    return `${report.candidateType || '?'}${relay} ${candidateAddress(report)}:${report.port || '?'} ${report.protocol || '?'}`
}

function candidateAddress(report): string {
    return report?.address || report?.ip || '?'
}
