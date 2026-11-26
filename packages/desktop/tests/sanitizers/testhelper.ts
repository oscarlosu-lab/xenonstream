import React from 'react'

export interface MockElement {
    id: string;
    tagName: string;
    className: string;
    innerText: string;
    style: Record<string, any>;
    children: MockElement[];
    parentElement: MockElement | null;
    clientHeight: number;
    clientWidth: number;
    offsetTop: number;
    volume: number;
    muted: boolean;
    autoplay: boolean;
    playsInline: boolean;
    srcObject: any;
    listeners: Record<string, Set<Function>>;
    appendChild: jest.Mock;
    remove: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    querySelector: jest.Mock;
    getBoundingClientRect: jest.Mock;
    requestPointerLock: jest.Mock;
    requestVideoFrameCallback?: jest.Mock;
    cancelVideoFrameCallback?: jest.Mock;
    innerHTML: string;
}

export interface BrowserEnvHandle {
    elementsById: Map<string, MockElement>;
    registerElement: (id: string, tagName?: string) => MockElement;
    windowListeners: Record<string, Set<Function>>;
    dispatchWindowEvent: (type: string, event?: any) => void;
    createdSockets: any[];
    peerConnections: any[];
    restore: () => void;
}

export function createMockElement(
    id: string,
    tagName = 'div',
    elementsById?: Map<string, MockElement>
): MockElement {
    let html = ''
    const childElements: MockElement[] = []
    const listeners: Record<string, Set<Function>> = {}

    const el: MockElement = {
        id,
        tagName: tagName.toUpperCase(),
        className: '',
        innerText: '',
        style: {},
        children: childElements,
        parentElement: null,
        clientHeight: 600,
        clientWidth: 800,
        offsetTop: 0,
        volume: 1,
        muted: false,
        autoplay: false,
        playsInline: false,
        srcObject: null,
        listeners,
        appendChild: jest.fn((child: MockElement) => {
            child.parentElement = el
            childElements.push(child)
            if (child.id && elementsById) {
                elementsById.set(child.id, child)
            }
            return child
        }),
        remove: jest.fn(() => {
            if (el.parentElement) {
                const idx = el.parentElement.children.indexOf(el)
                if (idx >= 0) {
                    el.parentElement.children.splice(idx, 1)
                }
                el.parentElement = null
            }
            if (el.id && elementsById && elementsById.get(el.id) === el) {
                elementsById.delete(el.id)
            }
        }),
        addEventListener: jest.fn((type: string, fn: Function) => {
            if (!listeners[type]) {
                listeners[type] = new Set()
            }
            listeners[type].add(fn)
        }),
        removeEventListener: jest.fn((type: string, fn: Function) => {
            listeners[type]?.delete(fn)
        }),
        querySelector: jest.fn(() => null),
        getBoundingClientRect: jest.fn(() => ({ left: 0, top: 0, width: 1920, height: 1080 })),
        requestPointerLock: jest.fn(() => Promise.resolve()),
        get innerHTML() {
            return html
        },
        set innerHTML(value: string) {
            for (const prev of childElements) {
                if (prev.id && elementsById && elementsById.get(prev.id) === prev) {
                    elementsById.delete(prev.id)
                }
                prev.parentElement = null
            }
            childElements.length = 0
            html = value

            if (elementsById && value) {
                const idMatches = value.matchAll(/id=["']([^"']+)["']/g)
                for (const match of idMatches) {
                    const childId = match[1]
                    const childEl = createMockElement(childId, 'div', elementsById)
                    childEl.parentElement = el
                    childElements.push(childEl)
                    elementsById.set(childId, childEl)
                }
            }
        },
    }

    if (id && elementsById) {
        elementsById.set(id, el)
    }

    return el
}

export function setupBrowserEnv(): BrowserEnvHandle {
    const savedDescriptors: Array<{ key: string; desc: PropertyDescriptor | undefined }> = []
    const saveAndSetGlobal = (key: string, value: any) => {
        savedDescriptors.push({
            key,
            desc: Object.getOwnPropertyDescriptor(global, key),
        })
        Object.defineProperty(global, key, {
            value,
            writable: true,
            configurable: true,
            enumerable: true,
        })
    }

    const elementsById = new Map<string, MockElement>()
    const windowListeners: Record<string, Set<Function>> = {}
    const createdSockets: any[] = []
    const peerConnections: any[] = []
    const createdElementsByTag: Record<string, MockElement[]> = {}

    const registerElement = (id: string, tagName = 'div') => {
        const existing = elementsById.get(id)
        if (existing) {
            return existing
        }
        return createMockElement(id, tagName, elementsById)
    }

    const mockWindow: any = {
        location: { hostname: 'localhost', port: '3000' },
        history: { back: jest.fn() },
        scrollTo: jest.fn(),
        open: jest.fn(),
        addEventListener: jest.fn((type: string, fn: Function) => {
            if (!windowListeners[type]) {
                windowListeners[type] = new Set()
            }
            windowListeners[type].add(fn)
        }),
        removeEventListener: jest.fn((type: string, fn: Function) => {
            windowListeners[type]?.delete(fn)
        }),
    }

    const mockDocument: any = {
        body: { requestFullscreen: jest.fn(() => Promise.resolve()) },
        createElement: jest.fn((tagName: string) => {
            const el = createMockElement('', tagName, elementsById)
            if (tagName === 'video') {
                el.requestVideoFrameCallback = jest.fn(() => 1)
                el.cancelVideoFrameCallback = jest.fn()
            }
            if (!createdElementsByTag[tagName]) {
                createdElementsByTag[tagName] = []
            }
            createdElementsByTag[tagName].push(el)
            return el
        }),
        getElementById: jest.fn((id: string) => elementsById.get(id) ?? null),
        querySelector: jest.fn((selector: string) => {
            const idMatch = selector.match(/#([A-Za-z0-9_-]+)/)
            if (idMatch) {
                return elementsById.get(idMatch[1]) ?? null
            }
            return null
        }),
        getElementsByTagName: jest.fn((tag: string) => createdElementsByTag[tag] ?? []),
    }

    const mockNavigator: any = {
        maxTouchPoints: 0,
        getGamepads: jest.fn(() => []),
        permissions: {
            query: jest.fn(() => Promise.resolve({ state: 'prompt', onchange: null })),
        },
        mediaDevices: {
            getUserMedia: jest.fn(() =>
                Promise.resolve({
                    getTracks: () => [{ stop: jest.fn() }],
                    getAudioTracks: () => [{ kind: 'audio', stop: jest.fn() }],
                })
            ),
        },
    }

    const mockRTCRtpReceiver: any = {
        getCapabilities: jest.fn(() => ({
            codecs: [
                { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f' },
                { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
                { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' },
                { mimeType: 'video/ulpfec', clockRate: 90000 },
                { mimeType: 'video/rtx', clockRate: 90000 },
            ],
            headerExtensions: [],
        })),
    }

    const mockRTCPeerConnection = jest.fn(() => {
        const transceivers: any[] = []
        const dataChannels: Record<string, any> = {}
        const listeners: Record<string, Set<Function>> = {}

        const pc: any = {
            connectionState: 'new',
            ontrack: null,
            onconnectionstatechange: null,
            _dataChannels: dataChannels,
            addTransceiver: jest.fn((kind: string) => {
                const tr = {
                    receiver: { track: { kind } },
                    setCodecPreferences: jest.fn(),
                }
                transceivers.push(tr)
                return tr
            }),
            getTransceivers: jest.fn(() => transceivers),
            createDataChannel: jest.fn((label: string) => {
                const dc: any = {
                    label,
                    readyState: 'open',
                    onopen: null,
                    onmessage: null,
                    onclosing: null,
                    onclose: null,
                    onerror: null,
                    send: jest.fn(),
                    close: jest.fn(),
                }
                dataChannels[label] = dc
                return dc
            }),
            addEventListener: jest.fn((type: string, fn: Function) => {
                if (!listeners[type]) {
                    listeners[type] = new Set()
                }
                listeners[type].add(fn)
            }),
            removeEventListener: jest.fn((type: string, fn: Function) => {
                listeners[type]?.delete(fn)
            }),
            createOffer: jest.fn(() =>
                Promise.resolve({
                    type: 'offer',
                    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 useinbandfec=1\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
                })
            ),
            setLocalDescription: jest.fn(() => Promise.resolve()),
            setRemoteDescription: jest.fn(() => Promise.resolve()),
            addIceCandidate: jest.fn(() => Promise.resolve()),
            getSenders: jest.fn(() => []),
            addTrack: jest.fn(),
            removeTrack: jest.fn(),
            getStats: jest.fn(() => Promise.resolve(new Map())),
            close: jest.fn(() => {
                pc.connectionState = 'closed'
            }),
        }
        peerConnections.push(pc)
        return pc
    })

    const MockWebSocket = jest.fn((url: string) => {
        const wsListeners: Record<string, Set<Function>> = {}
        const socket: any = {
            url,
            readyState: 1,
            sent: [] as string[],
            listeners: wsListeners,
            addEventListener: jest.fn((type: string, fn: Function) => {
                if (!wsListeners[type]) {
                    wsListeners[type] = new Set()
                }
                wsListeners[type].add(fn)
            }),
            removeEventListener: jest.fn((type: string, fn: Function) => {
                wsListeners[type]?.delete(fn)
            }),
            send: jest.fn((payload: string) => {
                socket.sent.push(payload)
            }),
            close: jest.fn(() => {
                socket.readyState = 3
            }),
            emitMessage(data: any) {
                const event = { data: typeof data === 'string' ? data : JSON.stringify(data) }
                for (const fn of wsListeners['message'] ?? []) {
                    fn(event)
                }
            },
        }
        createdSockets.push(socket)
        return socket
    })

    saveAndSetGlobal('window', mockWindow)
    saveAndSetGlobal('document', mockDocument)
    saveAndSetGlobal('navigator', mockNavigator)
    saveAndSetGlobal('getComputedStyle', jest.fn(() => ({ position: 'relative' })))
    saveAndSetGlobal('RTCRtpReceiver', mockRTCRtpReceiver)
    saveAndSetGlobal('RTCRtpTransceiver', jest.fn(() => ({ setCodecPreferences: jest.fn() })))
    saveAndSetGlobal('RTCPeerConnection', mockRTCPeerConnection)
    saveAndSetGlobal('WebSocket', MockWebSocket)
    saveAndSetGlobal('alert', jest.fn())
    saveAndSetGlobal('confirm', jest.fn(() => true))

    return {
        elementsById,
        registerElement,
        windowListeners,
        dispatchWindowEvent: (type: string, event: any = {}) => {
            for (const fn of windowListeners[type] ?? []) {
                fn(event)
            }
        },
        createdSockets,
        peerConnections,
        restore: () => {
            elementsById.clear()
            for (const key of Object.keys(windowListeners)) {
                windowListeners[key].clear()
            }
            createdSockets.length = 0
            peerConnections.length = 0

            for (let i = savedDescriptors.length - 1; i >= 0; i--) {
                const { key, desc } = savedDescriptors[i]
                if (desc === undefined) {
                    delete (global as any)[key]
                } else {
                    Object.defineProperty(global, key, desc)
                }
            }
        },
    }
}

interface MountedInstance<P = any> {
    getOutput: () => any;
    rerender: (nextProps?: P) => any;
    unmount: () => void;
}

export function createHookHarness() {
    const stack: any[] = []
    const instances: Set<any> = new Set()

    const getCurrent = () => {
        const inst = stack[stack.length - 1]
        if (!inst) {
            throw new Error('Hooks called outside HookHarness render')
        }
        return inst
    }

    const useStateSpy = jest.spyOn(React, 'useState').mockImplementation(((initial?: any) => {
        const inst = getCurrent()
        const idx = inst.hookIndex++
        if (!(idx in inst.hookSlots)) {
            inst.hookSlots[idx] = typeof initial === 'function' ? initial() : initial
        }
        const setState = (updater: any) => {
            const current = inst.hookSlots[idx]
            const next = typeof updater === 'function' ? updater(current) : updater
            if (Object.is(current, next)) {
                return
            }
            inst.hookSlots[idx] = next
            if (!inst.mounted) {
                return
            }
            if (inst.isRendering) {
                inst.renderQueuedDuringRender = true
                return
            }
            if (!inst.microtaskScheduled) {
                inst.microtaskScheduled = true
                queueMicrotask(() => {
                    inst.microtaskScheduled = false
                    if (inst.mounted) {
                        inst.render()
                    }
                })
            }
        }
        return [inst.hookSlots[idx], setState]
    }) as any)

    const useRefSpy = jest.spyOn(React, 'useRef').mockImplementation((initial: any) => {
        const inst = getCurrent()
        const idx = inst.hookIndex++
        if (!(idx in inst.hookSlots)) {
            inst.hookSlots[idx] = { current: initial }
        }
        return inst.hookSlots[idx]
    })

    const useIdSpy = jest.spyOn(React, 'useId').mockImplementation(() => {
        const inst = getCurrent()
        const idx = inst.hookIndex++
        if (!(idx in inst.hookSlots)) {
            inst.hookSlots[idx] = `:r${idx}:`
        }
        return inst.hookSlots[idx]
    })

    const useCallbackSpy = jest.spyOn(React, 'useCallback').mockImplementation(((fn: any) => fn) as any)
    const useMemoSpy = jest.spyOn(React, 'useMemo').mockImplementation(((factory: any) => factory()) as any)

    const useEffectSpy = jest.spyOn(React, 'useEffect').mockImplementation((create: any, deps?: any[]) => {
        const inst = getCurrent()
        const idx = inst.hookIndex++
        const prev = inst.effectSlots[idx]
        const depsChanged =
            prev === undefined ||
            deps === undefined ||
            prev.deps === undefined ||
            deps.length !== prev.deps.length ||
            deps.some((d, i) => !Object.is(d, prev.deps[i]))

        if (depsChanged) {
            inst.pendingEffects.push({ idx, create, deps })
        }
    })

    const mount = <P,>(Component: React.ComponentType<P>, initialProps: P): MountedInstance<P> => {
        const inst: any = {
            props: initialProps,
            hookIndex: 0,
            hookSlots: [] as any[],
            effectSlots: {} as Record<number, { deps?: any[]; cleanup?: () => void }>,
            pendingEffects: [] as Array<{ idx: number; create: () => any; deps?: any[] }>,
            mounted: true,
            isRendering: false,
            renderQueuedDuringRender: false,
            microtaskScheduled: false,
            output: null as any,
            render: (nextProps?: P) => {
                if (!inst.mounted) {
                    return inst.output
                }
                if (nextProps !== undefined) {
                    inst.props = nextProps
                }
                let pass = 0
                do {
                    inst.renderQueuedDuringRender = false
                    inst.hookIndex = 0
                    inst.pendingEffects = []
                    inst.isRendering = true
                    stack.push(inst)
                    try {
                        inst.output = (Component as React.FC<P>)(inst.props)
                    } finally {
                        stack.pop()
                        inst.isRendering = false
                    }
                    pass++
                    if (pass > 25) {
                        throw new Error('Infinite re-render loop detected during render')
                    }
                } while (inst.renderQueuedDuringRender && inst.mounted)

                const effectsToRun = inst.pendingEffects.splice(0)
                for (const eff of effectsToRun) {
                    const prev = inst.effectSlots[eff.idx]
                    if (typeof prev?.cleanup === 'function') {
                        prev.cleanup()
                    }
                    const cleanup = eff.create()
                    inst.effectSlots[eff.idx] = {
                        deps: eff.deps,
                        cleanup: typeof cleanup === 'function' ? cleanup : undefined,
                    }
                }
                return inst.output
            },
            unmount: () => {
                if (!inst.mounted) {
                    return
                }
                inst.mounted = false
                for (const key of Object.keys(inst.effectSlots)) {
                    const slot = inst.effectSlots[Number(key)]
                    if (typeof slot?.cleanup === 'function') {
                        slot.cleanup()
                    }
                }
                inst.effectSlots = {}
                inst.pendingEffects = []
                instances.delete(inst)
            },
        }

        instances.add(inst)
        inst.render(initialProps)

        return {
            getOutput: () => inst.output,
            rerender: (nextProps?: P) => inst.render(nextProps),
            unmount: () => inst.unmount(),
        }
    }

    return {
        mount,
        dispose: () => {
            for (const inst of Array.from(instances)) {
                inst.unmount()
            }
            useStateSpy.mockRestore()
            useRefSpy.mockRestore()
            useIdSpy.mockRestore()
            useCallbackSpy.mockRestore()
            useMemoSpy.mockRestore()
            useEffectSpy.mockRestore()
        },
    }
}

export async function flushMicrotasks(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve()
    }
}

export function findElementByType(node: any, targetType: any): any {
    if (node === null || node === undefined || typeof node !== 'object') {
        return undefined
    }
    if (node.type === targetType) {
        return node
    }
    const children = node.props?.children
    if (Array.isArray(children)) {
        for (const child of children) {
            const match = findElementByType(child, targetType)
            if (match !== undefined) {
                return match
            }
        }
    } else if (children !== undefined) {
        return findElementByType(children, targetType)
    }
    return undefined
}
