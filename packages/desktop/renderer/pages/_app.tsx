import '../styles.css'

import React from 'react'
import Head from 'next/head'
import Ipc from '../lib/ipc'
import { useRouter } from 'next/router'
import Header from '../components/header'
import Footer from '../components/footer'
import Auth from '../components/auth'
import SidebarFriends from '../components/sidebar/friends'
import useGamepadNavigation from '../lib/use-gamepad-navigation'
import type { DeviceLogin } from '../../device-login'
import '../lib/i18n'

import { UserProvider } from '../context/userContext'
import { LanguageProvider } from '../context/languageContext'

import {
    QueryClient,
    QueryClientProvider,
} from 'react-query'


// This default export is required in a new `pages/_app.js` file.
export default function MyApp({ Component, pageProps }) {
    const router = useRouter()
    const [queryClient] = React.useState(() => new QueryClient())
    useGamepadNavigation(router.isReady && !router.pathname.startsWith('/stream/'))

    const [loggedIn, setLoginState] = React.useState(false)
    const [prevUserState, setPrevUserState] = React.useState({
        signedIn: false,
        gamertag: '',
        gamerpic: '',
        gamerscore: '',
        level: '',
    })
    // const [headerLinks, setHeaderLinks] = React.useState([])
    // const [streamingMode, setStreamingMode] = React.useState(false)
    const [isLoading, setIsLoading] = React.useState(false)
    const [deviceLogin, setDeviceLogin] = React.useState<DeviceLogin | null>(null)

    React.useEffect(() => {
        let isMounted = true
        let autoStreamTimeout: ReturnType<typeof setTimeout> | undefined

        Ipc.send('app', 'loadCachedUser').then((user) => {
            if (!isMounted) {
                return
            }
            setPrevUserState({
                signedIn: user.signedIn,
                gamertag: user.gamertag,
                gamerpic: user.gamerpic,
                gamerscore: user.gamerscore,
                level: user.level,
            })
        }).catch(() => {
            // Ignore startup cache read errors
        })

        const authInterval = setInterval(() => {
            console.log('Requesting AuthState...')
            Ipc.send('app', 'getAuthState').then(async (args) => {
                if (!isMounted) {
                    return
                }
                console.log('Received AuthState:', args)
                setIsLoading(args.isAuthenticating)
                const nextLogin = args.isAuthenticating ? await window.XenonStream.getDeviceLogin?.() ?? null : null
                if (!isMounted) {
                    return
                }
                setDeviceLogin((current) => current?.userCode === nextLogin?.userCode &&
                    current?.verificationUri === nextLogin?.verificationUri ? current : nextLogin)

                if(args.isAuthenticating === true){
                    setPrevUserState((prev) => ({ ...prev, ...args.user}))

                } else if(args.isAuthenticated === true && args.user.signedIn === true){
                    clearInterval(authInterval)

                    if(loggedIn === false){
                        Ipc.send('app', 'onUiShown').then((result) => {
                            if (!isMounted) {
                                return
                            }
                            if(result.autoStream !== '')
                                autoStreamTimeout = setTimeout(() => {
                                    router.push('stream/'+result.autoStream)
                                }, 1000)
                        }).catch(() => {
                            // Ignore onUiShown errors
                        })
                    }

                    setLoginState(true)
                    setPrevUserState((prev) => ({ ...prev, ...args.user}))
                }
            }).catch(() => {
                // Ignore auth polling errors
            })
        }, 500)

        const errorHandler = function(event) {
            console.error('Unhandled rejection (promise: ', event.promise, ', reason: ', event.reason, ').')
            if(event.reason && event.reason.status){
                alert('HTTP Status: ' + event.reason.status + '\nPath:' + event.reason.url + '\n' + event.reason.body)
            } else {
                alert(event.reason)
            }
        }
        window.addEventListener('unhandledrejection', errorHandler)

        // cleanup this component
        return () => {
            isMounted = false
            window.removeEventListener('unhandledrejection', errorHandler)

            if(autoStreamTimeout !== undefined)
                clearTimeout(autoStreamTimeout)

            if(authInterval)
                clearInterval(authInterval)
        }
    }, [])

    // function isStreaming(){
    //     return streamingMode
    // }

    let appBody
    if(loggedIn && prevUserState.gamertag !== ''){
        appBody = (
            <React.Fragment>
                <Header gamertag={ prevUserState.gamertag } level={ parseInt(prevUserState.level) } />

                <div id="app_body">
                    <div id="app_body_container">
                        <Component {...pageProps} />
                    </div>
                </div>

                <div id="app_sidebar" style={{
                    display: 'block',
                }}>
                    <SidebarFriends></SidebarFriends>
                </div>
                <Footer />
            </React.Fragment>)

    } else {
        appBody = (
            <React.Fragment>
                <Auth signedIn={ prevUserState.signedIn} gamertag={ prevUserState.gamertag } gamerpic={ prevUserState.gamerpic } gamerscore={ prevUserState.gamerscore } isLoading={ isLoading } deviceLogin={ deviceLogin } />
            </React.Fragment>)
    }

    return (
        <React.Fragment>
            <Head>
                <title>XenonStream</title>
            </Head>

            <div style={ {
                background: 'radial-gradient(920px 540px at 12% -8%, rgba(16, 185, 129, 0.24), transparent 62%), radial-gradient(760px 480px at 90% 105%, rgba(6, 182, 212, 0.18), transparent 60%), linear-gradient(180deg, #060a0d 0%, #091217 52%, #05090c 100%)',
                width: '100vw',
                height: '100vh',
            }}>
                <QueryClientProvider client={queryClient}>
                    <UserProvider>
                        <LanguageProvider>
                            {appBody}
                        </LanguageProvider>
                    </UserProvider>
                </QueryClientProvider>
            </div>
        </React.Fragment>
    )
}
