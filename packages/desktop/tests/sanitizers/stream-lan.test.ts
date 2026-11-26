import os from 'os'

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: jest.fn(() => os.tmpdir()),
        getAppMetrics: jest.fn(() => [
            { pid: process.pid, type: 'Browser' },
            { pid: 4001, type: 'GPU' },
            { pid: 4002, type: 'Tab' },
            { pid: 4003, type: 'Utility' },
        ]),
    },
    powerSaveBlocker: {
        start: jest.fn(() => 42),
        isStarted: jest.fn(() => true),
        stop: jest.fn(),
    },
}))

jest.mock('../../main/helpers/streamPathFile', () => ({
    appendStreamPathLog: jest.fn(),
}))

import { acquireStreamPerformance, releaseStreamPerformance } from '../../main/helpers/streamPerformance'
import { filterIceCandidates } from '../../renderer/lib/streamPath'

describe('W2.1 LAN & Windows stream performance fixes', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('streamPerformance uses ONLY PRIORITY_ABOVE_NORMAL (never PRIORITY_HIGH) and restores elevated PIDs to PRIORITY_NORMAL', () => {
        const setPrioritySpy = jest.spyOn(os, 'setPriority').mockImplementation(() => {})

        acquireStreamPerformance()

        const acquireCalls = setPrioritySpy.mock.calls
        expect(acquireCalls).toEqual([
            [process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL],
            [4001, os.constants.priority.PRIORITY_ABOVE_NORMAL],
            [4002, os.constants.priority.PRIORITY_ABOVE_NORMAL],
        ])
        expect(acquireCalls.some(([, level]) => level === os.constants.priority.PRIORITY_HIGH)).toBe(false)

        setPrioritySpy.mockClear()
        releaseStreamPerformance()

        expect(setPrioritySpy.mock.calls).toEqual([
            [process.pid, os.constants.priority.PRIORITY_NORMAL],
            [4001, os.constants.priority.PRIORITY_NORMAL],
            [4002, os.constants.priority.PRIORITY_NORMAL],
        ])
    })

    test('filterIceCandidates drops TCP when UDP candidates exist', () => {
        const result = filterIceCandidates([
            { candidate: 'candidate:1 1 udp 2122260223 10.0.0.50 51234 typ host', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
            { candidate: 'candidate:2 1 tcp 1518280447 10.0.0.50 9 typ host tcptype active', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
        ])
        expect(result.candidates).toHaveLength(1)
        expect(result.candidates[0].candidate).toContain(' udp ')
        expect(result.skippedTcp).toBe(1)
        expect(result.usedTcpFallback).toBe(false)
    })

    test('filterIceCandidates falls back to TCP when zero UDP candidates exist', () => {
        const result = filterIceCandidates([
            { candidate: 'candidate:2 1 tcp 1518280447 10.0.0.50 9 typ host tcptype active', sdpMLineIndex: 0, sdpMid: '0' } as RTCIceCandidate,
        ])
        expect(result.candidates).toHaveLength(1)
        expect(result.candidates[0].candidate).toContain(' tcp ')
        expect(result.skippedTcp).toBe(0)
        expect(result.usedTcpFallback).toBe(true)
    })
})
