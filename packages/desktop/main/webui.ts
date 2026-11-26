import Application from './application'
import express from 'express'
import expressWS from 'express-ws'
import expressProxy from 'express-http-proxy'
import path from 'path'
import Ipc from './ipc'
import { defaultSettings } from '../renderer/context/userContext.defaults'

export default class WebUI {
    _application:Application
    _express?: ReturnType<typeof express> & { ws?: (path: string, handler: (ws: any) => void) => void }
    _ws:expressWS
    _ipc:Ipc
    _server
    private _originalChannelSend: Record<string, any> = {}
    private _activeSockets: Set<any> = new Set()

    constructor(application:Application){
        this._application = application
        this._application.log('webui', 'Loaded WebUI Plugin')

        const rawSettings = this._application._store.get('settings', defaultSettings) as object
        const settings = {...defaultSettings, ...rawSettings}

        // this._application.log('webui', 'Settings:', settings, rawSettings)

        if(settings.webui_autostart === true){
            this.startServer(settings.webui_port)
        } else {
            this._application._store.set('settings', {...settings, webui_enabled: false})
        }
    }

    startServer(port:number = 3000){
        this._application.log('webui', 'Starting webserver...')
        this._express = express()
        this._ws = expressWS(this._express)
        this._ipc = this._application._ipc

        // this._application._events.on('start', () => {
        //     this._ipc.onUserLoaded()
        // })

        this._express.get('/', (req, res) => {
            // res.send('Hello World!')
            // res.sendFile(path.join(__dirname, "../app/", "home.html"));
            res.redirect('/home')
        })

        this._express.ws('/ipc', (ws) => {
            this._activeSockets.add(ws)

            // Websocket ipc hack
            for(const channel in this._ipc._channels){
                if(!(channel in this._originalChannelSend)){
                    this._originalChannelSend[channel] = this._ipc._channels[channel].send
                }

                this._ipc._channels[channel].send = (channel, args) => {
                    console.log('HOOKED IPC:', channel, args)
                    if(ws.readyState === 1){
                        ws.send(JSON.stringify({
                            channel: channel,
                            id: args.id,
                            action: args.action,
                            data: args.data,
                        }))
                    }

                    this._application._mainWindow?.webContents?.send(channel, {
                        action: args.action,
                        id: args.id,
                        data: args.data,
                        error: args.error,
                    })
                }
            }

            ws.on('message', (msg) => {
                let ipcData: any
                try {
                    ipcData = JSON.parse(typeof msg === 'string' ? msg : msg.toString())
                } catch(error) {
                    this._application.log('webui:websocket', 'Invalid JSON message:', error)
                    return
                }
                this._application.log('webui:websocket', 'Received event:', ipcData)

                const channelHandler = this._application._webUI?._ipc?._channels?.[ipcData.channel]
                if(channelHandler !== undefined){
                    channelHandler.onEvent(ipcData.channel, undefined, {
                        action: ipcData.action,
                        id: ipcData.id || 0,
                        data: ipcData.data,
                    })
                }

                // ws.send(msg);
            })

            ws.on('close', () => {
                this._activeSockets.delete(ws)
                if(this._activeSockets.size === 0){
                    this.restoreIpcSend()
                }
            })
        })

        if(this._application._isProduction){
            this._express.use(express.static(path.join(__dirname, '../app/')))

            // Express 5 (path-to-regexp v8) no longer accepts a bare '*' wildcard
            this._express.get('/{*splat}', (req, res) => {
                // res.send('Hello World!')
                res.sendFile(path.join(__dirname, '../app/', 'home.html'))
            })
        } else {
            this._express.use(expressProxy('localhost', { port: 8888}))
        }


        this._server = this._express.listen(port, () => {
            this._application.log('webui', 'Webserver running on port:', port)
            console.log(`Webserver started on port: ${port}`)
        })
    }

    private restoreIpcSend(): void {
        if(this._ipc === undefined){
            return
        }
        for(const channel in this._originalChannelSend){
            if(this._ipc._channels[channel] !== undefined){
                this._ipc._channels[channel].send = this._originalChannelSend[channel]
            }
        }
        this._originalChannelSend = {}
    }

    stopServer(){
        this._application.log('webui', 'Stopping webserver...')
        for(const ws of this._activeSockets){
            ws.close?.()
        }
        this._activeSockets.clear()
        this.restoreIpcSend()
        if(this._express){
            this._server?.close()
            delete this._express
        }
    }
}