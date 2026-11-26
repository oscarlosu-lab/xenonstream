import crypto from 'crypto'
import net from 'net'
import Application from '../application'

const OPCODE_HANDSHAKE = 0
const OPCODE_FRAME = 1

function encodeDiscordFrame(op: number, payload: Record<string, unknown>): Buffer {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    const header = Buffer.alloc(8)
    header.writeInt32LE(op, 0)
    header.writeInt32LE(body.length, 4)
    return Buffer.concat([header, body])
}

/**
 * Lightweight, zero-dependency Discord Rich Presence client over Windows named pipes
 * (`\\.\pipe\discord-ipc-0`). Strictly opt-in (disabled by default via settings).
 */
export default class DiscordManager {
    private _application: Application
    private _socket: net.Socket | null = null
    private _isConnected = false

    constructor(application: Application) {
        this._application = application
    }

    private isEnabled(): boolean {
        const settings = this._application._store?.get('settings', {}) as Record<string, unknown> | undefined
        return settings?.discord_rpc_enabled === true
    }

    private getClientId(): string {
        const settings = this._application._store?.get('settings', {}) as Record<string, unknown> | undefined
        const id = typeof settings?.discord_rpc_client_id === 'string' ? settings.discord_rpc_client_id.trim() : ''
        return /^\d{17,20}$/.test(id) ? id : ''
    }

    public syncWithSettings() {
        if (!this.isEnabled() || !this.getClientId()) {
            this.disconnect()
            return
        }
        if (!this._socket) {
            this.connect()
        }
    }

    public connect() {
        if (!this.isEnabled() || this._socket) {
            return
        }
        const clientId = this.getClientId()
        if (!clientId) {
            return
        }

        const pipePath = process.platform === 'win32'
            ? '\\\\.\\pipe\\discord-ipc-0'
            : `/tmp/discord-ipc-0`

        const socket = net.createConnection(pipePath)
        this._socket = socket

        socket.on('connect', () => {
            this._isConnected = true
            socket.write(encodeDiscordFrame(OPCODE_HANDSHAKE, { v: 1, client_id: clientId }))
            this._application.log('DiscordRPC', 'Connected to Discord IPC pipe')
            this.setIdlePresence()
        })

        socket.on('error', (err) => {
            this._application.log('DiscordRPC', 'Discord IPC unavailable:', err.message)
            this.disconnect()
        })

        socket.on('close', () => {
            this._isConnected = false
            if (this._socket === socket) {
                this._socket = null
            }
        })
    }

    public disconnect() {
        this._isConnected = false
        if (this._socket) {
            this._socket.removeAllListeners()
            this._socket.destroy()
            this._socket = null
        }
    }

    private sendActivity(activity: Record<string, unknown> | null) {
        if (!this._socket || !this._isConnected || !this.isEnabled()) {
            return
        }
        try {
            this._socket.write(encodeDiscordFrame(OPCODE_FRAME, {
                cmd: 'SET_ACTIVITY',
                args: {
                    pid: process.pid,
                    activity,
                },
                nonce: crypto.randomUUID(),
            }))
        } catch (err) {
            this._application.log('DiscordRPC', 'Failed to send activity:', (err as Error).message)
        }
    }

    public setIdlePresence() {
        this.sendActivity({
            details: 'In Menus',
            state: 'Ready to Play',
            timestamps: { start: Math.floor(Date.now() / 1000) },
            assets: {
                large_image: 'logo',
                large_text: 'XenonStream',
            },
        })
    }

    public setStreamingPresence(type: string, target: string) {
        if (!this.isEnabled()) {
            return
        }
        if (!this._socket) {
            this.connect()
        }
        const details = type === 'home' ? 'Streaming from Console' : 'Streaming from xCloud'
        const titleName = this.getTitleName(type, target)
        const titleImage = this.getTitleImage(type, target)

        this.sendActivity({
            details,
            state: `Playing ${titleName}`,
            timestamps: { start: Math.floor(Date.now() / 1000) },
            assets: {
                large_image: titleImage,
                large_text: titleName,
                small_image: 'logo',
                small_text: 'XenonStream',
            },
        })
    }

    public clearPresence() {
        this.sendActivity(null)
    }

    private getTitleName(type: string, target: string): string {
        if (type === 'home') {
            const consoles = this._application._ipc?._channels?.consoles?._consoles || []
            const found = consoles.find((c: any) => c.serverId === target)
            return found ? found.deviceName : target
        }
        const title = this._application._ipc?._channels?.xCloud?._titleManager?.findTitle(target)
        return title?.catalogDetails?.ProductTitle || target
    }

    private getTitleImage(type: string, target: string): string {
        if (type === 'home') {
            return 'logo'
        }
        const title = this._application._ipc?._channels?.xCloud?._titleManager?.findTitle(target)
        return title?.catalogDetails?.Image_Tile?.URL ? 'https:' + title.catalogDetails.Image_Tile.URL : 'logo'
    }
}
