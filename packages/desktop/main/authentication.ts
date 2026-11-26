import { session, dialog, shell, clipboard } from 'electron'
import { createWindow } from './helpers'
import Application from './application'
import { Msal } from 'xal-node'
import AuthTokenStore from './helpers/tokenstore'
import type { DeviceLogin } from '../device-login'
import i18n from 'i18next';

// After a refresh, tokens refused within this time are not renewed again: the refused call was sent before
// the refresh, or new tokens do not help (this avoids hitting the authentication servers on every call).
const REFRESH_COOLDOWN = 30*1000

export default class Authentication {
    _application:Application

    _tokenStore:AuthTokenStore
    _msal:Msal

    _authWindow
    _authCallback
    _deviceCodeDialog:AbortController

    _isAuthenticating:boolean = false
    _isAuthenticated:boolean = false
    _appLevel:number = 0

    _refreshPromise:Promise<void>|undefined
    _lastRefresh = 0
    deviceLogin:DeviceLogin | null = null
    private deviceLoginInProgress = false
    private t = i18n.t.bind(i18n);

    constructor(application:Application){
        this._application = application
        // Tokens are loaded lazily in checkAuthentication(): the constructor runs before the app 'ready' event,
        // and on Windows OS safeStorage (DPAPI) cannot decrypt the stored tokens until then.
        this._tokenStore = new AuthTokenStore(application._store)
        this._msal = new Msal(this._tokenStore)
    }

    checkAuthentication(){
        this._application.log('authenticationV2', '[checkAuthentication()] Starting token check...')
        this._tokenStore.load()
        if(this._tokenStore.hasValidAuthTokens()){

            // Deprecate xal token.
            if(this._tokenStore.getUserToken() !== undefined && this._tokenStore.getUserToken().data.scope != 'XboxLive.signin'){
                this._application.log('authenticationV2', '[checkAuthentication()] Deprecating old XAL token scope. Starting auth flow to get new tokens.')
                return false
            }

            this._application.log('authenticationV2', '[checkAuthentication()] Tokens are valid:', this._tokenStore.getUserToken())
            this.startSilentFlow()

            return true

        } else {
            if(this._tokenStore.getUserToken() !== undefined){
                // We have a user token, lets try to refresh it.
                this._application.log('authenticationV2', '[checkAuthentication()] Tokens are expired but we have a user token. Lets try to refresh the tokens.')
                this.startSilentFlow()

                return true

            } else {
                this._application.log('authenticationV2', '[checkAuthentication()] No tokens are present.')
                return false
            }
        }
    }

    startSilentFlow(){
        this._application.log('authenticationV2', '[startSilentFlow()] Starting silent flow...')
        this._isAuthenticating = true

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this.getTokens()
    }

    getTokens(){
        this.getStreamingToken().then((streamingTokens) => {
            this._application.log('authenticationV2', '[getTokens()] Retrieved streaming tokens:', streamingTokens)

            if(streamingTokens.xCloudToken !== undefined){
                this._application.log('authenticationV2', '[getTokens()] Retrieved both xHome and xCloud tokens')
                this._appLevel = 2
            } else {
                this._application.log('authenticationV2', '[getTokens()] Retrieved xHome token only')
                this._appLevel = 1
            }

            this._msal.getWebToken().then((webToken) => {
                this._application.log('authenticationV2', __filename+'[getTokens()] Web token received')
                this._application.authenticationCompleted(streamingTokens, webToken)

            }).catch((error) => {
                this._isAuthenticating = false
                this._application.log('authenticationV2', __filename+'[getTokens()] Failed to retrieve web tokens:', error)
                void dialog.showMessageBox({
                    message: this.t('errors.failedToRetrieveWebTokens') + ' ' + JSON.stringify(error),
                    type: 'error',
                })
            })

        }).catch((err) => {
            this._application.log('authenticationV2', '[startSilentFlow()] Failed to retrieve streaming tokens:', err)
            void dialog.showMessageBox({
                message: this.t('errors.failedToRetrieveStreamingTokens'),
                type: 'error',
            })
            // @TODO: If we fail to get streaming tokens, we should probably start the auth flow to let the user re-authenticate and get new tokens.
            this.startAuthflow()
        })
    }

    // Gets new streaming and web tokens (xal-node renews the expired upstream tokens on its own) and gives them to the API clients.
    // Callers that arrive while a refresh is running share it.
    refreshApiTokens():Promise<void> {
        if(this._refreshPromise !== undefined){
            return this._refreshPromise
        }

        if(Date.now() - this._lastRefresh < REFRESH_COOLDOWN){
            this._application.log('authenticationV2', '[refreshApiTokens()] Tokens were refreshed moments ago, not refreshing again')
            return Promise.resolve()
        }

        this._application.log('authenticationV2', '[refreshApiTokens()] Refreshing API tokens...')

        this._refreshPromise = this.getStreamingToken().then((streamingTokens) => {
            return this._msal.getWebToken().then((webToken) => {
                this._application.setApiTokens(streamingTokens, webToken, true)
                this._lastRefresh = Date.now()
                this._application.log('authenticationV2', '[refreshApiTokens()] API tokens refreshed')
            })
        }).finally(() => {
            this._refreshPromise = undefined
        })

        return this._refreshPromise
    }

    async startAuthflow(){
        if(this.deviceLoginInProgress){
            return
        }

        this.deviceLoginInProgress = true
        this._isAuthenticating = true
        this._application.log('authenticationV2', '[startAuthflow()] Starting authentication flow')

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        try {
            const data = await this._msal.doDeviceCodeAuth()
            const verificationUri = new URL(data.verification_uri)
            if(verificationUri.protocol !== 'https:' || !data.user_code){
                throw new Error('Invalid device sign-in response')
            }
            const prefilledUrl = verificationUri.href + '?otc=' + encodeURIComponent(data.user_code)
            this.deviceLogin = { verificationUri: prefilledUrl, userCode: data.user_code }
            clipboard.writeText(data.user_code)

            await this._msal.doPollForDeviceCodeAuth(data.device_code, data.expires_in * 1000)
            this._application.log('authenticationV2', '[startAuthflow()] Device code authentication completed')
            this.getTokens()
        } catch (error) {
            this._isAuthenticating = false
            this._application.log('authenticationV2', '[startAuthflow()] Device code authentication failed:', error)
            dialog.showErrorBox('Error', this.t('errors.errorAuthentificationUser'))
        } finally {
            this.deviceLogin = null
            this.deviceLoginInProgress = false
        }
    }

    openDeviceCodeLink(verificationUri:string, userCode:string){
        // otc prefills the code on microsoft.com/link so the user only has to confirm
        const url = verificationUri + '?otc=' + encodeURIComponent(userCode)

        clipboard.writeText(userCode)
        this.openExternal(url)

        this._deviceCodeDialog = new AbortController()
        this.showDeviceCodeDialog(url, verificationUri, userCode)
    }

    showDeviceCodeDialog(url:string, verificationUri:string, userCode:string){
        dialog.showMessageBox({
            type: 'info',
            title: 'Sign in with Microsoft',
            message: 'Sign in with your browser',
            detail: 'A browser window has opened. If it did not, go to ' + verificationUri + ' and enter this code:\n\n' + userCode + '\n\nThe code has been copied to your clipboard. XenonStream will continue automatically after you sign in.',
            buttons: ['OK', 'Open browser', 'Copy code'],
            defaultId: 0,
            cancelId: 0,
            signal: this._deviceCodeDialog.signal,
        }).then(({ response }) => {
            if(response === 0 || this._deviceCodeDialog.signal.aborted)
                return

            if(response === 1){
                this.openExternal(url)
            } else {
                clipboard.writeText(userCode)
            }
            // Keep the code visible until the user dismisses it
            this.showDeviceCodeDialog(url, verificationUri, userCode)
        }).catch((error) => {
            this._application.log('authenticationV2', '[showDeviceCodeDialog()] Failed to show device code dialog:', error)
        })
    }

    openExternal(url:string){
        shell.openExternal(url).catch((error) => {
            this._application.log('authenticationV2', '[openExternal()] Failed to open browser:', error)
        })
    }

    getAccounts(){
        return this._application._store.get('accounts.list', {}) as Record<string, any>
    }

    getActiveAccount(){
        return this._application._store.get('accounts.active', '') as string
    }

    // Snapshot the signed in user (tokens + cached profile) into the accounts list
    saveActiveAccount(xuid?:string){
        const store = this._application._store
        if(xuid === undefined)
            xuid = this.getActiveAccount()

        if(! xuid || store.get('user.tokenstore') === undefined)
            return

        store.set('accounts.list.'+xuid, {
            xuid: xuid,
            gamertag: store.get('user.gamertag', ''),
            gamerpic: store.get('user.gamerpic', ''),
            gamerscore: store.get('user.gamerscore', ''),
            tokenstore: store.get('user.tokenstore'),
        })
        store.set('accounts.active', xuid)
    }

    switchAccount(xuid:string){
        const account = this.getAccounts()[xuid]
        if(account === undefined)
            throw new Error('Account not found: '+xuid)

        this.saveActiveAccount()

        const store = this._application._store
        store.delete('user')
        store.set('user.tokenstore', account.tokenstore)
        store.set('user.gamertag', account.gamertag)
        store.set('user.gamerpic', account.gamerpic)
        store.set('user.gamerscore', account.gamerscore)
        store.set('accounts.active', xuid)

        // Keep the in-memory tokens in sync (decrypting via safeStorage) so a pending save cannot restore the previous account
        this._tokenStore.load()
        this._application.restart()
    }

    addAccount(){
        this.saveActiveAccount()

        // Without tokens the app starts the sign in flow after restart
        this._tokenStore.clear()
        this._application._store.delete('user')
        this._application._store.set('accounts.active', '')
        this._application.restart()
    }

    removeAccount(xuid:string){
        const store = this._application._store
        const isActive = (xuid === this.getActiveAccount())
        store.delete('accounts.list.'+xuid as any)

        if(! isActive)
            return

        this._tokenStore.clear()
        store.delete('user')
        store.set('accounts.active', '')

        const remaining = Object.keys(this.getAccounts())
        if(remaining.length > 0){
            this.switchAccount(remaining[0])
        } else {
            this._application.restart()
        }
    }

    openAuthWindow(url){
        const authWindow = createWindow('auth', {
            width: 500,
            height: 600,
            title: this.t('auth.windowTitle'),
        })

        authWindow.loadURL(url).catch((error) => {
            this._application.log('authenticationV2', '[openAuthWindow()] Failed to load auth url:', error)
        })
        this._authWindow = authWindow

        this._authWindow.on('close', () => {
            this._application.log('authenticationV2', '[openAuthWindow()] Closed auth window')
            // @TODO: What to do?
        })
    }

    async getStreamingToken(){
        const userToken = this._tokenStore.getUserToken()
        if(userToken === undefined)
            throw new Error( this.t('errors.sisuTokenIsMissing') )

        this._application.log('authenticationV2', '[getStreamingToken()] Found local token:', userToken)

        const streamingTokens = await this._msal.getStreamingTokens()
        this._application.log('authenticationV2', '[getStreamingToken()] Retrieved streaming tokens:', streamingTokens)

        return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: streamingTokens.xCloudToken }
        // return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: undefined }
    }


}
