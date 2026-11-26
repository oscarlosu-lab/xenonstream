const mockEncrypt = jest.fn((plain: string) => Buffer.from(`DPAPI::${plain}`, 'utf8'))
const mockDecrypt = jest.fn((buf: Buffer) => {
    const str = buf.toString('utf8')
    if (!str.startsWith('DPAPI::')) {
        throw new Error('Invalid ciphertext')
    }
    return str.slice('DPAPI::'.length)
})

// Simulates Electron on Windows: safeStorage is only available after the app 'ready' event.
let mockAppReady = true
jest.mock('electron', () => ({
    app: {
        isReady: jest.fn(() => mockAppReady),
    },
    safeStorage: {
        isEncryptionAvailable: jest.fn(() => mockAppReady),
        encryptString: mockEncrypt,
        decryptString: mockDecrypt,
    },
}))

jest.mock('xal-node', () => ({
    TokenStore: class MockTokenStore {
        _userToken: any
        _sisuToken: any
        _jwtKeys: any
        loadJson(json: string) {
            const parsed = JSON.parse(json)
            if (parsed.userToken) this._userToken = { data: parsed.userToken }
            if (parsed.sisuToken) this._sisuToken = { data: parsed.sisuToken }
            if (parsed.jwtKeys) this._jwtKeys = parsed.jwtKeys
        }
    },
}))

import AuthTokenStore, { decryptTokenPayload, encryptTokenPayload } from '../../main/helpers/tokenstore'

describe('AuthTokenStore safeStorage encryption (RED security gate)', () => {
    function createMemoryStore() {
        const map = new Map<string, any>()
        return {
            get: (k: string, def?: any) => (map.has(k) ? map.get(k) : def),
            set: (k: string, v: any) => { map.set(k, v) },
            delete: (k: string) => { map.delete(k) },
            _map: map,
        }
    }

    test('save() encrypts tokens via safeStorage with enc:v1: prefix and never writes plaintext secrets', () => {
        const mem = createMemoryStore()
        const ts = new AuthTokenStore(mem as any)
        ;(ts as any)._userToken = { data: { Token: 'SECRET_ACCESS_TOKEN_123' } }
        ;(ts as any)._sisuToken = { data: { Token: 'SECRET_SISU_TOKEN_456' } }

        ts.save()

        const stored = mem.get('user.tokenstore') as string
        expect(stored.startsWith('enc:v1:')).toBe(true)
        expect(stored).not.toContain('SECRET_ACCESS_TOKEN_123')
        expect(stored).not.toContain('SECRET_SISU_TOKEN_456')

        const ts2 = new AuthTokenStore(mem as any)
        ts2.load()
        expect((ts2 as any)._userToken.data.Token).toBe('SECRET_ACCESS_TOKEN_123')
        expect((ts2 as any)._sisuToken.data.Token).toBe('SECRET_SISU_TOKEN_456')
    })

    test('load() transparently migrates legacy plaintext tokens to encrypted safeStorage', () => {
        const mem = createMemoryStore()
        mem.set('user.tokenstore', JSON.stringify({ userToken: { Token: 'LEGACY_PLAIN_TOKEN' } }))

        const ts = new AuthTokenStore(mem as any)
        ts.load()

        expect((ts as any)._userToken.data.Token).toBe('LEGACY_PLAIN_TOKEN')
        const migrated = mem.get('user.tokenstore') as string
        expect(migrated.startsWith('enc:v1:')).toBe(true)
        expect(migrated).not.toContain('LEGACY_PLAIN_TOKEN')
    })

    test('clear() removes stored encrypted payload and wipes in-memory token references', () => {
        const mem = createMemoryStore()
        const ts = new AuthTokenStore(mem as any)
        ;(ts as any)._userToken = { data: { Token: 'SECRET' } }
        ts.save()
        expect(mem.get('user.tokenstore')).toBeDefined()

        ts.clear()
        expect(mem.get('user.tokenstore')).toBeUndefined()
        expect((ts as any)._userToken).toBeUndefined()
        expect((ts as any)._sisuToken).toBeUndefined()
    })

    test('encryptTokenPayload and decryptTokenPayload round-trip cleanly', () => {
        const enc = encryptTokenPayload('{"k":"v"}')
        expect(enc.startsWith('enc:v1:')).toBe(true)
        expect(decryptTokenPayload(enc)).toBe('{"k":"v"}')
    })

    describe('before the app is ready (second launch regression)', () => {
        afterEach(() => {
            mockAppReady = true
        })

        test('load() of an encrypted payload does not throw, starts signed out and keeps the stored tokens', () => {
            const mem = createMemoryStore()
            const ts = new AuthTokenStore(mem as any)
            ;(ts as any)._userToken = { data: { Token: 'SECRET_FROM_FIRST_LAUNCH' } }
            ts.save()
            const stored = mem.get('user.tokenstore') as string

            mockAppReady = false
            const early = new AuthTokenStore(mem as any)
            expect(() => early.load()).not.toThrow()
            expect(early.load()).toBe(false)
            expect((early as any)._userToken).toBeUndefined()
            expect(mem.get('user.tokenstore')).toBe(stored)

            mockAppReady = true
            const ready = new AuthTokenStore(mem as any)
            expect(ready.load()).toBe(true)
            expect((ready as any)._userToken.data.Token).toBe('SECRET_FROM_FIRST_LAUNCH')
        })

        test('save() never writes plaintext tokens and keeps the stored payload', () => {
            const mem = createMemoryStore()
            mem.set('user.tokenstore', 'enc:v1:previous')

            mockAppReady = false
            const ts = new AuthTokenStore(mem as any)
            ;(ts as any)._userToken = { data: { Token: 'SECRET_EARLY' } }
            expect(() => ts.save()).not.toThrow()
            expect(mem.get('user.tokenstore')).toBe('enc:v1:previous')
        })

        test('encryptTokenPayload refuses to fall back to plaintext before the app is ready', () => {
            mockAppReady = false
            expect(() => encryptTokenPayload('{"k":"v"}')).toThrow()
        })
    })
})
