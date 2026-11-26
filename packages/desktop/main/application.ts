import { app as ElectronApp, BrowserWindow, dialog } from 'electron'
import serve from 'electron-serve'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import Debug from 'debug'
import { createWindow, xboxWorker, updater } from './helpers'
import { formatInstanceWindowTitle, parseStartupFlags, resolveInstanceUserDataPath, StartupFlags } from './helpers/instanceProfile'
import { setMainLanguage } from './helpers/i18n'
import Authentication from './authentication'
import Ipc from './ipc'
import WebUI from './webui'
import DiscordManager from './helpers/discord'

import xboxWebApi from 'xbox-webapi'
import xCloudApi from './helpers/xcloudapi'

import pkg from '../package.json'

import i18n from 'i18next';

const DEV_SERVER_ORIGIN = 'http://localhost'
const DEV_SERVER_PORT_PATTERN = /^\d{1,5}$/
const MIN_DEV_SERVER_PORT = 1
const MAX_DEV_SERVER_PORT = 65535
const DEFAULT_DEV_SERVER_PORT = 3000

/**
 * Parses the renderer dev-server port that nextron hands to the main process
 * as a command line argument (`electron . <port> [options]`).
 *
 * Command line arguments can be controlled by everything that is able to
 * launch the application, so the value is strictly validated. Only plain
 * decimal numbers inside the valid port range are accepted.
 */
const parseDevServerPort = (rawPort:string|undefined):number => {
    if(rawPort === undefined || rawPort === ''){
        return DEFAULT_DEV_SERVER_PORT
    }

    const port = Number.parseInt(rawPort, 10)

    if(!DEV_SERVER_PORT_PATTERN.test(rawPort) || !Number.isInteger(port) || port < MIN_DEV_SERVER_PORT || port > MAX_DEV_SERVER_PORT){
        throw new Error(`Invalid renderer dev-server port: ${rawPort}`)
    }

    return port
}

export default class Application {

    private _log
    public _store: Store
    private _startupFlags: StartupFlags = {
        fullscreen: false,
        autoStream: '',
        profile: '',
        consoleId: '',
    }

    public _isProduction:boolean = (process.env.NODE_ENV === 'production')
    private _isCi:boolean = (process.env.CI !== undefined)
    private _isMac:boolean = (process.platform === 'darwin')
    private _isWindows:boolean = (process.platform === 'win32')
    private _isQuitting:boolean = false

    public _mainWindow
    public _ipc:Ipc
    public _webUI:WebUI
    public _discord:DiscordManager
    public _authentication:Authentication

    private t = i18n.t.bind(i18n);

    constructor(){
        console.log(__filename+'[constructor()] Starting XenonStream v'+pkg.version)
        this._log = Debug('xenonstream')

        // ElectronApp.commandLine.appendSwitch('use-vulkan')
        // ElectronApp.commandLine.appendSwitch('use-angle', 'vulkan')
        // ElectronApp.commandLine.appendSwitch('enable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,VaapiVideoDecoder,PlatformHEVCDecoderSupport,CanvasOopRasterization')
        // ElectronApp.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder')
        // ElectronApp.commandLine.appendSwitch('enable-gpu-rasterization')
        // ElectronApp.commandLine.appendSwitch('enable-oop-rasterization')
        ElectronApp.commandLine.appendSwitch('enable-accelerated-video-decode')
        const enabledFeatures = ['WebRtcAllowH265Receive']
        if (process.platform === 'linux') {
            enabledFeatures.push('VaapiVideoDecoder', 'VaapiVideoDecodeLinuxGL', 'UseOzonePlatform')
            ElectronApp.commandLine.appendSwitch('ozone-platform-hint', 'auto')
        }
        // Let WebRTC offer H.265 for receiving (and enable Linux VA-API/Wayland when on Linux)
        ElectronApp.commandLine.appendSwitch('enable-features', enabledFeatures.join(','))
        ElectronApp.commandLine.appendSwitch('enable-zero-copy')

        this.readStartupFlags()
        this.applyInstanceProfile()

        // Enforce one running process per userData profile so two instances never
        // corrupt the same electron-store / encrypted tokenstore, while allowing
        // separate --profile=<name> instances to run concurrently.
        if (this._isCi === false && !ElectronApp.requestSingleInstanceLock()) {
            this.log('application', __filename+'[constructor()] Another instance is already running for this profile. Quitting.')
            ElectronApp.quit()
            return
        }

        ElectronApp.on('second-instance', () => {
            if (this._mainWindow) {
                if (this._mainWindow.isMinimized()) {
                    this._mainWindow.restore()
                }
                this._mainWindow.show()
                this._mainWindow.focus()
            }
        })

        this._store = new Store({ cwd: ElectronApp.getPath('userData') })
        this.loadApplicationDefaults()

        // ElectronApp.removeAsDefaultProtocolClient('ms-xal-public-beta-000000004c20a908')

        this._ipc = new Ipc(this)
        this._authentication = new Authentication(this)

        this._ipc.startUp()
        this._webUI = new WebUI(this)
        this._discord = new DiscordManager(this)
        this._discord.syncWithSettings()
    }

    log(namespace = 'application', ...args){
        this._log.extend(namespace)(...args)
    }

    getStartupFlags(){
        return this._startupFlags
    }

    resetAutostream(){
        this._startupFlags.autoStream = ''
    }

    readStartupFlags(){
        this.log('application', __filename+'[readStartupFlags()] Program args detected:', process.argv)
        this._startupFlags = parseStartupFlags(process.argv)
        this.log('application', __filename+'[readStartupFlags()] End result of startupFlags:', this._startupFlags)
    }

    applyInstanceProfile(){
        if (this._isCi === true) {
            const random = randomUUID()
            const ciDir = `${ElectronApp.getPath('userData')} (${random})`
            ElectronApp.setPath('userData', ciDir)
            ElectronApp.setPath('sessionData', ciDir)
            return
        }

        let targetUserData = ElectronApp.getPath('userData')
        if (this._isProduction === false) {
            targetUserData = `${targetUserData} (development)`
        }
        if (this._startupFlags.profile) {
            targetUserData = resolveInstanceUserDataPath(targetUserData, this._startupFlags.profile)
            this.log('application', __filename+'[applyInstanceProfile()] Isolated profile userData:', targetUserData)
        }
        ElectronApp.setPath('userData', targetUserData)
        ElectronApp.setPath('sessionData', targetUserData)
    }

    loadApplicationDefaults(){
        if(this._isProduction === true && this._isCi === false) {
            serve({ directory: 'app' })

        } else if(this._isCi === true) {
            this._store.delete('user')
            this._store.delete('auth')

            serve({ directory: 'app' })
        }

        ElectronApp.whenReady().then(() => {
            // Translate native dialogs with the language selected in the settings
            const settings = this._store.get('settings', {}) as { language?: string }
            setMainLanguage(settings.language)

            updater({
                // debug: true,
                silent: true,
                prereleases: (ElectronApp.getVersion().includes('beta')) ? true : false,
            }, this)

            this.log('electron', __filename+'[loadApplicationDefaults()] Electron has been fully loaded. Ready to open windows')

            this.openMainWindow()

            // Check authentication
            if(! this._authentication.checkAuthentication()){
                this._authentication.startAuthflow()
            }

        }).catch((error) => {
            this.log('electron', __filename+'[loadApplicationDefaults()] Electron has failed to load:', error)
        })

        ElectronApp.on('window-all-closed', () => {
            if(this._isMac === true){
                this.log('electron', __filename+'[loadApplicationDefaults()] Electron detected that all windows are closed. Running in background...')

            } else {
                this.log('electron', __filename+'[loadApplicationDefaults()] Electron detected that all windows are closed. Quitting app...')
                ElectronApp.quit()
            }
        })

        ElectronApp.on('activate', () => {
            (this._mainWindow !== undefined) ? this._mainWindow.show() : this.openMainWindow()
        })
        ElectronApp.on('before-quit', () => this._isQuitting = true)
    }

    _webApi:xboxWebApi
    _xHomeApi:xCloudApi
    _xCloudApi:xCloudApi
    _xboxWorker:xboxWorker


    // Creates the API clients with the given tokens. On a token refresh (keepStreamClients) the existing xCloudApi instances
    // only get the new token and keep their host, because they hold the state of the running stream session.
    setApiTokens(streamingTokens, webToken, keepStreamClients = false){
        this._xHomeApi = this.streamApiWithToken(this._xHomeApi, streamingTokens.xHomeToken, 'home', keepStreamClients)

        if(streamingTokens.xCloudToken !== undefined){
            this._xCloudApi = this.streamApiWithToken(this._xCloudApi, streamingTokens.xCloudToken, 'cloud', keepStreamClients)
        }

        this._webApi = new xboxWebApi({
            token: webToken.data.Token,
            uhs: webToken.data.DisplayClaims.xui[0].uhs,
        })
    }

    private streamApiWithToken(current:xCloudApi|undefined, streamingToken, type:'home'|'cloud', keepClient:boolean):xCloudApi {
        if(keepClient && current !== undefined){
            current.setToken(streamingToken.data.gsToken)
            return current
        }
        const host = streamingToken.data.offeringSettings.regions.find(region => region.isDefault).baseUri.substring(8)
        return new xCloudApi(this, host, streamingToken.data.gsToken, type)
    }

    // Renews the API tokens after one was refused (see helpers/tokenrefresh.ts).
    refreshApiTokens():Promise<void> {
        return this._authentication.refreshApiTokens()
    }

    authenticationCompleted(streamingTokens, webToken){
        this.log('electron', __filename+'[authenticationCompleted()] authenticationCompleted called')
        this.setApiTokens(streamingTokens, webToken)

        this._authentication._isAuthenticating = false
        this._authentication._isAuthenticated = true

        this._webApi.providers.profile.get('/users/me/profile/settings?settings=GameDisplayName,GameDisplayPicRaw,Gamerscore,Gamertag').then((result) => {
            if(result.data.profileUsers.length > 0) {
                for(const setting in result.data.profileUsers[0].settings){

                    if(result.data.profileUsers[0].settings[setting].id === 'Gamertag'){
                        this._store.set('user.gamertag', result.data.profileUsers[0].settings[setting].value)

                    } else if(result.data.profileUsers[0].settings[setting].id === 'GameDisplayPicRaw'){
                        this._store.set('user.gamerpic', result.data.profileUsers[0].settings[setting].value)

                    } else if(result.data.profileUsers[0].settings[setting].id === 'Gamerscore'){
                        this._store.set('user.gamerscore', result.data.profileUsers[0].settings[setting].value)
                    }
                }
            }

            this._authentication.saveActiveAccount(webToken.data.DisplayClaims.xui[0].xid)

            // Run workers
            this._xboxWorker = new xboxWorker(this)
            this._ipc.onUserLoaded()

        }).catch((error) => {
            this.log('electron', __filename+'[authenticationCompleted()] Failed to retrieve user profile:', error)
            dialog.showMessageBox({
                message: this.t('errors.failedToRetrieveUserProfile') + JSON.stringify(error),
                type: 'error',
            })
        })
    }

    openMainWindow(){
        this.log('electron', __filename+'[openMainWindow()] Creating new main window')

        const windowOptions:any = {
            title: formatInstanceWindowTitle(this._startupFlags.profile, this._startupFlags.consoleId),
            backgroundColor: '#060a0d',
        }
        if(this._startupFlags.fullscreen === true){
            windowOptions.fullscreen = true
        }

        this._mainWindow = createWindow('main', {
            width: 1280,
            height: 800,
            ...windowOptions,
        })

        this._mainWindow.on('show', () => {
            this.log('electron', __filename+'[openMainWindow()] Showing Main window.')
        })

        this._mainWindow.on('close', (event) => {
            if(this._isMac === true && this._isQuitting === false){
                event.preventDefault()
                this.log('electron', __filename+'[openMainWindow()] Main window has been hidden')
                this._mainWindow.hide()
            } else {
                this.log('electron', __filename+'[openMainWindow()] Main window has been closed')
                this._mainWindow = undefined
            }
        })

        if (this._isProduction === true && this._isCi === false) {
            this._mainWindow.loadURL('app://./home.html')
        } else {
            const devServerUrl = new URL(DEV_SERVER_ORIGIN)
            devServerUrl.port = String(parseDevServerPort(process.argv[2]))
            devServerUrl.pathname = '/home'

            this._mainWindow.loadURL(devServerUrl.toString())

            if(this._isCi !== true){
                this._mainWindow.webContents.openDevTools()
                this.openGPUWindow()
            }
        }
    }

    _gpuWindow

    openGPUWindow(){
        this._gpuWindow = new BrowserWindow({
            width: 800,
            height: 600,
        })

        // Load chrome://gpu
        this._gpuWindow.loadURL('chrome://gpu')

        // Open DevTools
        this._gpuWindow.webContents.openDevTools()
    }

    quit(){
        ElectronApp.quit()
    }

    restart(){
        this.quit()
        ElectronApp.relaunch()
    }
}

// Bootstrap the app. The Application constructor performs all startup side effects,
// so the instance is assigned (and exported) instead of being discarded.
export const application = new Application()
