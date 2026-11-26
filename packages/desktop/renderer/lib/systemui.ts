import xCloudPlayer from 'xbox-xcloud-player'
import InputChannel from 'xbox-xcloud-player/dist/Channel/Input'
import MessageChannel from 'xbox-xcloud-player/dist/Channel/Message'

// Default systemUi capabilities advertised to the console so ShowVirtualKeyboard
// and ShowMessageDialog requests are delivered during streaming.
export const SYSTEM_UI_CAPABILITIES = [10, 19, 31, 27, 32, -41]

const activeCleanups = new Set<() => void>()
let systemUiInstalled = false
let remoteOfferInstalled = false

function isTextInputElement(target: EventTarget | null): boolean {
    if (!target || typeof (target as HTMLElement).tagName !== 'string') {
        return false
    }
    const el = target as HTMLElement
    const tag = el.tagName.toUpperCase()
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

function releasePointerLockIfActive() {
    if (typeof document !== 'undefined' && document.pointerLockElement && typeof document.exitPointerLock === 'function') {
        document.exitPointerLock()
    }
}

export function clearSystemUiOverlays() {
    for (const cleanup of Array.from(activeCleanups)) {
        cleanup()
    }
    activeCleanups.clear()
}

function showTextInputOverlay(
    title: string,
    defaultText: string,
    maxLength: number,
    callback: (text: string | null) => void,
) {
    if (typeof document === 'undefined' || !document.body) {
        callback(null)
        return
    }
    releasePointerLockIfActive()

    const overlay = document.createElement('div')
    overlay.setAttribute('data-xenonstream-systemui', 'virtual-keyboard')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;'

    const box = document.createElement('div')
    box.className = 'component_card padbottom'
    box.style.cssText = 'min-width:320px;max-width:480px;'

    const label = document.createElement('h1')
    label.textContent = title

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'text'
    input.value = defaultText
    if (maxLength > 0) {
        input.maxLength = maxLength
    }
    input.style.cssText = 'width:100%;box-sizing:border-box;margin:10px 0 20px 0;'

    const buttonRow = document.createElement('div')
    buttonRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'btn'
    cancelBtn.textContent = 'Cancel'

    const okBtn = document.createElement('button')
    okBtn.className = 'btn btn-primary'
    okBtn.textContent = 'OK'

    let closed = false
    const teardown = () => {
        if (closed) {
            return
        }
        closed = true
        activeCleanups.delete(teardown)
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay)
        }
    }

    const finish = (result: string | null) => {
        if (closed) {
            return
        }
        teardown()
        callback(result)
    }

    activeCleanups.add(teardown)

    cancelBtn.onclick = () => finish(null)
    okBtn.onclick = () => finish(input.value)
    input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
            finish(input.value)
        } else if (e.key === 'Escape') {
            finish(null)
        }
    })

    buttonRow.appendChild(cancelBtn)
    buttonRow.appendChild(okBtn)
    box.appendChild(label)
    box.appendChild(input)
    box.appendChild(buttonRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    input.focus()
}

function showMessageDialogOverlay(
    content: {
        TitleText?: string
        ContentText?: string
        CommandLabel1?: string
        CommandLabel2?: string
        CommandLabel3?: string
        CancelIndex?: number
    },
    callback: (resultIndex: number) => void,
) {
    if (typeof document === 'undefined' || !document.body) {
        callback(content.CancelIndex ?? 0)
        return
    }
    releasePointerLockIfActive()

    const overlay = document.createElement('div')
    overlay.setAttribute('data-xenonstream-systemui', 'message-dialog')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;'

    const box = document.createElement('div')
    box.className = 'component_card padbottom'
    box.style.cssText = 'min-width:320px;max-width:480px;'

    const title = document.createElement('h1')
    title.textContent = content.TitleText || ''

    const body = document.createElement('p')
    body.textContent = content.ContentText || ''

    const buttonRow = document.createElement('div')
    buttonRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:10px;'

    let closed = false
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation()
            finish(content.CancelIndex ?? 0)
        }
    }

    const teardown = () => {
        if (closed) {
            return
        }
        closed = true
        activeCleanups.delete(teardown)
        document.removeEventListener('keydown', escHandler, true)
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay)
        }
    }

    const finish = (resultIndex: number) => {
        if (closed) {
            return
        }
        teardown()
        callback(resultIndex)
    }

    activeCleanups.add(teardown)
    document.addEventListener('keydown', escHandler, true)

    const labels = [content.CommandLabel1, content.CommandLabel2, content.CommandLabel3]
    labels.forEach((labelText, index) => {
        if (!labelText) {
            return
        }
        const btn = document.createElement('button')
        btn.className = (index === content.CancelIndex) ? 'btn' : 'btn btn-primary'
        btn.textContent = labelText
        btn.onclick = () => finish(index)
        buttonRow.appendChild(btn)
    })

    box.appendChild(title)
    box.appendChild(body)
    box.appendChild(buttonRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
}

export function applySystemUiSupport() {
    if (systemUiInstalled) {
        return
    }
    systemUiInstalled = true

    const messageProto = MessageChannel.prototype as any
    const origOnMessage = messageProto.onMessage
    messageProto.onMessage = function (event: MessageEvent) {
        try {
            const jsonMessage = JSON.parse(event.data)
            if (jsonMessage?.type === 'TransactionStart') {
                if (jsonMessage.target === '/streaming/systemUi/messages/ShowVirtualKeyboard') {
                    const content = typeof jsonMessage.content === 'string'
                        ? JSON.parse(jsonMessage.content)
                        : (jsonMessage.content || {})
                    showTextInputOverlay(
                        content.TitleText || content.DescriptionText || '',
                        content.DefaultText || '',
                        content.MaxLength || 0,
                        (text) => {
                            if (text === null) {
                                this.sendTransaction(jsonMessage.id, { Result: 1, Text: '' })
                            } else {
                                this.sendTransaction(jsonMessage.id, { Result: 0, Text: text })
                            }
                        },
                    )
                } else if (jsonMessage.target === '/streaming/systemUi/messages/ShowMessageDialog') {
                    const content = typeof jsonMessage.content === 'string'
                        ? JSON.parse(jsonMessage.content)
                        : (jsonMessage.content || {})
                    showMessageDialogOverlay(content, (resultIndex) => {
                        this.sendTransaction(jsonMessage.id, { Result: resultIndex })
                    })
                }
            }
        } catch (error) {
            console.log('applySystemUiSupport: failed to inspect message:', error)
        }
        return origOnMessage.call(this, event)
    }

    const inputProto = InputChannel.prototype as any
    const origKeyDown = inputProto.onKeyDown
    const origKeyUp = inputProto.onKeyUp

    const canForwardRawKey = (channel: any, event: KeyboardEvent) => {
        if (activeCleanups.size > 0 || isTextInputElement(event?.target ?? null)) {
            return false
        }
        return channel._client?._config?.input_legacykeyboard === false
    }

    inputProto.onKeyDown = function (event: KeyboardEvent) {
        if (this._mouseActive === true && this._mouseLocked === true) {
            return origKeyDown.call(this, event)
        }
        if (canForwardRawKey(this, event)) {
            if (this._keyboardButtonsState && this._keyboardButtonsState[event.keyCode] !== true) {
                this._keyboardButtonsState[event.keyCode] = true
                this._keyboardFrames?.push({
                    pressed: true,
                    keyCode: event.keyCode,
                    key: event.key,
                })
            }
            return
        }
        return origKeyDown.call(this, event)
    }

    inputProto.onKeyUp = function (event: KeyboardEvent) {
        if (this._mouseActive === true && this._mouseLocked === true) {
            return origKeyUp.call(this, event)
        }
        if (canForwardRawKey(this, event)) {
            if (this._keyboardButtonsState) {
                this._keyboardButtonsState[event.keyCode] = false
                this._keyboardFrames?.push({
                    pressed: false,
                    keyCode: event.keyCode,
                    key: event.key,
                })
            }
            return
        }
        return origKeyUp.call(this, event)
    }
}

export function applyRemoteOfferErrorHandling() {
    if (remoteOfferInstalled) {
        return
    }
    remoteOfferInstalled = true

    const playerProto = xCloudPlayer.prototype as any
    playerProto.setRemoteOffer = function (sdpdata: string) {
        const setPromise = this._webrtcClient?.setRemoteDescription({
            type: 'answer',
            sdp: sdpdata,
        })
        if (setPromise && typeof setPromise.catch === 'function') {
            setPromise.catch((e: any) => {
                console.log('xCloudPlayer setRemoteOffer() Remote SDP is not valid:', sdpdata, e)
                this.getEventBus?.().emit('connectionstate', { state: 'error', message: e?.message })
            })
        }
        this.getEventBus?.().emit('connectionstate', { state: 'connecting' })
    }
}
