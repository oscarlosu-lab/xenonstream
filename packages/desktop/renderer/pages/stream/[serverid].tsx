import React from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import xCloudPlayer from 'xbox-xcloud-player'

import { useSettings } from '../../context/userContext'
import StreamComponent from '../../components/ui/streamcomponent'
import StreamPreload from '../../components/ui/streampreload'
import Ipc from '../../lib/ipc'
import CompactGamepadDriver from '../../lib/gamepaddriver'
import { setMouseSensitivity } from '../../lib/mousesensitivitypatch'
import { applyKeyboardSticks } from '../../lib/keyboardsticks'
import { applyEscapeAsHome, pressHomeButton } from '../../lib/escapekey'
import { applyRemoteOfferErrorHandling, applySystemUiSupport, clearSystemUiOverlays, SYSTEM_UI_CAPABILITIES } from '../../lib/systemui'
import { applyLowLatencyReceivers, filterIceCandidates, followConsolePicture, logIceList, logSelectedIcePath, logStreamPath, waitForLocalIce } from '../../lib/streamPath'
import { configureStreamResolution } from '../../lib/streamresolution'
import { CLARITY_SVG_FILTER_ID, getClaritySharpenKernel, getClarityVideoFilter } from '../../../lib/clarityBoost'
import { clampSharpness, normalizeUpscalerMode, VideoSizeMode, WebGLVideoUpscaler } from '../../../lib/videoUpscaler'
import { applyVideoCodecPreferences, DEFAULT_H264_PROFILES } from '../../../lib/codecPreference'
import { useTranslation } from 'react-i18next'

function Stream() {
    const router = useRouter()
    const { settings } = useSettings()
    const { t } = useTranslation()

    const [xPlayer, setxPlayer] = React.useState<xCloudPlayer | undefined>(undefined)
    const [sessionId, setSessionId] = React.useState('')
    const [queueTime, setQueueTime] = React.useState(0)

    const startingSessionRef = React.useRef(false)
    const disconnectRequestedRef = React.useRef(false)
    const streamStateIntervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined)
    const upscalerRef = React.useRef<WebGLVideoUpscaler | null>(null)

    React.useEffect(() => {
        if (!router.query.serverid || xPlayer !== undefined) {
            return
        }

        let isMounted = true

        // Detect stream type and title / server id
        let streamType = 'home'
        let serverId = router.query.serverid as string
        if(serverId.substr(0, 6) === 'xcloud'){
            streamType = 'cloud'
            serverId = serverId.substr(7)
        }

        if(sessionId === '') {
            if(startingSessionRef.current) {
                return
            }
            startingSessionRef.current = true

            // Stream is not ready yet, lets start it...
            Ipc.send('streaming', 'startStream', {
                type: streamType,
                target: serverId,
                resolution: settings.stream_resolution,
            }).then((result:string) => {
                if(!isMounted) {
                    return
                }
                console.log('StartStream session:', result)
                disconnectRequestedRef.current = false
                setSessionId(result)

            }).catch((error) => {
                startingSessionRef.current = false
                if(!isMounted) {
                    return
                }
                alert(t('errors.failedToStartStream') + '\n' + JSON.stringify(error))
            })
            return () => {
                isMounted = false
            }
        }

        const interval = setInterval(() => {
            Ipc.send('streaming', 'getPlayerState', {
                sessionId: sessionId,
            }).then((session:any) => {
                if(!isMounted) {
                    return
                }
                console.log('Player state:', session)

                switch(session.playerState){
                    case 'pending':
                        // Waiting for console to start
                        break

                    case 'started':
                        // Console is ready
                        clearInterval(interval)
                        if(streamStateIntervalRef.current === interval) {
                            streamStateIntervalRef.current = undefined
                        }

                        // Start xPlayer interface
                        setMouseSensitivity(settings.input_mouse_sensitivity)
                        applyKeyboardSticks()
                        applySystemUiSupport()
                        applyEscapeAsHome()
                        applyRemoteOfferErrorHandling()
                        setxPlayer(new xCloudPlayer('streamComponent', {
                            ui_systemui: SYSTEM_UI_CAPABILITIES,
                            input_touch: settings.input_touch || false,
                            input_mousekeyboard: settings.input_mousekeyboard || false,
                            input_legacykeyboard: !(settings.input_newgamepad || settings.input_mousekeyboard),
                            input_driver: new CompactGamepadDriver({
                                localCoopEnabled: Boolean(settings.input_local_coop),
                                buttonRemap: settings.input_gamepad_remap,
                            }),
                            input_mousekeyboard_config: settings.input_mousekeyboard_config !== undefined ? {
                                _keymapping: settings.input_mousekeyboard_config,
                            } : undefined as any,
                        }))
                        break

                    case 'failed':
                        // Error
                        clearInterval(interval)
                        if(streamStateIntervalRef.current === interval) {
                            streamStateIntervalRef.current = undefined
                        }

                        if(session.errorDetails.code === 'WNSError' && session.errorDetails.message.includes('WaitingForServerToRegister')){
                            // Detected the "WaitingForServerToRegister" error. This means the console is not connected to the xbox servers
                            alert(t('errors.unableToStartStreamSession') + '\n\n' + t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                        } else {
                            alert(t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                        }
                        console.log('Full stream error:', session.errorDetails)
                        onDisconnect()
                        break

                    case 'queued':
                        // Waiting in queue
                        // @TODO: Show queue position
                        if(queueTime === 0){
                            setQueueTime(session.waitingTimes.estimatedTotalWaitTimeInSeconds)
                            console.log('Setting queue to:', session.waitingTimes.estimatedTotalWaitTimeInSeconds)
                        }
                        break
                }

            }).catch((error) => {
                if(!isMounted) {
                    return
                }
                alert(t('errors.failedToGetPlayerState') + '\n' + JSON.stringify(error))
            })
        }, 1000)

        streamStateIntervalRef.current = interval

        return () => {
            isMounted = false
            clearInterval(interval)
            if(streamStateIntervalRef.current === interval) {
                streamStateIntervalRef.current = undefined
            }
        }
    }, [router.query.serverid, sessionId, xPlayer])

    React.useEffect(() => {
        if(xPlayer === undefined){
            return
        }

        let isUnmounting = false
        const iceSignal = { cancelled: false }
        let keepaliveInterval: ReturnType<typeof setInterval> | undefined
        let pathLogInterval: ReturnType<typeof setInterval> | undefined
        let stopFollowingPicture: (() => void) | undefined

        const streamType = (typeof router.query.serverid === 'string' && router.query.serverid.substr(0, 6) === 'xcloud') ? 'cloud' : 'home'
        const holder = document.getElementById('streamComponentHolder')
        if(holder !== null){
            holder.innerHTML = '<div id="streamComponent" class="size_'+settings.video_size+'"></div>'
        }
        xPlayer.bind()
        if(settings.stream_resolution > 0){
            configureStreamResolution(xPlayer, settings.stream_resolution)
        }

        // Set bitrates & video codec profiles
        const targetBitrate = (streamType === 'cloud') ? settings.xcloud_bitrate : settings.xhome_bitrate
        if(targetBitrate > 0){
            xPlayer.setVideoBitrate(targetBitrate)
        }

        const effectiveVideoProfiles = (settings.video_profiles && settings.video_profiles.length > 0)
            ? settings.video_profiles
            : DEFAULT_H264_PROFILES // Prefer H.264 High (4d), fallback Main (42e) / Baseline (420)
        // Apply ordered codec preferences directly on the video transceiver so H.264 fallback
        // and RTX/RED/ULPFEC packet-loss resilience codecs are always preserved.
        const offeredCodecs = applyVideoCodecPreferences(xPlayer, settings.video_codec, effectiveVideoProfiles)
        const offeredMimeTypes = offeredCodecs.map((codec) => codec.mimeType).filter((mime, index, all) => all.indexOf(mime) === index)
        logStreamPath(`video codec setting=${settings.video_codec || 'h264'} offered=${offeredMimeTypes.join(',') || '(library default)'}`)

        // Stream is ready so we start the player
        xPlayer.setControllerRumble(settings.controller_vibration)
        xPlayer.setSdpHandler((client, offer) => {
            if(isUnmounting){
                return
            }
            Ipc.send('streaming', 'sendChatSdp', {
                sessionId: sessionId,
                sdp: offer.sdp,
            }).then((sdpResponse) => {
                if(isUnmounting){
                    return
                }
                xPlayer.setRemoteOffer(sdpResponse.sdp)

            }).catch((error) => {
                if(isUnmounting){
                    return
                }
                console.log('ChatSDP Exchange error:', error)
                alert(t('errors.chatSDPExchangeError') + ' ' + JSON.stringify(error))
            })
        })

        xPlayer.createOffer().then((offer:any) => {
            if(isUnmounting){
                return
            }
            Ipc.send('streaming', 'sendSdp', {
                sessionId: sessionId,
                sdp: offer.sdp,
            }).then((sdpResult:any) => {
                if(isUnmounting){
                    return
                }
                xPlayer.setRemoteOffer(sdpResult.sdp)

                // Gather candidates (wait for full ICE gathering and prefer UDP on LAN with TCP fallback)
                waitForLocalIce(xPlayer._webrtcClient, () => xPlayer.getIceCandidates(), 4000, iceSignal).then((iceCandidates) => {
                    if(isUnmounting){
                        return
                    }
                    const { candidates, skippedTcp, usedTcpFallback } = filterIceCandidates(iceCandidates)
                    if(skippedTcp > 0){
                        logStreamPath(`skipped ${skippedTcp} tcp candidates so the stream stays on udp`)
                    } else if(usedTcpFallback){
                        logStreamPath(`no udp candidates available; falling back to ${candidates.length} tcp candidates`)
                    }

                    Ipc.send('streaming', 'sendIce', {
                        sessionId: sessionId,
                        ice: candidates,
                    }).then((iceResult:any) => {
                        if(isUnmounting){
                            return
                        }
                        logIceList('remote', iceResult || [])
                        xPlayer.setIceCandidates(iceResult)

                        // All done. Waiting for the event 'connectionstate' to be triggered

                    }).catch((error) => {
                        if(isUnmounting){
                            return
                        }
                        console.log('ICE Exchange error:', error)
                        alert(t('errors.ICEExchangeError') + ' ' + JSON.stringify(error))
                    })
                })

            }).catch((error) => {
                if(isUnmounting){
                    return
                }
                console.log('SDP Exchange error:', error)
                alert(t('errors.SDPExchangeError') + ' ' + JSON.stringify(error))
            })
        }).catch((error) => {
            if(isUnmounting){
                return
            }
            console.log('CreateOffer error:', error)
        })

        const connectionStateHandler = (event) => {
            if(isUnmounting){
                return
            }
            console.log('connectionstate changed:', event)

            const connStatus = document.getElementById('component_streamcomponent_connectionstatus')
            if(connStatus !== null){
                if(event.state === 'connected'){
                    connStatus.innerText = t('streamWindow.clientHasBeenDisconnected')
                    const loader = document.getElementById('component_streamcomponent_loader')
                    if(loader !== null){
                        loader.className = 'hidden'
                    }

                    // Set audio / Video settings
                    // @TODO: Implement api's in xbox-xcloud-player
                    if(settings.audio_enabled === false && xPlayer._audioComponent?._audioRender){
                        xPlayer._audioComponent._audioRender.muted = true
                    }

                    if(settings.audio_output_device !== '' && xPlayer._audioComponent?._audioRender?.setSinkId){
                        xPlayer._audioComponent._audioRender.setSinkId(settings.audio_output_device).catch((error) => {
                            console.error('Failed to set output device, using system default:', error)
                        })
                    }

                    if(settings.video_enabled === false && xPlayer._videoComponent?._videoRender){
                        xPlayer._videoComponent._videoRender.style.opacity = 0
                    }

                    // Apply low-latency WebRTC receiver hints (jitterBufferTarget=0 / playoutDelayHint=0) and log ICE path
                    applyLowLatencyReceivers(xPlayer._webrtcClient)
                    logSelectedIcePath(xPlayer._webrtcClient).catch(() => {})
                    if(pathLogInterval !== undefined){
                        clearInterval(pathLogInterval)
                    }
                    pathLogInterval = setInterval(() => {
                        applyLowLatencyReceivers(xPlayer._webrtcClient, true)
                        logSelectedIcePath(xPlayer._webrtcClient).catch(() => {})
                    }, 15000)

                    if(streamType === 'home' && stopFollowingPicture === undefined){
                        stopFollowingPicture = followConsolePicture(xPlayer)
                    }

                    // Start keepalive loop
                    if(keepaliveInterval !== undefined){
                        clearInterval(keepaliveInterval)
                    }
                    keepaliveInterval = setInterval(() => {
                        Ipc.send('streaming', 'sendKeepalive', {
                            sessionId: sessionId,
                        }).then((result) => {
                            console.log('StartStream keepalive:', result)
                        }).catch((error) => {
                            console.error('Failed to send keepalive. Error details:\n'+JSON.stringify(error))
                        })
                    }, 30000) // Send every 30 seconds

                } else if(event.state === 'new'){
                    connStatus.innerText = t('streamWindow.startingConnection')

                } else if(event.state === 'connecting'){
                    connStatus.innerText = t('streamWindow.connectingToConsole')

                } else if(event.state === 'closed') {
                    // Client has been disconnected. Clean up timers and end the session on the server before returning home.
                    if(keepaliveInterval !== undefined){
                        clearInterval(keepaliveInterval)
                        keepaliveInterval = undefined
                    }
                    if(pathLogInterval !== undefined){
                        clearInterval(pathLogInterval)
                        pathLogInterval = undefined
                    }
                    if(stopFollowingPicture !== undefined){
                        stopFollowingPicture()
                        stopFollowingPicture = undefined
                    }
                    if(!isUnmounting){
                        console.log('Client has been disconnected. Returning to prev page.')
                        onDisconnect()
                        window.history.back()
                    }
                }
            }
        }

        xPlayer.getEventBus().on('connectionstate', connectionStateHandler)

        // Modal window
        return () => {
            isUnmounting = true
            iceSignal.cancelled = true
            xPlayer.getEventBus().removeListener?.('connectionstate', connectionStateHandler)

            if(keepaliveInterval !== undefined){
                clearInterval(keepaliveInterval)
                keepaliveInterval = undefined
            }
            if(pathLogInterval !== undefined){
                clearInterval(pathLogInterval)
                pathLogInterval = undefined
            }
            if(stopFollowingPicture !== undefined){
                stopFollowingPicture()
                stopFollowingPicture = undefined
            }
            clearSystemUiOverlays()

            xPlayer.close()
        }
    }, [xPlayer])

    // Live-reactive video enhancement pipeline (Off / RTX VSR / Clarity Boost / AMD CAS / AMD FSR 1.0)
    React.useEffect(() => {
        if (xPlayer === undefined || typeof document === 'undefined') {
            return
        }

        const mode = normalizeUpscalerMode(settings.video_upscaler, settings.clarity_boost_strength)
        const sharpness = clampSharpness(settings.video_upscaler_sharpness)
        const videoSize = (settings.video_size || 'default') as VideoSizeMode
        const streamHolder = document.getElementById('streamComponent')
        if (!streamHolder) {
            return
        }
        streamHolder.className = 'size_' + videoSize

        let claritySvgElement: SVGSVGElement | undefined
        let enhancerObserver: MutationObserver | undefined

        const cleanupSvg = () => {
            const existingSvg = document.getElementById('xenonstream-clarity-svg')
            if (existingSvg) {
                existingSvg.remove()
            }
            claritySvgElement = undefined
        }

        const applyEnhancement = (): boolean => {
            const videoElement = typeof streamHolder.querySelector === 'function'
                ? (streamHolder.querySelector('video') as HTMLVideoElement | null)
                : null
            if (!videoElement) {
                return false
            }

            if (mode === 'cas' || mode === 'fsr1') {
                cleanupSvg()
                videoElement.style.filter = ''
                if (upscalerRef.current && upscalerRef.current.isActive()) {
                    upscalerRef.current.updateConfig({ mode, sharpness, videoSize })
                } else {
                    upscalerRef.current?.destroy()
                    upscalerRef.current = new WebGLVideoUpscaler(streamHolder, videoElement, { mode, sharpness, videoSize })
                }
                logStreamPath(`video upscaler=${mode} sharpness=${sharpness.toFixed(2)}`)
                return true
            }

            // Off / RTX VSR / Clarity -> tear down any WebGL2 canvas
            if (upscalerRef.current) {
                upscalerRef.current.destroy()
                upscalerRef.current = null
            }
            videoElement.style.opacity = ''

            if (mode === 'clarity') {
                const sharpenKernel = getClaritySharpenKernel(settings.clarity_boost_strength)
                if (sharpenKernel && typeof document.createElementNS === 'function' && document.body) {
                    cleanupSvg()
                    const svgNS = 'http://www.w3.org/2000/svg'
                    const svg = document.createElementNS(svgNS, 'svg')
                    svg.setAttribute('id', 'xenonstream-clarity-svg')
                    svg.setAttribute('width', '0')
                    svg.setAttribute('height', '0')
                    svg.setAttribute('style', 'position:absolute;width:0;height:0;pointer-events:none;')
                    const filter = document.createElementNS(svgNS, 'filter')
                    filter.setAttribute('id', CLARITY_SVG_FILTER_ID)
                    const convolve = document.createElementNS(svgNS, 'feConvolveMatrix')
                    convolve.setAttribute('order', '3')
                    convolve.setAttribute('kernelMatrix', sharpenKernel)
                    convolve.setAttribute('preserveAlpha', 'true')
                    filter.appendChild(convolve)
                    svg.appendChild(filter)
                    document.body.appendChild(svg)
                    claritySvgElement = svg
                } else {
                    cleanupSvg()
                }
                videoElement.style.filter = getClarityVideoFilter(settings.clarity_boost_strength, claritySvgElement !== undefined)
                logStreamPath(`video upscaler=clarity strength=${Number(settings.clarity_boost_strength || 0).toFixed(2)}`)
                return true
            }

            // 'off' or 'rtx_vsr': pure hardware overlay passthrough (no CSS/SVG filters)
            cleanupSvg()
            videoElement.style.filter = ''
            logStreamPath(`video upscaler=${mode}`)
            return true
        }

        if (!applyEnhancement() && typeof MutationObserver !== 'undefined') {
            enhancerObserver = new MutationObserver(() => {
                if (applyEnhancement()) {
                    enhancerObserver?.disconnect()
                    enhancerObserver = undefined
                }
            })
            enhancerObserver.observe(streamHolder, { childList: true, subtree: true })
        }

        return () => {
            enhancerObserver?.disconnect()
            cleanupSvg()
        }
    }, [xPlayer, settings.video_upscaler, settings.video_upscaler_sharpness, settings.clarity_boost_strength, settings.video_size])

    React.useEffect(() => {
        return () => {
            if (upscalerRef.current) {
                upscalerRef.current.destroy()
                upscalerRef.current = null
            }
        }
    }, [xPlayer])

    function gamepadSend(button){
        console.log('Pressed button:', button)
        const input = xPlayer?.getChannelProcessor('input')
        if (input) {
            pressHomeButton(input)
        }
    }

    function onDisconnect(){
        if(sessionId !== '' && !disconnectRequestedRef.current){
            disconnectRequestedRef.current = true
            Ipc.send('streaming', 'stopStream', {
                sessionId: sessionId,
            }).then((result) => {
                console.log('Stream stopped:', result)
            }).catch((error) => {
                console.log('Failed to stop stream:', error)
            })
        }

        if(streamStateIntervalRef.current !== undefined){
            clearInterval(streamStateIntervalRef.current)
            streamStateIntervalRef.current = undefined
        }
    }

    return (
        <React.Fragment>
            <Head>
                <title>XenonStream - {t('streamWindow.pageTitle')} {router.query.serverid}</title>
            </Head>

            { (xPlayer !== undefined) ? <StreamComponent onDisconnect={ () => {
                onDisconnect()
            }} onMenu={ () => {
                gamepadSend('nexus')
            } } xPlayer={ xPlayer }></StreamComponent> : (queueTime > 0) ?<StreamPreload onDisconnect={ () => {
                onDisconnect()
            }} waitingTime={ queueTime }></StreamPreload> : <StreamPreload onDisconnect={ () => {
                onDisconnect()
            }}></StreamPreload> }
        </React.Fragment>
    )
}

export default Stream
