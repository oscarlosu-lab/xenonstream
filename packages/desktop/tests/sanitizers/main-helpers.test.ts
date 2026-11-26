import { EventEmitter } from 'events'
import https from 'https'

const mockStoreGet = jest.fn((_key: string, def?: any) => def)
const mockStoreSet = jest.fn()

jest.mock('electron', () => ({
    __esModule: true,
    default: {
        app: {
            isReady: jest.fn(() => true),
            isPackaged: false,
            getVersion: jest.fn(() => '1.0.0'),
            getName: jest.fn(() => 'XenonStream'),
            getGPUInfo: jest.fn(() => Promise.resolve({ auxAttributes: { glRenderer: 'MockGL' } })),
            on: jest.fn(),
        },
        dialog: {
            showMessageBox: jest.fn(() => Promise.resolve({ response: 1 })),
        },
        shell: {
            openExternal: jest.fn(),
        },
    },
    app: {
        isReady: jest.fn(() => true),
        isPackaged: false,
        getVersion: jest.fn(() => '1.0.0'),
        getName: jest.fn(() => 'XenonStream'),
        on: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    dialog: {
        showMessageBox: jest.fn(() => Promise.resolve({ response: 1 })),
    },
    session: {
        defaultSession: { clearStorageData: jest.fn(() => Promise.resolve()) },
    },
    ipcMain: {
        on: jest.fn(),
    },
}))

jest.mock('electron-store', () => ({
    __esModule: true,
    default: jest.fn(() => ({
        get: mockStoreGet,
        set: mockStoreSet,
        delete: jest.fn(),
    })),
}))

let mockExpressApp: any
jest.mock('express', () => {
    const fn: any = jest.fn(() => mockExpressApp)
    fn.static = jest.fn(() => jest.fn())
    return {
        __esModule: true,
        default: fn,
    }
})

jest.mock('express-ws', () => ({
    __esModule: true,
    default: jest.fn(() => ({})),
}))

jest.mock('express-http-proxy', () => ({
    __esModule: true,
    default: jest.fn(() => jest.fn()),
}))

import StreamManager from '../../main/helpers/streammanager'
import Http from '../../main/helpers/http'
import xboxWorker from '../../main/helpers/xboxWorker'
import WebUI from '../../main/webui'
import IpcxCloud from '../../main/ipc/xcloud'
import { flushMicrotasks } from './testhelper'

describe('Main helpers sanitizers', () => {
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
        mockStoreGet.mockClear()
        mockStoreSet.mockClear()
    })

    afterEach(() => {
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('StreamManager cancels monitorSession timers on stopStream and handles MSAL auth and waitingTimes errors without throwing', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        const stopStreamApi = jest.fn(() => Promise.resolve({ stopped: true }))
        const getStreamState = jest.fn()
            .mockResolvedValueOnce({ state: 'WaitingForResources' })
            .mockResolvedValueOnce({ state: 'ReadyToConnect' })
        const getWaitingTimes = jest.fn(() => Promise.reject(new Error('waittime unavailable')))
        const getMsalToken = jest.fn(() => Promise.reject(new Error('msal rejected')))

        const mockApp: any = {
            log: jest.fn(),
            _xCloudApi: {
                startStream: jest.fn(() => Promise.resolve({ sessionPath: 'v5/sessions/cloud/sess1' })),
                stopStream: stopStreamApi,
                getStreamState,
                getWaitingTimes,
                sendMSALAuth: jest.fn(),
            },
            _authentication: {
                _msal: {
                    getMsalToken,
                },
            },
        }

        const manager = new StreamManager(mockApp)
        const sessionId = await manager.startStream('cloud', 'TITLE1')
        expect(sessionId).toBe('sess1')
        expect(jest.getTimerCount()).toBe(1)

        // First poll -> WaitingForResources (getWaitingTimes rejects without unhandled rejection)
        jest.advanceTimersByTime(1000)
        await flushMicrotasks()
        expect(getWaitingTimes).toHaveBeenCalledWith('TITLE1')
        expect(jest.getTimerCount()).toBe(1)

        // Second poll -> ReadyToConnect -> getMsalToken rejects (no ReferenceError: alert)
        jest.advanceTimersByTime(1000)
        await flushMicrotasks()
        expect(manager.getSession('sess1').playerState).toBe('failed')
        expect(manager.getSession('sess1').errorDetails?.code).toBe('MSALAuthError')

        // Stopping a new provisioning session immediately clears pending monitor timer
        getStreamState.mockResolvedValue({ state: 'Provisioning' })
        mockApp._xCloudApi.startStream.mockResolvedValueOnce({ sessionPath: 'v5/sessions/cloud/sess2' })
        await manager.startStream('cloud', 'TITLE2')
        expect(jest.getTimerCount()).toBe(1)

        await manager.stopStream('sess2')
        expect(jest.getTimerCount()).toBe(0)
        logSpy.mockRestore()
    })

    it('Http retries 204 responses with the original host and settles once on socket error', async () => {
        const mockApp: any = { log: jest.fn() }
        const httpClient = new Http(mockApp)

        const requestedHosts: string[] = []
        let callIndex = 0
        jest.spyOn(https, 'request').mockImplementation((options: any, cb: any) => {
            requestedHosts.push(options.host)
            const req = new EventEmitter() as any
            req.write = jest.fn()
            req.end = jest.fn(() => {
                const res = new EventEmitter() as any
                callIndex++
                res.statusCode = callIndex === 1 ? 204 : 200
                cb(res)
                if (callIndex > 1) {
                    res.emit('data', JSON.stringify({ ok: true }))
                }
                res.emit('end')
            })
            return req
        })

        const resultPromise = httpClient.get('example.xboxlive.com', '/v5/test', 'GET')
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(1)

        jest.advanceTimersByTime(750)
        await flushMicrotasks()

        await expect(resultPromise).resolves.toEqual({ ok: true })
        expect(requestedHosts).toEqual(['example.xboxlive.com', 'example.xboxlive.com'])
        expect(jest.getTimerCount()).toBe(0)
    })

    it('xboxWorker.destroy stops background polling interval', async () => {
        const mockApp: any = {
            _webApi: {
                providers: {
                    people: {
                        getFriends: jest.fn(() => Promise.resolve({ data: { people: [] } })),
                    },
                },
            },
        }

        const worker = new xboxWorker(mockApp)
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(1)

        worker.destroy()
        expect(jest.getTimerCount()).toBe(0)
    })

    it('WebUI guards missing _mainWindow, malformed WS messages, and restores IPC send on close/stopServer', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        const wsHandlers: Record<string, Function> = {}
        mockExpressApp = {
            get: jest.fn(),
            use: jest.fn(),
            ws: jest.fn((path: string, handler: Function) => {
                wsHandlers[path] = handler
            }),
            listen: jest.fn((_port: number, cb: Function) => {
                cb()
                return { close: jest.fn() }
            }),
        }

        const originalSend = jest.fn()
        const mockChannel = {
            send: originalSend,
            onEvent: jest.fn(),
        }
        const mockApp: any = {
            log: jest.fn(),
            _isProduction: false,
            _mainWindow: undefined,
            _store: {
                get: jest.fn(() => ({ webui_autostart: false, webui_port: 9003 })),
                set: jest.fn(),
            },
            _ipc: {
                _channels: {
                    app: mockChannel,
                },
            },
        }

        const webui = new WebUI(mockApp)
        mockApp._webUI = webui
        webui.startServer(9003)

        const socket = new EventEmitter() as any
        socket.readyState = 1
        socket.send = jest.fn()
        socket.close = jest.fn()

        wsHandlers['/ipc'](socket)

        // Hooked send works even when _mainWindow is undefined
        expect(() => mockChannel.send('app', { id: 1, action: 'ping', data: 'ok' })).not.toThrow()
        expect(socket.send).toHaveBeenCalledTimes(1)

        // Malformed JSON is ignored safely
        expect(() => socket.emit('message', '{bad-json')).not.toThrow()
        // Valid message on unknown channel is ignored safely
        expect(() => socket.emit('message', JSON.stringify({ channel: 'missing', action: 'noop' }))).not.toThrow()
        // Valid message forwards to onEvent
        socket.emit('message', JSON.stringify({ channel: 'app', action: 'getAuthState', id: 5, data: {} }))
        expect(mockChannel.onEvent).toHaveBeenCalledTimes(1)

        // Closing socket restores original IPC send
        socket.emit('close')
        expect(mockChannel.send).toBe(originalSend)

        webui.stopServer()
        expect(mockChannel.send).toBe(originalSend)
        logSpy.mockRestore()
    })

    it('IpcxCloud.getTitle avoids polling timers and rejects cleanly without a token', async () => {
        const mockApp: any = { log: jest.fn() }
        const ipcXcloud = new IpcxCloud(mockApp)

        const titlePromise = ipcXcloud.getTitle({ titleId: 'GAME1' })
        expect(jest.getTimerCount()).toBe(0)
        await expect(titlePromise).rejects.toThrow('Cannot load xCloud titles without a valid token')

        ipcXcloud.destroy()
        expect(jest.getTimerCount()).toBe(0)
    })
})
