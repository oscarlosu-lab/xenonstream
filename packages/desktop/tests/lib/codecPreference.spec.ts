import {
    applyVideoCodecPreferences,
    buildVideoCodecPreferenceList,
    getCodecMimeType,
    VideoCodecCapability,
} from '../../lib/codecPreference'

describe('Video codec preference + H.264 fallback + RTX/RED/ULPFEC resilience', () => {
    const sampleCapabilities: VideoCodecCapability[] = [
        { mimeType: 'video/VP8', clockRate: 90000 },
        { mimeType: 'video/rtx', clockRate: 90000, sdpFmtpLine: 'apt=96' },
        { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' },
        { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
        { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f' },
        { mimeType: 'video/H265', clockRate: 90000 },
        { mimeType: 'video/AV1', clockRate: 90000 },
        { mimeType: 'video/red', clockRate: 90000 },
        { mimeType: 'video/ulpfec', clockRate: 90000 },
        // Duplicate entry to verify deduplication
        { mimeType: 'video/rtx', clockRate: 90000, sdpFmtpLine: 'apt=96' },
    ]

    it('maps codec identifiers to WebRTC MIME types', () => {
        expect(getCodecMimeType('h264')).toBe('video/H264')
        expect(getCodecMimeType('hevc')).toBe('video/H265')
        expect(getCodecMimeType('av1')).toBe('video/AV1')
        expect(getCodecMimeType(undefined)).toBe('video/H264')
    })

    it('orders H.264 High (4d) -> Main (42e) -> Baseline (420) and preserves RTX/RED/ULPFEC without duplicates', () => {
        const list = buildVideoCodecPreferenceList(sampleCapabilities, 'h264')
        expect(list.map((c) => c.mimeType)).toEqual([
            'video/H264',
            'video/H264',
            'video/H264',
            'video/rtx',
            'video/red',
            'video/ulpfec',
        ])
        expect(list[0].sdpFmtpLine).toContain('profile-level-id=4d')
        expect(list[1].sdpFmtpLine).toContain('profile-level-id=42e')
        expect(list[2].sdpFmtpLine).toContain('profile-level-id=420')
    })

    it('puts AV1 or HEVC first while always keeping H.264 fallback and RTX/RED/ULPFEC', () => {
        const av1List = buildVideoCodecPreferenceList(sampleCapabilities, 'av1')
        expect(av1List[0].mimeType).toBe('video/AV1')
        expect(av1List[1].sdpFmtpLine).toContain('profile-level-id=4d')
        expect(av1List.some((c) => c.mimeType === 'video/rtx')).toBe(true)
        expect(av1List.some((c) => c.mimeType === 'video/red')).toBe(true)
        expect(av1List.some((c) => c.mimeType === 'video/ulpfec')).toBe(true)

        const hevcList = buildVideoCodecPreferenceList(sampleCapabilities, 'hevc')
        expect(hevcList[0].mimeType).toBe('video/H265')
        expect(hevcList[1].sdpFmtpLine).toContain('profile-level-id=4d')
        expect(hevcList.some((c) => c.mimeType === 'video/rtx')).toBe(true)
    })

    it('gracefully falls back to H.264 + RTX/FEC when requested codec capability is absent', () => {
        const noAv1 = sampleCapabilities.filter((c) => c.mimeType !== 'video/AV1')
        const list = buildVideoCodecPreferenceList(noAv1, 'av1')
        expect(list[0].mimeType).toBe('video/H264')
        expect(list[0].sdpFmtpLine).toContain('profile-level-id=4d')
        expect(list.some((c) => c.mimeType === 'video/rtx')).toBe(true)
    })

    it('applies ordered codec preferences to the video transceiver (index 1) on xCloudPlayer', () => {
        const setCodecPreferences = jest.fn()
        const mockPlayer = {
            _webrtcClient: {
                getTransceivers: () => [
                    { receiver: { track: { kind: 'audio' } }, setCodecPreferences: jest.fn() },
                    { receiver: { track: { kind: 'video' } }, setCodecPreferences },
                ],
            },
        }

        const applied = applyVideoCodecPreferences(mockPlayer, 'av1', ['4d', '42e', '420'], sampleCapabilities)
        expect(applied.length).toBe(7)
        expect(setCodecPreferences).toHaveBeenCalledTimes(1)
        expect(setCodecPreferences).toHaveBeenCalledWith(applied)
    })

    it('is a safe no-op when capabilities or transceiver are unavailable', () => {
        expect(buildVideoCodecPreferenceList([], 'av1')).toEqual([])
        expect(applyVideoCodecPreferences(null, 'av1', [], sampleCapabilities)).toEqual([])
        expect(applyVideoCodecPreferences({ _webrtcClient: { getTransceivers: () => [] } }, 'av1', [], sampleCapabilities)).toEqual([])
    })
})
