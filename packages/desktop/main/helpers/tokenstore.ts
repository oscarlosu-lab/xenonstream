import { app, safeStorage } from 'electron'
import { TokenStore } from 'xal-node'
import Store from 'electron-store'

const ENCRYPTED_PREFIX = 'enc:v1:'

function isEncryptionAvailable(): boolean {
    return !!safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
}

// safeStorage only works after the app 'ready' event. Before it, "unavailable" says nothing about the OS.
function isAppReady(): boolean {
    return !app || typeof app.isReady !== 'function' || app.isReady()
}

export function encryptTokenPayload(plaintextJson: string): string {
    if (isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plaintextJson)
        return ENCRYPTED_PREFIX + encrypted.toString('base64')
    }
    if (!isAppReady()) {
        throw new Error('Token payload cannot be encrypted before the app is ready')
    }
    console.warn('AuthTokenStore: OS safeStorage encryption is unavailable; falling back to unencrypted token storage.')
    return plaintextJson
}

export function decryptTokenPayload(stored: string): string {
    if (!stored || typeof stored !== 'string') {
        return '{}'
    }
    if (stored.startsWith(ENCRYPTED_PREFIX)) {
        if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
            throw new Error('Encrypted token payload cannot be decrypted because OS safeStorage is unavailable')
        }
        const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')
        return safeStorage.decryptString(buf)
    }
    return stored
}

export default class AuthTokenStore extends TokenStore {

    private _store:Store

    // Share the application store: separate instances cache the file and overwrite each other's writes
    constructor(store:Store){
        super()
        this._store = store
    }

    load() {
        const raw = this._store.get('user.tokenstore', '{}') as string

        let decrypted: string
        try {
            decrypted = decryptTokenPayload(raw)
        } catch (error) {
            // Start signed out but keep the stored (encrypted) tokens untouched, so they can be read again later.
            console.warn('AuthTokenStore: stored tokens could not be decrypted; starting signed out.', (error as Error)?.message)
            this.loadJson('{}')
            return false
        }
        this.loadJson(decrypted)

        // Transparently migrate legacy plaintext tokens to OS-encrypted storage (Windows DPAPI)
        if (raw !== '{}' && !raw.startsWith(ENCRYPTED_PREFIX) && isEncryptionAvailable()) {
            this._store.set('user.tokenstore', encryptTokenPayload(decrypted))
        }

        return true
    }

    save() {
        const data = JSON.stringify({
            userToken: this._userToken?.data,
            sisuToken: this._sisuToken?.data,
            jwtKeys: this._jwtKeys,
        })

        try {
            this._store.set('user.tokenstore', encryptTokenPayload(data))
        } catch (error) {
            // Never write tokens in plaintext because the app was not ready yet; keep what is stored.
            console.warn('AuthTokenStore: tokens not saved.', (error as Error)?.message)
        }
    }

    clear() {
        this._store.delete('user.tokenstore')
        this._userToken = undefined
        this._sisuToken = undefined
        this._jwtKeys = undefined
    }

    removeAll() {
        this._userToken = undefined
        this._sisuToken = undefined

        this._store.delete('user.tokenstore')
    }
}
