export type PreferredVideoCodec = 'h264' | 'hevc' | 'av1'

export interface VideoCodecCapability {
    mimeType: string
    clockRate?: number
    sdpFmtpLine?: string
    channels?: number
}

export const DEFAULT_H264_PROFILES = ['4d', '42e', '420']
const RESILIENCE_MIME_TYPES = new Set(['video/rtx', 'video/red', 'video/ulpfec'])

export function getCodecMimeType(codec?: string): string {
    switch ((codec || '').toLowerCase()) {
        case 'av1':
            return 'video/AV1'
        case 'hevc':
        case 'h265':
            return 'video/H265'
        default:
            return 'video/H264'
    }
}

function codecKey(codec: VideoCodecCapability): string {
    return `${(codec.mimeType || '').toLowerCase()}|${codec.clockRate ?? ''}|${codec.sdpFmtpLine ?? ''}`
}

function matchesH264Profile(codec: VideoCodecCapability, profilePrefix: string): boolean {
    if ((codec.mimeType || '').toLowerCase() !== 'video/h264') {
        return false
    }
    const fmtp = (codec.sdpFmtpLine || '').toLowerCase()
    return fmtp.includes(`profile-level-id=${profilePrefix.toLowerCase()}`)
}

/**
 * Builds an ordered RTCRtpCodecCapability preference list that preserves:
 * 1. Chosen codec (AV1 / HEVC / H.264) when supported by browser capabilities
 * 2. H.264 fallback ordered by profile priority (High 4d -> Main 42e -> Baseline 420)
 * 3. Packet-loss resilience codecs (video/rtx, video/red, video/ulpfec)
 *
 * Unlike xbox-xcloud-player's built-in setCodecPreferences(), this never strips
 * fallback codecs or RTX/RED/ULPFEC retransmission/FEC capabilities.
 */
export function buildVideoCodecPreferenceList(
    availableCodecs: VideoCodecCapability[] | undefined | null,
    preferredCodec?: string,
    h264Profiles?: string[],
): VideoCodecCapability[] {
    if (!Array.isArray(availableCodecs) || availableCodecs.length === 0) {
        return []
    }

    const ordered: VideoCodecCapability[] = []
    const seen = new Set<string>()
    const add = (codec: VideoCodecCapability) => {
        const key = codecKey(codec)
        if (!seen.has(key)) {
            seen.add(key)
            ordered.push(codec)
        }
    }

    const preferredMime = getCodecMimeType(preferredCodec).toLowerCase()

    // 1. Chosen non-H.264 codec first (if supported by getCapabilities)
    if (preferredMime !== 'video/h264') {
        for (const codec of availableCodecs) {
            if ((codec.mimeType || '').toLowerCase() === preferredMime) {
                add(codec)
            }
        }
    }

    // 2. H.264 in profile priority order (user-selected profile first, then High/Main/Baseline fallback)
    const profileOrder: string[] = []
    for (const p of [...(h264Profiles || []), ...DEFAULT_H264_PROFILES]) {
        if (p && !profileOrder.includes(p)) {
            profileOrder.push(p)
        }
    }

    for (const profile of profileOrder) {
        for (const codec of availableCodecs) {
            if (matchesH264Profile(codec, profile)) {
                add(codec)
            }
        }
    }
    for (const codec of availableCodecs) {
        if ((codec.mimeType || '').toLowerCase() === 'video/h264') {
            add(codec)
        }
    }

    // 3. Keep RTX / RED / ULPFEC for packet retransmission and FEC resilience
    for (const codec of availableCodecs) {
        if (RESILIENCE_MIME_TYPES.has((codec.mimeType || '').toLowerCase())) {
            add(codec)
        }
    }

    return ordered
}

export function applyVideoCodecPreferences(
    peerOrPlayer: any,
    preferredCodec?: string,
    h264Profiles?: string[],
    overrideCapabilities?: VideoCodecCapability[],
): VideoCodecCapability[] {
    const peer = peerOrPlayer?._webrtcClient ?? peerOrPlayer
    if (!peer || typeof peer.getTransceivers !== 'function') {
        return []
    }

    const capabilities = overrideCapabilities
        ?? (typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function'
            ? (RTCRtpReceiver.getCapabilities('video')?.codecs as VideoCodecCapability[] | undefined)
            : undefined)

    const ordered = buildVideoCodecPreferenceList(capabilities, preferredCodec, h264Profiles)
    if (ordered.length === 0) {
        return []
    }

    const transceivers = peer.getTransceivers()
    const videoTransceiver = transceivers.find((t: any) => t?.receiver?.track?.kind === 'video') || transceivers[1]
    if (!videoTransceiver || typeof videoTransceiver.setCodecPreferences !== 'function') {
        return []
    }

    try {
        videoTransceiver.setCodecPreferences(ordered)
        return ordered
    } catch (error) {
        console.log('applyVideoCodecPreferences: failed to apply codec preferences:', error)
        return []
    }
}
