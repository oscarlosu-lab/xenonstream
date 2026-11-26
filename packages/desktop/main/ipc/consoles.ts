import IpcBase from './base'
import { withTokenRefresh } from '../helpers/tokenrefresh'

export default class IpcConsoles extends IpcBase {
    // _streamingSessions:any = {}

    _consoles = []
    _consolesLastUpdate = 0

    get(){
        if(this._consolesLastUpdate >= Date.now() - 60*1000){
            return Promise.resolve(this._consoles)
        }
        return withTokenRefresh(this._application, () => {
            if(!this._application._webApi){
                return Promise.reject(new Error('Xbox Web API is not initialized (status 401)'))
            }
            return this._application._webApi.providers.smartglass.getConsolesList()
        }).then((consoles) => {
            this._consoles = consoles?.data?.result || []
            this._consolesLastUpdate = Date.now()
            return this._consoles
        })
    }

    // Same as get(), but ignores the one minute cache so the power state is up to date.
    refresh(){
        this._consolesLastUpdate = 0

        return this.get()
    }

    // Wakes the console from standby (needs remote features enabled on the console).
    powerOn(args){
        return this.sendPowerCommand(args.consoleId, 'powerOn')
    }

    // Turns the console off (or to standby, depending on its power mode). A running game is closed.
    powerOff(args){
        return this.sendPowerCommand(args.consoleId, 'powerOff')
    }

    sendPowerCommand(consoleId: string, command: 'powerOn' | 'powerOff'){
        return withTokenRefresh(this._application, () => {
            if(!this._application._webApi){
                return Promise.reject(new Error('Xbox Web API is not initialized (status 401)'))
            }
            return this._application._webApi.providers.smartglass[command](consoleId)
        }).then(() => {
            this._consolesLastUpdate = 0
            return true
        })
    }
}
