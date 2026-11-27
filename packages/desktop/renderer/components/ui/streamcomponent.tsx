import React from 'react'
import Button from './button'
import Slider from './slider'
import xPlayer from 'xbox-xcloud-player'
import Loader from './loader'
import Card from './card'
import StreamDebug from './stream-debug'
import StreamFpsOverlay from './stream-fps-overlay'
import Ipc from '../../lib/ipc'
import AudioDeviceSelect from './audiodeviceselect'
import TouchOverlay from './touchoverlay'
import { useAudioDevices, getMicStream } from '../../lib/audiodevices'
import { useSharedStreamStats } from '../../lib/streamStats'
import { useSettings } from '../../context/userContext'
import { getEstimatedPointer } from '../../lib/mousesensitivitypatch'
import { clampSharpness, normalizeUpscalerMode } from '../../../lib/videoUpscaler'
import { useTranslation } from 'react-i18next'

// Top centre of the picture where the hint tells how to free the mouse (the bar was there): the middle 40% of the
// width and the top 12% of the height. The position is an estimate, so this is more forgiving than the tab itself.
const HINT_ZONE_HALF_WIDTH = 0.2
const HINT_ZONE_HEIGHT = 0.12

interface StreamComponentProps {
    onDisconnect?: () => void;
    onMenu?: () => void;
    xPlayer: xPlayer;
}

function StreamComponent({
    onDisconnect,
    onMenu,
    xPlayer,
}: StreamComponentProps) {
    const { t } = useTranslation()
    const { settings, setSettings } = useSettings()
    const mouseKeyboard = settings.input_mousekeyboard === true
    const hintUntil = React.useRef(0)
    const audioDevices = useAudioDevices()

    const [micStatus, setMicStatus] = React.useState(false)
    const [waitingSeconds, setWaitingSeconds] = React.useState(0)
    const [debugVisible, setDebugVisible] = React.useState(false)
    const [fpsOverlayVisible, setFpsOverlayVisible] = React.useState(Boolean(settings.stream_fps_overlay))
    React.useEffect(() => {
        setFpsOverlayVisible(Boolean(settings.stream_fps_overlay))
    }, [settings.stream_fps_overlay])
    const [videoHidden, setVideoHidden] = React.useState(false)
    const sharedStats = useSharedStreamStats(xPlayer, fpsOverlayVisible || debugVisible)
    const waitingIntervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined)
    const isMountedRef = React.useRef(true)
    const micStreamRef = React.useRef<MediaStream>(null)

    // Keep the gamebar visible while the audio devices or upscaler menu is open, or collapsed immediately when toggled
    const [audioMenuOpen, setAudioMenuOpen] = React.useState(false)
    const audioMenuOpenRef = React.useRef(false)
    audioMenuOpenRef.current = audioMenuOpen
    const [upscalerMenuOpen, setUpscalerMenuOpen] = React.useState(false)
    const upscalerMenuOpenRef = React.useRef(false)
    upscalerMenuOpenRef.current = upscalerMenuOpen
    const activeUpscaler = normalizeUpscalerMode(settings.video_upscaler, settings.clarity_boost_strength)
    const [barManuallyHidden, setBarManuallyHidden] = React.useState(false)
    const barManuallyHiddenRef = React.useRef(false)
    barManuallyHiddenRef.current = barManuallyHidden
    const [barVisible, setBarVisible] = React.useState(true)
    const barVisibleRef = React.useRef(true)
    const [pointerLocked, setPointerLocked] = React.useState(false)
    const pointerLockedRef = React.useRef(false)
    const lastMovementRef = React.useRef(Date.now())



    //Client-side volume control
    const [volume, setVolume] = React.useState(1.0) //without any controls, the volume has been maxed by default, let's follow this assumption and start at full for our slider
    const handleVolumeChange = (newVolume: number) => {

        const audioElement = document.getElementsByTagName('audio')[0]

        if(audioElement) {
            setVolume(newVolume)
            audioElement.volume = newVolume
        } else {
            console.error('VolumeSlider: handleChange: failed to find current or lost previous audioelement. Current element:', audioElement)
        }

    }
    const volumeIcon = ( //from https://www.svgrepo.com/svg/502904/volume-low and optimized w/ https://jakearchibald.github.io/svgomg/
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 14v-4a1 1 0 0 1 1-1h2.65a1 1 0 0 0 .624-.22l3.101-2.48A1 1 0 0 1 16 7.08v9.84a1 1 0 0 1-1.625.78l-3.101-2.48a1 1 0 0 0-.625-.22H8a1 1 0 0 1-1-1Z" /></svg>
    )


    React.useEffect(() => {
        isMountedRef.current = true

        const onQueueListener = Ipc.onAction('streaming', 'onQueue', (event, waitingTimes) => {
            console.log('Waiting times:', waitingTimes)
            drawWaitingTimes(waitingTimes.estimatedTotalWaitTimeInSeconds)
        })

        // ipcRenderer.on('xcloud', (event, args) => {
        //   console.log('GOT EVENT:', event, args)

        //   if(args.type === 'waitingtimes'){
        //     // Render countdown
        //     console.log('Seconds waiting time:', args.data.estimatedTotalWaitTimeInSeconds)
        //     // setWaitingTimes(args.data)
        //     drawWaitingTimes(args.data.estimatedTotalWaitTimeInSeconds)
        //   }
        // })

        // Gamebar menu mouse events
        lastMovementRef.current = Date.now()
        const mouseEvent = () => {
            lastMovementRef.current = Date.now()
        }
        window.addEventListener('mousemove', mouseEvent)
        window.addEventListener('mousedown', mouseEvent)

        const hintElement = document.getElementById('component_streamcomponent_mousehint')
        const mouseInterval = setInterval(() => {
            const gamebarElement = document.getElementById('component_streamcomponent_gamebar')
            if (gamebarElement === null) {
                return
            }

            // With Mouse & Keyboard the mouse is locked in the video and every movement would show the bar:
            // there the bar is shown while the mouse is free (the user released it) and hidden when it is locked.
            const isPointerLocked = mouseKeyboard && document.pointerLockElement !== null
            if (pointerLockedRef.current !== isPointerLocked) {
                pointerLockedRef.current = isPointerLocked
                setPointerLocked(isPointerLocked)
            }

            const autoShow = audioMenuOpenRef.current || upscalerMenuOpenRef.current || (mouseKeyboard ? document.pointerLockElement === null : (Date.now() - lastMovementRef.current) < 2000)
            const showBar = !barManuallyHiddenRef.current && autoShow

            if (!showBar) {
                if (!gamebarElement.className.includes('hidden')) {
                    gamebarElement.className = 'hidden'
                }
            } else {
                if (gamebarElement.className.includes('hidden')) {
                    gamebarElement.className = ''
                }
            }

            if (barVisibleRef.current !== showBar) {
                barVisibleRef.current = showBar
                setBarVisible(showBar)
            }

            if (hintElement !== null) {
                const pointer = getEstimatedPointer()
                const inTopCentre = Math.abs(pointer.x - 0.5) <= HINT_ZONE_HALF_WIDTH && pointer.y <= HINT_ZONE_HEIGHT
                const showHint = mouseKeyboard && !showBar && (Date.now() < hintUntil.current || inTopCentre)

                hintElement.className = showHint ? '' : 'hidden'

                const debugPointer = document.getElementById('component_streamcomponent_debug_pointer')
                if (debugPointer !== null) {
                    debugPointer.innerText = 'Pointer (estimated): x ' + Math.round(pointer.x * 100) + '%, y ' + Math.round(pointer.y * 100) + '%'
                }
            }
        }, 100)

        const escapeEvent = (e: KeyboardEvent) => {
            if (mouseKeyboard && e.key === 'Escape') {
                hintUntil.current = Date.now() + 3000
            }
            if (e.key === 'F9') {
                const target = e.target as HTMLElement | null
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                    return
                }
                setFpsOverlayVisible(visible => !visible)
            }
        }
        window.addEventListener('keydown', escapeEvent)

        // Keyboard events (ignore while typing in systemUi text-entry overlays or inputs)
        const keyboardPressEvent = (e) => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return
            }
            switch (e.keyCode) {
                case 126:
                    toggleDebug()
                    break
                case 112:
                    takeScreenshot()
                    break
            }
        }
        window.addEventListener('keypress', keyboardPressEvent)

        // cleanup this component
        return () => {
            isMountedRef.current = false
            window.removeEventListener('mousemove', mouseEvent)
            window.removeEventListener('mousedown', mouseEvent)
            window.removeEventListener('keypress', keyboardPressEvent)
            window.removeEventListener('keydown', escapeEvent)
            clearInterval(mouseInterval)
            Ipc.removeListener('streaming', onQueueListener)

            if (waitingIntervalRef.current !== undefined) {
                clearInterval(waitingIntervalRef.current)
                waitingIntervalRef.current = undefined
            }

            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach(track => track.stop())
                micStreamRef.current = null
            }
        }
    }, [])



    function toggleMic() {
        if (micStreamRef.current === null) {
            startMic()
        } else {
            stopMic()
        }
    }

    // Replaces ChatChannel.startMic so we can capture from the selected input device
    function startMic() {
        const chatChannel = xPlayer.getChannelProcessor('chat')

        void getMicStream(settings.audio_input_device).then((stream) => {
            if (!isMountedRef.current) {
                stream.getTracks().forEach(track => track.stop())
                return
            }
            micStreamRef.current = stream
            stream.getTracks().forEach(track => {
                xPlayer._webrtcClient?.addTrack(track, stream)
            })

            chatChannel.isCapturing = true
            chatChannel.isPaused = false
            xPlayer.sdpNegotiationChat()
            setMicStatus(true)

            // Device labels can be empty until microphone permission is granted
            audioDevices.refresh()
        }).catch((error) => {
            if (isMountedRef.current) {
                alert(`getUserMedia() error: ${error?.name || error}`)
            }
        })
    }

    function stopMic() {
        xPlayer.getChannelProcessor('chat').stopMic()

        micStreamRef.current?.getTracks().forEach(track => track.stop())
        micStreamRef.current = null
        setMicStatus(false)
    }

    function changeInputDevice(deviceId: string) {
        setSettings({
            ...settings,
            audio_input_device: deviceId,
        })

        const oldStream = micStreamRef.current
        if (oldStream === null) {
            return
        }

        void getMicStream(deviceId).then((newStream) => {
            if (!isMountedRef.current) {
                newStream.getTracks().forEach(track => track.stop())
                return
            }
            const oldTrack = oldStream.getAudioTracks()[0]
            const sender = xPlayer._webrtcClient?.getSenders().find(sender => sender.track === oldTrack)
            if (sender === undefined) {
                newStream.getTracks().forEach(track => track.stop())
                return
            }

            // replaceTrack swaps the source without renegotiating the chat SDP
            return sender.replaceTrack(newStream.getAudioTracks()[0]).then(() => {
                oldStream.getTracks().forEach(track => track.stop())
                micStreamRef.current = newStream
            }).catch((error) => {
                newStream.getTracks().forEach(track => track.stop())
                throw error
            })
        }).catch((error) => {
            console.error('Failed to switch input device:', error)
        })
    }

    function changeOutputDevice(deviceId: string) {
        setSettings({
            ...settings,
            audio_output_device: deviceId,
        })

        const audioElement = document.getElementsByTagName('audio')[0]
        if (audioElement && typeof audioElement.setSinkId === 'function') {
            void audioElement.setSinkId(deviceId).catch((error) => {
                console.error('Failed to switch output device:', error)
            })
        }
    }

    function streamDisconnect() {
        const holder = document.getElementById('streamComponentHolder')
        if (holder !== null) {
            holder.innerHTML = ''
        }

        xPlayer.close()
    }

    function endStream() {
        if (confirm(t("streamWindow.endStreamConfirmMessage"))) {
            const holder = document.getElementById('streamComponentHolder')
            if (holder !== null) {
                holder.innerHTML = ''
            }
            onDisconnect?.()
            xPlayer.close()
        }
    }

    function toggleDebug() {
        setDebugVisible(visible => !visible)
    }

    function toggleGamebar(e?: React.MouseEvent) {
        e?.stopPropagation()
        const nextHidden = !barManuallyHiddenRef.current && barVisibleRef.current
        barManuallyHiddenRef.current = nextHidden
        setBarManuallyHidden(nextHidden)
        if (nextHidden) {
            setAudioMenuOpen(false)
            audioMenuOpenRef.current = false
            setUpscalerMenuOpen(false)
            upscalerMenuOpenRef.current = false
            barVisibleRef.current = false
            setBarVisible(false)
            const el = document.getElementById('component_streamcomponent_gamebar')
            if (el) {
                el.className = 'hidden'
            }
        } else {
            lastMovementRef.current = Date.now()
            barVisibleRef.current = true
            setBarVisible(true)
            const el = document.getElementById('component_streamcomponent_gamebar')
            if (el) {
                el.className = ''
            }
        }
    }

    function toggleHideScreen() {
        const stream = document.getElementById('streamComponent')
        if (!stream) {
            return
        }
        const nextHidden = !videoHidden
        for (const element of Array.from(stream.children)) {
            (element as HTMLElement).hidden = nextHidden
        }
        setVideoHidden(nextHidden)
    }

    function takeScreenshot() {
        const videoElement = document.querySelector('#streamComponent video') as HTMLVideoElement
        if (videoElement === null) {
            console.log('takeScreenshot: no video element found, stream may not be connected yet')
            return
        }

        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.log('takeScreenshot: video has no dimensions yet, stream may still be connecting')
            return
        }

        const canvas = document.createElement('canvas')
        canvas.width = videoElement.videoWidth
        canvas.height = videoElement.videoHeight

        const context = canvas.getContext('2d')
        if (context === null) {
            console.log('takeScreenshot: failed to get 2d canvas context')
            return
        }

        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

        const dataUrl = canvas.toDataURL('image/png')
        const base64Image = dataUrl.replace('data:image/png;base64,', '')

        Ipc.send('screenshot', 'saveScreenshot', { image: base64Image }).then((result: any) => {
            console.log('Screenshot saved:', result.path)
        }).catch((error) => {
            console.log('Failed to save screenshot:', error)
        })
    }

    function drawWaitingTimes(seconds) {
        if (waitingIntervalRef.current !== undefined) {
            clearInterval(waitingIntervalRef.current)
            waitingIntervalRef.current = undefined
        }

        if (seconds !== false) {
            let remainingSeconds = Math.max(0, Number(seconds) || 0)
            setWaitingSeconds(remainingSeconds)

            const formattedWaitingTime = formatWaitingTime(remainingSeconds)
            const html = '<div>' + t("streamWindow.estimatedWaitingTimeMessage") + ' ' + '<span id="component_streamcomponent_waitingtimes_seconds">' + formattedWaitingTime + '</span></div>'

            const waitingTimesElement = document.getElementById('component_streamcomponent_waitingtimes')
            if (waitingTimesElement !== null) {
                waitingTimesElement.innerHTML = html
            }

            if (remainingSeconds <= 0) {
                return
            }

            const secondsInterval = setInterval(() => {
                remainingSeconds = Math.max(0, remainingSeconds - 1)
                setWaitingSeconds(remainingSeconds)

                const waitingContainer = document.getElementById('component_streamcomponent_waitingtimes')
                const waitingSecondsEl = document.getElementById('component_streamcomponent_waitingtimes_seconds')
                if (waitingContainer !== null && waitingSecondsEl !== null) {
                    waitingSecondsEl.innerText = formatWaitingTime(remainingSeconds)
                } else {
                    clearInterval(secondsInterval)
                    if (waitingIntervalRef.current === secondsInterval) {
                        waitingIntervalRef.current = undefined
                    }
                }

                if (remainingSeconds <= 0) {
                    clearInterval(secondsInterval)
                    if (waitingIntervalRef.current === secondsInterval) {
                        waitingIntervalRef.current = undefined
                    }
                }
            }, 1000)

            waitingIntervalRef.current = secondsInterval
        }
    }

    function formatWaitingTime(rawSeconds: number): string {
        let formattedText = ''

        const hours = Math.floor(rawSeconds / 3600)
        const minutes = Math.floor((rawSeconds % 3600) / 60)
        const seconds = (rawSeconds % 3600) % 60

        if (hours > 0) {
            formattedText += hours + ' ' + t("streamWindow.timeHours") + ', '
        }

        if (minutes > 0) {
            formattedText += minutes + ' ' + t("streamWindow.timeMinutes") + ', '
        }

        if (seconds > 0) {
            formattedText += seconds + ' ' + t("streamWindow.timeSeconds") + '.'
        }

        return formattedText
    }

    return (
        <React.Fragment>
            <div>
                <div id="streamComponentHolder">
                </div>

                { settings.input_touch ? <TouchOverlay xPlayer={ xPlayer } preset={ settings.touch_layout_preset } /> : null }
                { fpsOverlayVisible ? (
                    <StreamFpsOverlay
                        metrics={sharedStats?.hud}
                        position={settings.stream_fps_overlay_pos}
                        onPositionChange={(pos) => setSettings({ ...settings, stream_fps_overlay_pos: pos })}
                    />
                ) : null }

                <div id="component_streamcomponent_loader">
                    <Card className='padbottom'>
                        <h1>{t("streamWindow.loadingStreamTitle")}</h1>

                        <Loader></Loader>

                        <p>{t("streamWindow.gettingStreamReadyMessage")}</p>
                        <p id="component_streamcomponent_connectionstatus"></p>

                        <p id="component_streamcomponent_waitingtimes"></p>
                    </Card>
                </div>

                <div id="component_streamcomponent_mousehint" className="hidden">
                    <span>{ (typeof navigator !== 'undefined' && navigator.userAgent?.includes('Mac')) ? t('streamWindow.mouseHint') : t('streamWindow.mouseHintHoldEsc') }</span>
                </div>

                <div id="component_streamcomponent_gamebar" role="toolbar" aria-label="Stream controls">
                    <div id="component_streamcomponent_gamebar_menu">
                        <div style={{
                            width: '25%',
                        }}>
                            <Button label={<span><i className="fa-solid fa-xmark"></i> {t("streamWindow.endStreamBtn")}</span>} title={t("streamWindow.endStreamBtn")} ariaLabel={t("streamWindow.endStreamBtn")} autoBlur={false} className='btn-cancel' onClick={() => {
                                endStream()
                            }}></Button> &nbsp;
                            <Button label={<span><i className="fa-solid fa-xmark"></i></span>} title={t("streamWindow.disconnectBtn")} ariaLabel={t("streamWindow.disconnectBtn")} autoBlur={false} className='btn' onClick={() => {
                                streamDisconnect()
                            }}></Button>
                        </div>

                        <div style={{
                            marginLeft: 'auto',
                            marginRight: 'auto',
                        }}>
                            <Button label={<span><i className="fa-brands fa-xbox"></i> {t("streamWindow.menuBtn")}</span>} title={t("streamWindow.menuTitle")} ariaLabel={t("streamWindow.menuTitle")} autoBlur={false} onClick={(e) => {
                                e.target.blur(); onMenu?.()
                            }}></Button> &nbsp;
                            <Button label={(micStatus === false) ? <span><i className="fa-solid fa-microphone-slash"></i> {t("streamWindow.micMuted")}</span> : <span><i className="fa-solid fa-microphone"></i> {t("streamWindow.micActive")}</span>} title={(micStatus === false) ? t("streamWindow.enableMic") : t("streamWindow.disableMic")} ariaLabel={(micStatus === false) ? t("streamWindow.enableMic") : t("streamWindow.disableMic")} ariaExpanded={micStatus} autoBlur={false} className={(micStatus === false) ? 'btn-cancel' : 'btn-primary'} onClick={(e) => {
                                e.target.blur(); toggleMic()
                            }}></Button> &nbsp;
                            <Button label={<i className="fa-solid fa-headphones"></i>} title={t("streamWindow.audioDevicesTitle")} ariaLabel={t("streamWindow.audioDevicesTitle")} ariaExpanded={audioMenuOpen} ariaControls="component_streamcomponent_audiodevices" autoBlur={false} className={audioMenuOpen ? 'btn-primary' : 'btn'} onClick={(e) => {
                                e.target.blur(); setUpscalerMenuOpen(false); setAudioMenuOpen(!audioMenuOpen)
                            }}></Button> &nbsp;
                            <Button label={<i className="fa-solid fa-wand-magic-sparkles"></i>} title={t("streamWindow.upscalerTitle", "Video Upscaler (FSR / CAS / RTX VSR)")} ariaLabel={t("streamWindow.upscalerTitle", "Video Upscaler (FSR / CAS / RTX VSR)")} ariaExpanded={upscalerMenuOpen} ariaControls="component_streamcomponent_upscaler" autoBlur={false} className={upscalerMenuOpen || activeUpscaler !== 'off' ? 'btn-primary' : 'btn'} onClick={(e) => {
                                e.target.blur(); setAudioMenuOpen(false); setUpscalerMenuOpen(!upscalerMenuOpen)
                            }}></Button>
                        </div>

                        <Slider
                            id="volume-slider"
                            min={0}
                            max={1}
                            step={0.01}
                            value={volume}
                            onChange={handleVolumeChange}
                            label="Volume"
                            svg={volumeIcon}
                        />

                        <div style={{
                            marginRight: 20,
                            width: '25%',
                            textAlign: 'right',
                        }}>
                            <Button label={<i className={videoHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}></i>} title={t("streamWindow.toggleVideoTitle")} ariaLabel={t("streamWindow.toggleVideoTitle")} ariaExpanded={!videoHidden} autoBlur={false} className={videoHidden ? 'btn-primary' : 'btn'} onClick={(e) => {
                                e.target.blur(); toggleHideScreen()
                            }}></Button> &nbsp;
                            <Button label={<i className="fa-solid fa-camera"></i>} title={t("streamWindow.screenshotTitle")} ariaLabel={t("streamWindow.screenshotTitle")} autoBlur={false} onClick={(e) => {
                                e.target.blur(); takeScreenshot()
                            }}></Button> &nbsp;
                            <Button label={<i className="fa-solid fa-gauge-high"></i>} title={t("streamWindow.fpsOverlayTitle")} ariaLabel={t("streamWindow.fpsOverlayTitle")} ariaExpanded={fpsOverlayVisible} autoBlur={false} className={fpsOverlayVisible ? 'btn-primary' : 'btn'} onClick={(e) => {
                                e.target.blur(); setFpsOverlayVisible(visible => !visible)
                            }}></Button> &nbsp;
                            <Button label={<i className="fa-solid fa-bug"></i>} title={t("streamWindow.debugTitle")} ariaLabel={t("streamWindow.debugTitle")} ariaExpanded={debugVisible} autoBlur={false} onClick={(e) => {
                                e.target.blur(); toggleDebug()
                            }}></Button>
                        </div>
                    </div>

                    {audioMenuOpen ? <div id="component_streamcomponent_audiodevices">
                        <p>
                            <label htmlFor="component_streamcomponent_audiodevices_output">{t('settings.videoAudio.outputDeviceLabel')}</label>
                            <AudioDeviceSelect id="component_streamcomponent_audiodevices_output" devices={audioDevices.outputs} value={settings.audio_output_device} onChange={changeOutputDevice} />
                        </p>
                        <p>
                            <label htmlFor="component_streamcomponent_audiodevices_input">{t('settings.videoAudio.inputDeviceLabel')}</label>
                            <AudioDeviceSelect id="component_streamcomponent_audiodevices_input" devices={audioDevices.inputs} value={settings.audio_input_device} onChange={changeInputDevice} />
                        </p>
                    </div> : null}

                    {upscalerMenuOpen ? <div id="component_streamcomponent_upscaler">
                        <p>
                            <label htmlFor="component_streamcomponent_upscaler_mode">{t('settings.videoAudio.upscalerLabel', 'Video Upscaler')}</label>
                            <select
                                id="component_streamcomponent_upscaler_mode"
                                value={activeUpscaler}
                                onChange={(e) => {
                                    setSettings({
                                        ...settings,
                                        video_upscaler: e.target.value,
                                    })
                                }}
                            >
                                <option value="off">{t('settings.videoAudio.upscalerModeOff', 'Off (Native)')}</option>
                                <option value="rtx_vsr">{t('settings.videoAudio.upscalerModeRtxVsr', 'RTX VSR / Intel VSR Passthrough')}</option>
                                <option value="clarity">{t('settings.videoAudio.upscalerModeClarity', 'Clarity Boost (CSS/SVG)')}</option>
                                <option value="cas">{t('settings.videoAudio.upscalerModeCas', 'AMD FidelityFX CAS (WebGL2)')}</option>
                                <option value="fsr1">{t('settings.videoAudio.upscalerModeFsr1', 'AMD FSR 1.0 — EASU + RCAS (WebGL2)')}</option>
                            </select>
                        </p>
                        {(activeUpscaler === 'cas' || activeUpscaler === 'fsr1') ? (
                            <p>
                                <label htmlFor="component_streamcomponent_upscaler_sharpness">{t('settings.videoAudio.upscalerSharpnessLabel', 'Sharpness')}</label>
                                <input
                                    id="component_streamcomponent_upscaler_sharpness"
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={clampSharpness(settings.video_upscaler_sharpness)}
                                    onChange={(e) => {
                                        setSettings({
                                            ...settings,
                                            video_upscaler_sharpness: parseFloat(e.target.value),
                                        })
                                    }}
                                />
                            </p>
                        ) : null}
                        {activeUpscaler === 'clarity' ? (
                            <p>
                                <label htmlFor="component_streamcomponent_upscaler_clarity">{t('settings.videoAudio.clarityBoostLabel', 'Clarity Boost')}</label>
                                <input
                                    id="component_streamcomponent_upscaler_clarity"
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={settings.clarity_boost_strength || 0}
                                    onChange={(e) => {
                                        setSettings({
                                            ...settings,
                                            clarity_boost_strength: parseFloat(e.target.value),
                                        })
                                    }}
                                />
                            </p>
                        ) : null}
                    </div> : null}
                </div>

                <button
                    type="button"
                    id="component_streamcomponent_gamebar_toggle"
                    className={
                        (barVisible ? 'bar-open' : (barManuallyHidden ? 'bar-collapsed' : 'hidden'))
                        + (pointerLocked ? ' hidden' : '')
                    }
                    title={barVisible ? t('streamWindow.hideMenuBar', 'Hide menu bar') : t('streamWindow.showMenuBar', 'Show menu bar')}
                    aria-label={barVisible ? t('streamWindow.hideMenuBar', 'Hide menu bar') : t('streamWindow.showMenuBar', 'Show menu bar')}
                    aria-expanded={barVisible}
                    aria-controls="component_streamcomponent_gamebar"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.currentTarget.blur()
                        toggleGamebar(e)
                    }}
                >
                    <i className={barVisible ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'}></i>
                </button>

                {debugVisible && <StreamDebug player={xPlayer} sharedSnapshot={sharedStats} useSharedStats={true} />}
            </div>
        </React.Fragment>
    )
}

export default StreamComponent
