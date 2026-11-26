import xCloudPlayer from 'xbox-xcloud-player'
import InputChannel from 'xbox-xcloud-player/dist/Channel/Input'
import MessageChannel from 'xbox-xcloud-player/dist/Channel/Message'
import {
    applyRemoteOfferErrorHandling,
    applySystemUiSupport,
    clearSystemUiOverlays,
    SYSTEM_UI_CAPABILITIES,
} from '../../renderer/lib/systemui'

describe('systemUi in-game text entry, dialogs, and remote SDP error handling', () => {
    const origDocument = (global as any).document
    const origMessageOnMessage = (MessageChannel.prototype as any).onMessage
    const origInputKeyDown = (InputChannel.prototype as any).onKeyDown
    const origInputKeyUp = (InputChannel.prototype as any).onKeyUp
    const origSetRemoteOffer = (xCloudPlayer.prototype as any).setRemoteOffer

    afterAll(() => {
        ;(MessageChannel.prototype as any).onMessage = origMessageOnMessage
        ;(InputChannel.prototype as any).onKeyDown = origInputKeyDown
        ;(InputChannel.prototype as any).onKeyUp = origInputKeyUp
        ;(xCloudPlayer.prototype as any).setRemoteOffer = origSetRemoteOffer
    })

    function installMockDocument() {
        const children: any[] = []
        const docListeners: Record<string, Set<Function>> = {}

        const createEl = (tag: string) => {
            const listeners: Record<string, Function[]> = {}
            const el: any = {
                tagName: tag.toUpperCase(),
                style: {},
                className: '',
                textContent: '',
                value: '',
                maxLength: 0,
                attrs: {} as Record<string, string>,
                children: [] as any[],
                parentNode: null as any,
                setAttribute(k: string, v: string) { this.attrs[k] = v },
                appendChild(child: any) {
                    child.parentNode = el
                    el.children.push(child)
                    return child
                },
                removeChild(child: any) {
                    const idx = el.children.indexOf(child)
                    if (idx >= 0) el.children.splice(idx, 1)
                    child.parentNode = null
                    return child
                },
                addEventListener(type: string, fn: Function) {
                    listeners[type] = listeners[type] || []
                    listeners[type].push(fn)
                },
                dispatch(type: string, event: any) {
                    for (const fn of (listeners[type] || [])) {
                        fn(event)
                    }
                },
                focus: jest.fn(),
                onclick: null as any,
            }
            return el
        }

        const body = createEl('body')
        body.children = children

        ;(global as any).document = {
            body,
            pointerLockElement: {} as any,
            exitPointerLock: jest.fn(),
            createElement: createEl,
            addEventListener(type: string, fn: Function) {
                docListeners[type] = docListeners[type] || new Set()
                docListeners[type].add(fn)
            },
            removeEventListener(type: string, fn: Function) {
                docListeners[type]?.delete(fn)
            },
            _docListeners: docListeners,
        }

        return { body, docListeners }
    }

    afterEach(() => {
        clearSystemUiOverlays()
        ;(global as any).document = origDocument
    })

    test('exports default Xbox systemUi capability list', () => {
        expect(SYSTEM_UI_CAPABILITIES).toEqual([10, 19, 31, 27, 32, -41])
    })

    test('handles ShowVirtualKeyboard OK submission and releases pointer lock', () => {
        const { body } = installMockDocument()
        applySystemUiSupport()

        const sendTransaction = jest.fn()
        const channel: any = {
            _channelName: 'message',
            sendTransaction,
            getClient: () => ({
                getChannelProcessor: () => ({ start: jest.fn() }),
                getEventBus: () => ({ emit: jest.fn() }),
            }),
        }

        const msg = {
            type: 'TransactionStart',
            id: 'tx-1',
            target: '/streaming/systemUi/messages/ShowVirtualKeyboard',
            content: JSON.stringify({ TitleText: 'Chat', DefaultText: 'hi', MaxLength: 64 }),
        }

        ;(MessageChannel.prototype as any).onMessage.call(channel, { data: JSON.stringify(msg) })
        expect((global as any).document.exitPointerLock).toHaveBeenCalledTimes(1)
        expect(body.children.length).toBe(1)

        const overlay = body.children[0]
        const box = overlay.children[0]
        const input = box.children[1]
        const buttonRow = box.children[2]
        const okBtn = buttonRow.children[1]

        input.value = 'GG WP'
        okBtn.onclick()

        expect(sendTransaction).toHaveBeenCalledWith('tx-1', { Result: 0, Text: 'GG WP' })
        expect(body.children.length).toBe(0)
    })

    test('cleans up open ShowMessageDialog overlay and Escape listener on unmount', () => {
        const { body, docListeners } = installMockDocument()
        applySystemUiSupport()

        const sendTransaction = jest.fn()
        const channel: any = {
            _channelName: 'message',
            sendTransaction,
            getClient: () => ({
                getChannelProcessor: () => ({ start: jest.fn() }),
                getEventBus: () => ({ emit: jest.fn() }),
            }),
        }

        const msg = {
            type: 'TransactionStart',
            id: 'tx-2',
            target: '/streaming/systemUi/messages/ShowMessageDialog',
            content: JSON.stringify({
                TitleText: 'Confirm',
                ContentText: 'Continue?',
                CommandLabel1: 'Yes',
                CommandLabel2: 'No',
                CancelIndex: 1,
            }),
        }

        ;(MessageChannel.prototype as any).onMessage.call(channel, { data: JSON.stringify(msg) })
        expect(body.children.length).toBe(1)
        expect(docListeners.keydown.size).toBe(1)

        clearSystemUiOverlays()
        expect(body.children.length).toBe(0)
        expect(docListeners.keydown.size).toBe(0)
        expect(sendTransaction).not.toHaveBeenCalled()
    })

    test('forwards raw keyboard input when legacy keyboard is disabled and no input is focused', () => {
        applySystemUiSupport()
        const channel: any = {
            _mouseActive: false,
            _mouseLocked: false,
            _client: { _config: { input_legacykeyboard: false } },
            _keyboardButtonsState: {},
            _keyboardFrames: [],
        }

        ;(InputChannel.prototype as any).onKeyDown.call(channel, { keyCode: 65, key: 'a', target: { tagName: 'DIV' } })
        expect(channel._keyboardFrames).toHaveLength(1)
        expect(channel._keyboardFrames[0]).toEqual({ pressed: true, keyCode: 65, key: 'a' })

        // Do not hijack typing inside an <input>
        ;(InputChannel.prototype as any).onKeyDown.call(channel, { keyCode: 66, key: 'b', target: { tagName: 'INPUT' } })
        expect(channel._keyboardFrames).toHaveLength(1)
    })

    test('setRemoteOffer catches rejected setRemoteDescription and emits error', async () => {
        applyRemoteOfferErrorHandling()
        const emit = jest.fn()
        const fakePlayer: any = {
            _webrtcClient: {
                setRemoteDescription: jest.fn(() => Promise.reject(new Error('Invalid SDP answer'))),
            },
            getEventBus: () => ({ emit }),
        }

        ;(xCloudPlayer.prototype as any).setRemoteOffer.call(fakePlayer, 'v=0\r\nbad')
        await Promise.resolve()

        expect(emit).toHaveBeenCalledWith('connectionstate', { state: 'connecting' })
        expect(emit).toHaveBeenCalledWith('connectionstate', { state: 'error', message: 'Invalid SDP answer' })
    })
})
