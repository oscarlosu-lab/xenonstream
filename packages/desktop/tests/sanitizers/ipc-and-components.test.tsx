import { BrowserEnvHandle, createHookHarness, flushMicrotasks, setupBrowserEnv } from './testhelper'

const mockIpcRendererSend = jest.fn()
const mockIpcRendererListeners: Record<string, Set<Function>> = {}
const mockContextBridgeExpose = jest.fn()

jest.mock('electron', () => ({
    __esModule: true,
    ipcRenderer: {
        send: (...args: any[]) => mockIpcRendererSend(...args),
        on: jest.fn((channel: string, cb: Function) => {
            if (!mockIpcRendererListeners[channel]) {
                mockIpcRendererListeners[channel] = new Set()
            }
            mockIpcRendererListeners[channel].add(cb)
        }),
        removeListener: jest.fn((channel: string, cb: Function) => {
            mockIpcRendererListeners[channel]?.delete(cb)
        }),
    },
    contextBridge: {
        exposeInMainWorld: (...args: any[]) => mockContextBridgeExpose(...args),
    },
    shell: {
        openExternal: jest.fn(),
    },
}))

const mockComponentIpcSend = jest.fn()
jest.mock('../../renderer/lib/ipc', () => ({
    __esModule: true,
    default: {
        send: (...args: any[]) => mockComponentIpcSend(...args),
        on: jest.fn(),
        onAction: jest.fn(),
        removeListener: jest.fn(),
    },
}))

jest.mock('next/head', () => ({
    __esModule: true,
    default: ({ children }: any) => children,
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
        settings: {
            webui_autostart: false,
            webui_port: 9003,
            controller_vibration: true,
            input_touch: false,
            input_mousekeyboard: false,
            input_newgamepad: false,
            input_mousekeyboard_config: {},
        },
        setSettings: jest.fn(),
    }),
}))

jest.mock('../../renderer/components/settings/sidebar', () => ({
    __esModule: true,
    default: ({ children }: any) => children,
}))

import { Preload } from '../../main/preload'
import WebsocketIPC from '../../renderer/lib/websocket'
import SidebarFriends from '../../renderer/components/sidebar/friends'
import SettingsWebUI from '../../renderer/pages/settings/webui'
import SettingsInput from '../../renderer/pages/settings/input'
import ViewportGrid from '../../renderer/components/ui/viewportgrid'

describe('IPC and component sanitizers', () => {
    let env: BrowserEnvHandle
    let harness: ReturnType<typeof createHookHarness>

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
        env = setupBrowserEnv()
        harness = createHookHarness()
        mockIpcRendererSend.mockReset()
        mockContextBridgeExpose.mockReset()
        mockComponentIpcSend.mockReset()
        for (const ch of Object.keys(mockIpcRendererListeners)) {
            mockIpcRendererListeners[ch].clear()
        }
        (global as any).window.XenonStream = {
            isWebUI: () => false,
            openExternal: jest.fn(),
        }
    })

    afterEach(() => {
        harness.dispose()
        env.restore()
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('Preload uses monotonic requestIds with zero collisions or leaked ipcRenderer listeners', async () => {
        const sentIds: number[] = []
        mockIpcRendererSend.mockImplementation((_channel: string, payload: any) => {
            sentIds.push(payload.id)
        })

        const promises = Array.from({ length: 100 }, () => Preload.send('app', 'ping', {}))
        expect(new Set(sentIds).size).toBe(100)
        expect(mockIpcRendererListeners['app']?.size).toBe(100)

        // Dispatch responses for all 100 requests
        const listeners = Array.from(mockIpcRendererListeners['app'] ?? [])
        for (const id of sentIds) {
            for (const listener of listeners) {
                listener({}, { action: 'ping', id, data: { id } })
            }
        }

        const results = await Promise.all(promises)
        expect(results).toHaveLength(100)
        expect(mockIpcRendererListeners['app']?.size).toBe(0)
    })

    it('WebsocketIPC removes listeners via both 2-arg and 3-arg calls, ignores bad JSON, and cleans retry timers on close', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

        const wsIpc = new WebsocketIPC('ws://localhost:3000/ipc')
        const socket = env.createdSockets[0]

        const onActionCb = jest.fn()
        const token = wsIpc.onAction('streaming', 'onQueue', onActionCb)
        socket.emitMessage({ channel: 'streaming', action: 'onQueue', data: { wait: 1 } })
        expect(onActionCb).toHaveBeenCalledTimes(1)

        // Two-arg removal as called by renderer/lib/ipc.ts
        wsIpc.removeListener('streaming', token)
        socket.emitMessage({ channel: 'streaming', action: 'onQueue', data: { wait: 2 } })
        expect(onActionCb).toHaveBeenCalledTimes(1)

        const onCb = jest.fn()
        const onToken = wsIpc.on('app', onCb)
        wsIpc.removeListener('app', onToken)
        socket.emitMessage({ channel: 'app', action: 'other', data: {} })
        expect(onCb).not.toHaveBeenCalled()

        // Malformed message does not throw
        expect(() => socket.emitMessage('{invalid')).not.toThrow()

        // Pending retry timer while connecting is cleaned up on close()
        socket.readyState = 0
        const pendingSend = wsIpc.send('app', 'status', {})
        expect(jest.getTimerCount()).toBe(1)

        wsIpc.close()
        expect(jest.getTimerCount()).toBe(0)
        await expect(pendingSend).rejects.toThrow('WebSocket IPC is closed')

        errorSpy.mockRestore()
        logSpy.mockRestore()
    })

    it('SidebarFriends, SettingsWebUI, SettingsInput, and ViewportGrid do not leak timers across rerenders and unmount', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        mockComponentIpcSend.mockResolvedValue([])

        const friends = harness.mount(SidebarFriends, {})
        expect(jest.getTimerCount()).toBe(4) // 3 initial timeouts + 1 interval
        friends.unmount()
        expect(jest.getTimerCount()).toBe(0)

        mockComponentIpcSend.mockResolvedValue(true)
        const webui = harness.mount(SettingsWebUI, {})
        await flushMicrotasks()
        expect(jest.getTimerCount()).toBe(1)
        webui.rerender({})
        expect(jest.getTimerCount()).toBe(1)
        webui.unmount()
        expect(jest.getTimerCount()).toBe(0)

        const inputSettings = harness.mount(SettingsInput, {})
        expect(jest.getTimerCount()).toBe(1)
        inputSettings.rerender({})
        expect(jest.getTimerCount()).toBe(1)
        inputSettings.unmount()
        expect(jest.getTimerCount()).toBe(0)

        const grid = harness.mount(ViewportGrid, { children: [] })
        expect(jest.getTimerCount()).toBe(1)
        grid.unmount()
        expect(jest.getTimerCount()).toBe(0)

        logSpy.mockRestore()
    })
})
