import { EventEmitter } from 'events'
import { BrowserEnvHandle, createHookHarness, findElementByType, flushMicrotasks, setupBrowserEnv } from './testhelper'

let currentServerId = 'xcloud_GAME123'
let currentSettings: any = {
    xcloud_bitrate: 10000,
    xhome_bitrate: 8000,
    video_profiles: ['4d'],
    video_size: 'stretch',
    video_enabled: true,
    audio_enabled: true,
    controller_vibration: true,
    input_touch: true,
    input_mousekeyboard: true,
    input_newgamepad: false,
    input_mousekeyboard_config: {
        Enter: 'A',
        a: 'A',
        Backspace: 'B',
        n: 'Nexus',
    },
}

const mockIpcSend = jest.fn()
const mockIpcOn = jest.fn()
const mockIpcOnAction = jest.fn()
const mockIpcRemoveListener = jest.fn()
const createdUplots: Array<{ setData: jest.Mock; destroy: jest.Mock }> = []
const createdPlayers: any[] = []

jest.mock('next/head', () => ({
    __esModule: true,
    default: ({ children }: any) => children,
}))

jest.mock('next/router', () => ({
    __esModule: true,
    useRouter: () => ({
        query: { serverid: currentServerId },
    }),
}))

jest.mock('react-i18next', () => ({
    __esModule: true,
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

jest.mock('../../renderer/context/userContext', () => ({
    __esModule: true,
    useSettings: () => ({
        settings: currentSettings,
    }),
}))

jest.mock('../../renderer/lib/ipc', () => ({
    __esModule: true,
    default: {
        send: (...args: any[]) => mockIpcSend(...args),
        on: (...args: any[]) => mockIpcOn(...args),
        onAction: (...args: any[]) => mockIpcOnAction(...args),
        removeListener: (...args: any[]) => mockIpcRemoveListener(...args),
    },
}))

jest.mock('uplot', () => ({
    __esModule: true,
    default: jest.fn(() => {
        const instance = {
            setData: jest.fn(),
            destroy: jest.fn(),
        }
        createdUplots.push(instance)
        return instance
    }),
}))

jest.mock('xbox-xcloud-player', () => {
    const MockPlayer = jest.fn(function (this: any, elementId: string, config: any) {
        const eventBus = new EventEmitter()
        const chatProcessor = {
            isPaused: true,
            startMic: jest.fn(() => {
                chatProcessor.isPaused = false
            }),
            stopMic: jest.fn(() => {
                chatProcessor.isPaused = true
            }),
        }
        const inputProcessor: any = {
            pressButton: jest.fn(),
        }

        const instance = {
            _elementId: elementId,
            _config: config,
            _inputDriver: config?.input_driver,
            _eventBus: eventBus,
            _webrtcClient: {
                getStats: jest.fn(() => Promise.resolve(new Map())),
            },
            _audioComponent: {
                _audioRender: { muted: false },
            },
            _videoComponent: {
                _videoRender: { style: { opacity: '1' } },
            },
            bind: jest.fn(),
            close: jest.fn(),
            setVideoBitrate: jest.fn(),
            setCodecPreferences: jest.fn(),
            setControllerRumble: jest.fn(),
            setSdpHandler: jest.fn(),
            createOffer: jest.fn(() => Promise.resolve({ sdp: 'v=0\r\n' })),
            setRemoteOffer: jest.fn(),
            getIceCandidates: jest.fn(() => []),
            setIceCandidates: jest.fn(),
            getEventBus: jest.fn(() => eventBus),
            getChannelProcessor: jest.fn((name: string) => {
                if (name === 'chat') {
                    return chatProcessor
                }
                if (name === 'input') {
                    return inputProcessor
                }
                return undefined
            }),
        }
        inputProcessor._client = instance
        createdPlayers.push(instance)
        return instance
    })

    return {
        __esModule: true,
        default: MockPlayer,
    }
})

import xCloudPlayer from 'xbox-xcloud-player'
import Stream from '../../renderer/pages/stream/[serverid]'
import StreamComponent from '../../renderer/components/ui/streamcomponent'
import StreamDebug from '../../renderer/components/ui/stream-debug'
import StreamPreload from '../../renderer/components/ui/streampreload'

describe('Stream integration sanitizers', () => {
    let env: BrowserEnvHandle
    let harness: ReturnType<typeof createHookHarness>

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
        env = setupBrowserEnv()
        harness = createHookHarness()
        mockIpcSend.mockReset()
        mockIpcOn.mockReset()
        mockIpcOnAction.mockReset()
        mockIpcRemoveListener.mockReset()
        createdUplots.length = 0
        createdPlayers.length = 0
        currentServerId = 'xcloud_GAME123'
        currentSettings = {
            xcloud_bitrate: 10000,
            xhome_bitrate: 8000,
            video_profiles: ['4d'],
            video_size: 'stretch',
            video_enabled: true,
            audio_enabled: true,
            controller_vibration: true,
            input_touch: true,
            input_mousekeyboard: true,
            input_newgamepad: false,
            input_mousekeyboard_config: {
                Enter: 'A',
                a: 'A',
                Backspace: 'B',
                n: 'Nexus',
            },
        }
    })

    afterEach(() => {
        harness.dispose()
        env.restore()
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('StreamPreload runs a single countdown interval and cleans up on unmount', async () => {
        env.registerElement('component_streamcomponent_waitingtimes')

        const onDisconnect = jest.fn()
        const mounted = harness.mount(StreamPreload, {
            onDisconnect,
            waitingTime: 3,
        })

        expect(jest.getTimerCount()).toBe(1)

        env.registerElement('component_streamcomponent_waitingtimes_seconds')

        jest.advanceTimersByTime(1000)
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(1)

        jest.advanceTimersByTime(2000)
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(0)

        mounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
    })

    it('Stream integrates with xbox-xcloud-player 0.2.11 and releases timers, listeners, and charts on unmount', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        env.registerElement('streamComponentHolder')
        env.registerElement('component_streamcomponent_connectionstatus')
        env.registerElement('component_streamcomponent_loader')
        env.registerElement('component_streamcomponent_waitingtimes')
        env.registerElement('component_streamcomponent_debug')
        env.registerElement('component_streamcomponent_debug_text')
        env.registerElement('component_streamcomponent_debug_webrtc_jitter')
        env.registerElement('component_streamcomponent_debug_webrtc_dropped')
        env.registerElement('component_streamcomponent_gamebar')

        let playerStateCall = 0
        mockIpcSend.mockImplementation((channel: string, action: string) => {
            if (channel === 'streaming' && action === 'startStream') {
                return Promise.resolve('session-abc')
            }
            if (channel === 'streaming' && action === 'getPlayerState') {
                playerStateCall++
                if (playerStateCall === 1) {
                    return Promise.resolve({ playerState: 'pending' })
                }
                return Promise.resolve({ playerState: 'started' })
            }
            if (channel === 'streaming' && action === 'sendSdp') {
                return Promise.resolve({ sdp: 'v=0\r\n' })
            }
            if (channel === 'streaming' && action === 'sendIce') {
                return Promise.resolve([])
            }
            if (channel === 'streaming' && action === 'sendKeepalive') {
                return Promise.resolve({ status: 'ok' })
            }
            if (channel === 'streaming' && action === 'stopStream') {
                return Promise.resolve({ status: 'ok' })
            }
            return Promise.resolve({})
        })

        let queueCallback: ((event: any, waitingTimes: any) => void) | undefined
        mockIpcOnAction.mockImplementation((_channel: string, action: string, cb: any) => {
            if (action === 'onQueue') {
                queueCallback = cb
            }
            return { action, index: 0 }
        })

        const streamMounted = harness.mount(Stream, {})
        await flushMicrotasks()

        jest.advanceTimersByTime(1000)
        await flushMicrotasks()
        jest.advanceTimersByTime(1000)
        await flushMicrotasks()

        const streamComponentEl = findElementByType(streamMounted.getOutput(), StreamComponent)
        expect(streamComponentEl).toBeDefined()

        const player = createdPlayers[0]
        expect(player).toBeDefined()
        expect(player.bind).toHaveBeenCalledTimes(1)
        expect(player.setVideoBitrate).toHaveBeenCalledWith(10000)

        const componentMounted = harness.mount(StreamComponent, streamComponentEl.props)

        streamComponentEl.props.onMenu()
        expect(player._inputDriver._nexusOverrideN).toBe(true)
        jest.advanceTimersByTime(150)
        expect(player._inputDriver._nexusOverrideN).toBe(false)

        player.getEventBus().emit('connectionstate', { state: 'connected' })
        jest.advanceTimersByTime(30000)
        await flushMicrotasks()
        expect(mockIpcSend).toHaveBeenCalledWith('streaming', 'sendKeepalive', { sessionId: 'session-abc' })

        expect(queueCallback).toBeDefined()
        queueCallback!({}, { estimatedTotalWaitTimeInSeconds: 5 })
        env.registerElement('component_streamcomponent_waitingtimes_seconds')
        queueCallback!({}, { estimatedTotalWaitTimeInSeconds: 0 })

        // Debug stats are on-demand: no uPlot charts created while debug panel is closed
        expect(createdUplots).toHaveLength(0)

        const debugMounted = harness.mount(StreamDebug, { player })
        await flushMicrotasks()
        expect(createdUplots).toHaveLength(2)
        debugMounted.unmount()
        for (const chart of createdUplots) {
            expect(chart.destroy).toHaveBeenCalledTimes(1)
        }

        componentMounted.unmount()
        expect(mockIpcRemoveListener).toHaveBeenCalledWith('streaming', { action: 'onQueue', index: 0 })

        streamMounted.unmount()
        expect(player.getEventBus().listenerCount('connectionstate')).toBe(0)
        expect(player.close).toHaveBeenCalledTimes(1)
        expect(jest.getTimerCount()).toBe(0)
        logSpy.mockRestore()
    })

    it('ignores in-flight SDP/ICE responses after unmount and avoids unhandled rejection when failing before sessionId', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        env.registerElement('streamComponentHolder')

        let resolveSdp!: (val: any) => void
        const pendingSdp = new Promise((resolve) => {
            resolveSdp = resolve
        })

        mockIpcSend.mockImplementation((_channel: string, action: string) => {
            if (action === 'startStream') {
                return Promise.resolve('session-unmount')
            }
            if (action === 'getPlayerState') {
                return Promise.resolve({ playerState: 'started' })
            }
            if (action === 'sendSdp') {
                return pendingSdp
            }
            return Promise.resolve({})
        })

        const mounted = harness.mount(Stream, {})
        await flushMicrotasks()
        jest.advanceTimersByTime(1000)
        await flushMicrotasks()

        const player = createdPlayers[0]
        expect(player).toBeDefined()

        mounted.unmount()
        resolveSdp({ sdp: 'v=0\r\n' })
        await flushMicrotasks()

        expect(player.setRemoteOffer).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(0)

        mockIpcSend.mockReset()
        mockIpcSend.mockImplementation((_channel: string, action: string) => {
            if (action === 'startStream') {
                return Promise.resolve('')
            }
            if (action === 'getPlayerState') {
                return Promise.resolve({
                    playerState: 'failed',
                    state: 'Failed',
                    errorDetails: { code: 'TestErr', message: 'Boom' },
                })
            }
            return Promise.reject(new Error('should not stop empty session'))
        })

        const preloadMounted = harness.mount(Stream, {})
        await flushMicrotasks()
        const preloadEl = findElementByType(preloadMounted.getOutput(), StreamPreload)
        preloadEl.props.onDisconnect()
        await flushMicrotasks()
        expect(mockIpcSend).not.toHaveBeenCalledWith('streaming', 'stopStream', expect.anything())

        preloadMounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
        logSpy.mockRestore()
    })

    it('StreamComponent handles mic toggle and _webrtcClient.getStats errors cleanly without leaks', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        env.registerElement('streamComponentHolder')
        env.registerElement('component_streamcomponent_debug')
        env.registerElement('component_streamcomponent_debug_webrtc_jitter')
        env.registerElement('component_streamcomponent_debug_webrtc_dropped')
        env.registerElement('component_streamcomponent_waitingtimes')

        mockIpcOnAction.mockReturnValue({ action: 'onQueue', index: 0 })

        const fakeTrack = { stop: jest.fn() }
        const fakeStream = { getTracks: () => [fakeTrack], getAudioTracks: () => [fakeTrack] }
        const origNavigator = (global as any).navigator
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: {
                mediaDevices: {
                    enumerateDevices: jest.fn(() => Promise.resolve([])),
                    getUserMedia: jest.fn(() => Promise.resolve(fakeStream)),
                    addEventListener: jest.fn(),
                    removeEventListener: jest.fn(),
                },
            },
        })

        const player = new (xCloudPlayer as any)('streamComponent', {})
        player._webrtcClient.getStats = jest.fn(() => Promise.reject(new Error('closed')))
        player._webrtcClient.addTrack = jest.fn()
        player.sdpNegotiationChat = jest.fn()

        const mounted = harness.mount(StreamComponent, {
            xPlayer: player,
            onDisconnect: jest.fn(),
            onMenu: jest.fn(),
        })

        jest.advanceTimersByTime(100)
        await flushMicrotasks()

        const findButtonByTitle = (node: any, title: string): any => {
            if (!node || typeof node !== 'object') return undefined
            if (node.props?.title === title) return node
            const ch = node.props?.children
            if (Array.isArray(ch)) {
                for (const c of ch) {
                    const m = findButtonByTitle(c, title)
                    if (m) return m
                }
            } else if (ch) {
                return findButtonByTitle(ch, title)
            }
            return undefined
        }

        const micButtonOn = findButtonByTitle(mounted.getOutput(), 'streamWindow.enableMic')
        expect(micButtonOn).toBeDefined()
        micButtonOn.props.onClick({ target: { blur: jest.fn() } })
        await flushMicrotasks()
        expect(player._webrtcClient.addTrack).toHaveBeenCalledTimes(1)
        expect(player.sdpNegotiationChat).toHaveBeenCalledTimes(1)

        const micButtonOff = findButtonByTitle(mounted.getOutput(), 'streamWindow.disableMic')
        expect(micButtonOff).toBeDefined()
        micButtonOff.props.onClick({ target: { blur: jest.fn() } })
        expect(player.getChannelProcessor('chat').stopMic).toHaveBeenCalledTimes(1)
        expect(fakeTrack.stop).toHaveBeenCalledTimes(1)

        mounted.unmount()
        player.close()
        Object.defineProperty(global, 'navigator', { configurable: true, value: origNavigator })
        expect(jest.getTimerCount()).toBe(0)
        logSpy.mockRestore()
    })

    it('Stream.onDisconnect sends stopStream at most once per session even when closed event fires afterwards', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        env.registerElement('streamComponentHolder')
        env.registerElement('component_streamcomponent_connectionstatus')
        env.registerElement('component_streamcomponent_loader')

        mockIpcSend.mockImplementation((_channel: string, action: string) => {
            if (action === 'startStream') {
                return Promise.resolve('sess-idem-1')
            }
            if (action === 'getPlayerState') {
                return Promise.resolve({ playerState: 'started', state: 'Provisioned' })
            }
            if (action === 'sendSdp') {
                return Promise.resolve({ sdp: 'v=0\r\n' })
            }
            if (action === 'sendIce') {
                return Promise.resolve([])
            }
            return Promise.resolve(true)
        })

        const mounted = harness.mount(Stream, {})
        await flushMicrotasks()
        jest.advanceTimersByTime(1000)
        await flushMicrotasks()

        const streamEl = findElementByType(mounted.getOutput(), StreamComponent)
        const player = streamEl.props.xPlayer

        // User clicks Disconnect -> stopStream #1
        streamEl.props.onDisconnect()
        await flushMicrotasks()

        // Connection transitions to 'closed' -> handler calls onDisconnect() again -> must NOT send a 2nd stopStream
        player.getEventBus().emit('connectionstate', { state: 'closed' })
        await flushMicrotasks()

        const stopCalls = mockIpcSend.mock.calls.filter(
            ([ch, act]) => ch === 'streaming' && act === 'stopStream'
        )
        expect(stopCalls).toHaveLength(1)

        mounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
        logSpy.mockRestore()
    })

    it('StreamComponent gamebar chevron toggle hides and restores the top menu bar immediately', async () => {
        const gamebarEl = env.registerElement('component_streamcomponent_gamebar')
        const fakePlayer: any = {
            close: jest.fn(),
            getChannelProcessor: jest.fn(() => ({ stopMic: jest.fn() })),
            _webrtcClient: { getStats: jest.fn(() => Promise.resolve(new Map())) },
        }

        const mounted = harness.mount(StreamComponent, { xPlayer: fakePlayer })
        await flushMicrotasks()

        const findById = (node: any, id: string): any => {
            if (!node || typeof node !== 'object') return undefined
            if (node.props?.id === id) return node
            const ch = node.props?.children
            if (Array.isArray(ch)) {
                for (const c of ch) {
                    const m = findById(c, id)
                    if (m) return m
                }
            } else if (ch) {
                return findById(ch, id)
            }
            return undefined
        }

        const toggleBtn = findById(mounted.getOutput(), 'component_streamcomponent_gamebar_toggle')
        expect(toggleBtn).toBeDefined()
        expect(toggleBtn.props['aria-controls']).toBe('component_streamcomponent_gamebar')
        expect(gamebarEl.className).toBe('')

        // Click to collapse immediately without waiting for 2000ms auto-hide
        toggleBtn.props.onClick({ currentTarget: { blur: jest.fn() }, stopPropagation: jest.fn() })
        expect(gamebarEl.className).toBe('hidden')

        // Mouse movement while manually collapsed must NOT re-open the bar
        env.dispatchWindowEvent('mousemove', {})
        jest.advanceTimersByTime(300)
        expect(gamebarEl.className).toBe('hidden')

        // Click again to expand immediately
        const expandBtn = findById(mounted.getOutput(), 'component_streamcomponent_gamebar_toggle')
        expandBtn.props.onClick({ currentTarget: { blur: jest.fn() }, stopPropagation: jest.fn() })
        expect(gamebarEl.className).toBe('')

        mounted.unmount()
        expect(jest.getTimerCount()).toBe(0)
    })
})
