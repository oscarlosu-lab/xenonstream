jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

import * as reactQuery from 'react-query'
import IpcConsoles from '../../main/ipc/consoles'
import { isUnauthorizedError } from '../../main/helpers/tokenrefresh'
import Home from '../../renderer/pages/home'
import Card from '../../renderer/components/ui/card'
import { createHookHarness, findElementByType } from './testhelper'

describe('My Consoles 401 token refresh & expired-session fallback', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('isUnauthorizedError recognizes HTTP 401 status, statusCode, response.status, and token_expired messages', () => {
        expect(isUnauthorizedError({ status: 401 })).toBe(true)
        expect(isUnauthorizedError({ statusCode: 401 })).toBe(true)
        expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true)
        expect(isUnauthorizedError(new Error('Request failed with status code 401'))).toBe(true)
        expect(isUnauthorizedError(new Error('HTTP 401 Unauthorized'))).toBe(true)
        expect(isUnauthorizedError(new Error('token_expired'))).toBe(true)
        expect(isUnauthorizedError(new Error('{"statuscode": 401}'))).toBe(true)
        expect(isUnauthorizedError(new Error('titleId 401 not found'))).toBe(false)
        expect(isUnauthorizedError(new Error('Network timeout'))).toBe(false)
    })

    test('IpcConsoles.get() and powerOn() refresh tokens on 401 and retry once', async () => {
        let getCalls = 0
        let powerCalls = 0
        const getConsolesList = jest.fn(() => {
            getCalls++
            if (getCalls === 1) {
                return Promise.reject(new Error('{"statuscode": 401}'))
            }
            return Promise.resolve({ data: { result: [{ id: 'XBOX1', name: 'Series X', powerState: 'On' }] } })
        })
        const powerOn = jest.fn(() => {
            powerCalls++
            if (powerCalls === 1) {
                return Promise.reject({ statusCode: 401 })
            }
            return Promise.resolve({})
        })

        const refreshApiTokens = jest.fn(() => Promise.resolve())
        const mockApp: any = {
            log: jest.fn(),
            refreshApiTokens,
            _webApi: { providers: { smartglass: { getConsolesList, powerOn, powerOff: jest.fn() } } },
        }

        const ipc = new IpcConsoles(mockApp)
        const list = await ipc.get()
        expect(list).toEqual([{ id: 'XBOX1', name: 'Series X', powerState: 'On' }])
        expect(refreshApiTokens).toHaveBeenCalledTimes(1)

        const ok = await ipc.powerOn({ consoleId: 'XBOX1' })
        expect(ok).toBe(true)
        expect(refreshApiTokens).toHaveBeenCalledTimes(2)
    })

    test('Home renders a non-crashing error Card with Retry when consoles.isError is true and data is undefined', () => {
        const harness = createHookHarness()
        const refetch = jest.fn(() => Promise.resolve({} as any))
        jest.spyOn(reactQuery, 'useQueryClient').mockReturnValue({ setQueryData: jest.fn() } as any)
        jest.spyOn(reactQuery, 'useQuery').mockReturnValue({
            isLoading: false,
            isFetched: true,
            isError: true,
            error: new Error('token_expired'),
            data: undefined,
            refetch,
        } as any)

        const mounted = harness.mount(Home, {})
        const output = mounted.getOutput()
        const errorCard = findElementByType(output, Card)
        expect(errorCard).toBeDefined()
        expect(errorCard.key).toBe('consoles-error')

        mounted.unmount()
        harness.dispose()
    })
})
