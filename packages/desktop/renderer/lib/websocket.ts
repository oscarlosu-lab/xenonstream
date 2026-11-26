export interface WebsocketActionToken {
    action: string;
    index: number;
}

export default class WebsocketIPC {
    _websocket:WebSocket

    _on: Record<string, Array<((ipcData: any, data: any) => void) | undefined>> = {}
    _onAction: Record<string, Record<string, Array<((ipcData: any, data: any) => void) | undefined>>> = {}
    _nextActionId = 0
    private _retryTimeouts: Set<{ timeoutId: ReturnType<typeof setTimeout>; reject: (reason?: any) => void }> = new Set()
    private _messageListener: (event: MessageEvent) => void
    private _isClosed = false

    constructor(url: string){
        this._websocket = new WebSocket(url)
        this._messageListener = (event: MessageEvent) => this.onMessage(event)
        this._websocket.addEventListener('message', this._messageListener)
    }

    send(channel: string, action: string, data?: any){
        return new Promise((resolve, reject) => {
            if(this._isClosed){
                reject(new Error('WebSocket IPC is closed'))
                return
            }

            if(this._websocket.readyState === 0){
                // Still connecting
                const entry = {
                    timeoutId: undefined as unknown as ReturnType<typeof setTimeout>,
                    reject,
                }
                entry.timeoutId = setTimeout(() => {
                    this._retryTimeouts.delete(entry)
                    if(this._isClosed){
                        reject(new Error('WebSocket IPC is closed'))
                        return
                    }
                    this.send(channel, action, data).then((event) => {
                        resolve(event)
                    }).catch((error) => {
                        reject(error)
                    })
                }, 200)
                this._retryTimeouts.add(entry)
            } else {
                const actionId = ++this._nextActionId

                const token = this.onAction(channel, action, (event, args) => {
                    if(event.id === actionId){
                        this.removeListener(channel, action, token.index)
                        resolve(args)
                    }
                })

                this._websocket.send(JSON.stringify({
                    channel: channel,
                    id: actionId,
                    action: action,
                    data: data,
                }))
            }
        })
    }

    on(channel: string, listener: (ipcData: any, data: any) => void): number {
        if(this._on[channel] === undefined){
            this._on[channel] = []
        }
        return (this._on[channel].push(listener)-1)
    }

    public onAction(channel: string, action: string, listener: (ipcData: any, data: any) => void): WebsocketActionToken {
        if(this._onAction[channel] === undefined){
            this._onAction[channel] = {}
        }
        if(this._onAction[channel][action] === undefined){
            this._onAction[channel][action] = []
        }

        const index = this._onAction[channel][action].push(listener) - 1
        return {
            action,
            index,
        }
    }

    onMessage(event: MessageEvent) {
        let ipcData: any
        try {
            ipcData = JSON.parse(event.data)
        } catch(error) {
            console.error('Failed to parse WebSocket IPC message:', error)
            return
        }
        console.log(ipcData, this._on, this._onAction)

        if(this._on[ipcData.channel] !== undefined){
            for(const listener in this._on[ipcData.channel]){
                const callback = this._on[ipcData.channel][listener]
                if(typeof callback === 'function'){
                    callback(ipcData, ipcData.data)
                }
            }
        }

        if(this._onAction[ipcData.channel] !== undefined){
            if(this._onAction[ipcData.channel][ipcData.action] !== undefined){
                for(const listener in this._onAction[ipcData.channel][ipcData.action]){
                    const callback = this._onAction[ipcData.channel][ipcData.action][listener]
                    if(typeof callback === 'function'){
                        callback(ipcData, ipcData.data)
                    }
                }
            }
        }

    }

    private removeActionListenerByIndex(channel: string, action: string, index: number): void {
        const actionListeners = this._onAction[channel]?.[action]
        if(actionListeners === undefined){
            return
        }

        delete actionListeners[index]

        for(const checkListener in actionListeners){
            if(actionListeners[checkListener] !== undefined){
                return
            }
        }

        console.log('It\'s empty! Deleting key:', action)
        delete this._onAction[channel][action]
    }

    removeListener(channel: string, actionOrToken: any, maybeIndex?: number): void {
        if(maybeIndex !== undefined){
            this.removeActionListenerByIndex(channel, actionOrToken, maybeIndex)
            return
        }

        if(actionOrToken !== null && typeof actionOrToken === 'object' && 'action' in actionOrToken && 'index' in actionOrToken){
            this.removeActionListenerByIndex(channel, actionOrToken.action, actionOrToken.index)
            return
        }

        if(typeof actionOrToken === 'number'){
            if(this._on[channel] !== undefined){
                delete this._on[channel][actionOrToken]
            }
            return
        }

        if(typeof actionOrToken === 'function'){
            const channelListeners = this._on[channel]
            if(channelListeners !== undefined){
                for(const idx in channelListeners){
                    if(channelListeners[idx] === actionOrToken){
                        delete channelListeners[idx]
                    }
                }
            }

            const actionMap = this._onAction[channel]
            if(actionMap !== undefined){
                for(const action of Object.keys(actionMap)){
                    const listeners = actionMap[action]
                    for(const idx in listeners){
                        if(listeners[idx] === actionOrToken){
                            this.removeActionListenerByIndex(channel, action, Number(idx))
                        }
                    }
                }
            }
        }
    }

    close(): void {
        this._isClosed = true
        const pendingEntries = Array.from(this._retryTimeouts)
        this._retryTimeouts.clear()
        for(const entry of pendingEntries){
            clearTimeout(entry.timeoutId)
            entry.reject(new Error('WebSocket IPC is closed'))
        }
        this._websocket.removeEventListener?.('message', this._messageListener)
        this._websocket.close?.()
    }
}
