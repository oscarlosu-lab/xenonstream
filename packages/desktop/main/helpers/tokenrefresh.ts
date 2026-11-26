import Application from '../application'

// True when an API call failed because its token was refused (HTTP 401).
// xCloudApi rejects with { status }, xbox-webapi with an Error whose message contains the indented JSON details ("statuscode": 401).
export function isUnauthorizedError(error:unknown):boolean {
    if(typeof error !== 'object' || error === null){
        return false
    }
    const { status, statusCode, response, message } = error as {
        status?:unknown,
        statusCode?:unknown,
        response?:{ status?:unknown },
        message?:unknown,
    }
    if(status === 401 || statusCode === 401 || response?.status === 401){
        return true
    }
    return typeof message === 'string' && (
        /"statuscode":\s*401\b/i.test(message)
        || /\b401\b.{0,20}unauthori[sz]ed|unauthori[sz]ed.{0,20}\b401\b|\b(http|status(?:\s*code)?)\W{0,3}401\b/i.test(message)
        || /token_expired/i.test(message)
    )
}

// Runs an API call; if its token was refused, refreshes the tokens and runs it once more.
// If the refresh itself fails, the original error is passed on.
export function withTokenRefresh<T>(application:Application, call:() => Promise<T>):Promise<T> {
    return call().catch((error) => {
        if(! isUnauthorizedError(error)){
            throw error
        }

        application.log('authenticationV2', __filename+'[withTokenRefresh()] Token refused, refreshing tokens and retrying once')
        return application.refreshApiTokens().then(call, (refreshError) => {
            application.log('authenticationV2', __filename+'[withTokenRefresh()] Failed to refresh tokens:', refreshError)
            throw error
        })
    })
}
