import React from 'react'
import Head from 'next/head'
import SettingsSidebar from '../../components/settings/sidebar'
import Card from '../../components/ui/card'
import AudioDeviceSelect from '../../components/ui/audiodeviceselect'
import Button from '../../components/ui/button'
import Ipc from '../../lib/ipc'
import { useAudioDevices } from '../../lib/audiodevices'
import { useSettings } from '../../context/userContext'
import { defaultSettings } from '../../context/userContext.defaults'
import { normalizeUpscalerMode } from '../../../lib/videoUpscaler'
import { useTranslation } from 'react-i18next'


function SettingsVideo() {
    const { settings, setSettings} = useSettings()
    const { t } = useTranslation()
    const audioDevices = useAudioDevices()

    React.useEffect(() => {
    //
    })

    function setVideoSize(e){
        setSettings({
            ...settings,
            video_size: e,
        })
    }

    function forceLowResolution(){
        Ipc.send('settings', 'setLowResolution').then(() => {
            console.log('Resizing main window...')
            setSettings({
                ...settings,
                app_lowresolution: (!settings.app_lowresolution),
            })
        })
    }

    const activeUpscaler = normalizeUpscalerMode(settings.video_upscaler, settings.clarity_boost_strength)

    function setClarityBoost(e){
        setSettings({
            ...settings,
            clarity_boost_strength: parseFloat(e.target.value),
        })
    }

    function setUpscalerMode(mode: string){
        setSettings({
            ...settings,
            video_upscaler: mode,
        })
    }

    function setUpscalerSharpness(e){
        setSettings({
            ...settings,
            video_upscaler_sharpness: parseFloat(e.target.value),
        })
    }

    function setAudioEnabled(){
        setSettings({
            ...settings,
            audio_enabled: (!settings.audio_enabled),
        })
    }

    function setVideoEnabled(){
        setSettings({
            ...settings,
            video_enabled: (!settings.video_enabled),
        })
    }

    function setFpsOverlayEnabled(){
        setSettings({
            ...settings,
            stream_fps_overlay: (!settings.stream_fps_overlay),
        })
    }

    function resetDefaults(){
        if(!confirm(t('settings.common.resetDefaultsConfirm'))) return

        setSettings({
            ...settings,
            video_enabled: defaultSettings.video_enabled,
            audio_enabled: defaultSettings.audio_enabled,
            video_size: defaultSettings.video_size,
            app_lowresolution: defaultSettings.app_lowresolution,
            clarity_boost_strength: defaultSettings.clarity_boost_strength,
            video_upscaler: defaultSettings.video_upscaler,
            video_upscaler_sharpness: defaultSettings.video_upscaler_sharpness,
            stream_fps_overlay: defaultSettings.stream_fps_overlay,
        })
    }

    return (
        <React.Fragment>
            <Head>
                <title>XenonStream - {t('settings.videoAudio.pageTitle')}</title>
            </Head>

            <SettingsSidebar>
                <Card>
                    <h1>{t('settings.videoAudio.title')}</h1>

                    <p>
                        <label>{t('settings.videoAudio.disableVideoLabel')}</label>
                        <span style={{ minWidth: 0 }}>
                            <input type='checkbox' aria-label={t('settings.videoAudio.disableVideoLabel')} onChange={ setVideoEnabled } checked={!settings.video_enabled} />
                        </span>
                    </p>

                    <p>
                        <label>{t('settings.videoAudio.aspectSizeLabel')}</label>
                        <select value={ settings.video_size } onChange={(e) => {
                            setVideoSize(e.target.value)
                        }}>
                            <option value='default'>{t('settings.videoAudio.aspectSizeValueDefault')}</option>
                            <option value='stretch'>{t('settings.videoAudio.aspectSizeValueStretch')}</option>
                            <option value='zoom'>{t('settings.videoAudio.aspectSizeValueZoom')}</option>
                        </select>
                    </p>

                    <p>
                        <label>{t('settings.videoAudio.forceLowResLabel')}</label>
                        <span style={{ minWidth: 0 }}>
                            <input type='checkbox' aria-label={t('settings.videoAudio.forceLowResLabel')} onChange={ forceLowResolution } checked={settings.app_lowresolution} />
                        </span><br />
                        <small>{t('settings.videoAudio.forceLowResDescription')}</small>
                    </p>

                    <p>
                        <label>{t('settings.videoAudio.upscalerLabel')}</label>
                        <select value={ activeUpscaler } onChange={(e) => {
                            setUpscalerMode(e.target.value)
                        }}>
                            <option value='off'>{t('settings.videoAudio.upscalerModeOff')}</option>
                            <option value='rtx_vsr'>{t('settings.videoAudio.upscalerModeRtxVsr')}</option>
                            <option value='clarity'>{t('settings.videoAudio.upscalerModeClarity')}</option>
                            <option value='cas'>{t('settings.videoAudio.upscalerModeCas')}</option>
                            <option value='fsr1'>{t('settings.videoAudio.upscalerModeFsr1')}</option>
                        </select>
                        <br />
                        <small>{t('settings.videoAudio.upscalerDescription')}</small>
                    </p>

                    {(activeUpscaler === 'cas' || activeUpscaler === 'fsr1') && (
                        <p>
                            <label>{t('settings.videoAudio.upscalerSharpnessLabel')}</label>
                            <input type='range' min='0' max='1' step='0.05' value={settings.video_upscaler_sharpness ?? 0.5} onChange={ setUpscalerSharpness } />
                            ({ settings.video_upscaler_sharpness ?? 0.5 })
                        </p>
                    )}

                    {activeUpscaler === 'clarity' && (
                        <p>
                            <label>{t('settings.videoAudio.clarityBoostLabel')}</label>
                            <input type='range' min='0' max='1' step='0.05' value={settings.clarity_boost_strength} onChange={ setClarityBoost } />
                            ({ settings.clarity_boost_strength })
                            <br />
                            <small>{t('settings.videoAudio.clarityBoostDescription')}</small>
                        </p>
                    )}

                    <p>
                        <label>{t('settings.videoAudio.fpsOverlayLabel')}</label>
                        <span style={{ minWidth: 0 }}>
                            <input type='checkbox' aria-label={t('settings.videoAudio.fpsOverlayLabel')} onChange={ setFpsOverlayEnabled } checked={Boolean(settings.stream_fps_overlay)} />
                        </span><br />
                        <small>{t('settings.videoAudio.fpsOverlayDescription')}</small>
                    </p>
                </Card>

                <Card>
                    <h1>{t('settings.videoAudio.audioTitle')}</h1>

                    <p>
                        <label>{t('settings.videoAudio.disableAudioLabel')}</label>
                        <span style={{ minWidth: 0 }}>
                            <input type='checkbox' aria-label={t('settings.videoAudio.disableAudioLabel')} onChange={ setAudioEnabled } checked={!settings.audio_enabled} />
                        </span>
                    </p>

                    <p>
                        <label>{t('settings.videoAudio.outputDeviceLabel')}</label>
                        <AudioDeviceSelect devices={audioDevices.outputs} value={settings.audio_output_device} onChange={(deviceId) => {
                            setSettings({
                                ...settings,
                                audio_output_device: deviceId,
                            })
                        }} />
                    </p>

                    <p>
                        <label>{t('settings.videoAudio.inputDeviceLabel')}</label>
                        <AudioDeviceSelect devices={audioDevices.inputs} value={settings.audio_input_device} onChange={(deviceId) => {
                            setSettings({
                                ...settings,
                                audio_input_device: deviceId,
                            })
                        }} />
                    </p>
                </Card>

                <p style={{ textAlign: 'right' }}>
                    <Button onClick={ resetDefaults } className='btn-small' label={ t('settings.common.resetDefaultsBtn') }></Button>
                </p>
            </SettingsSidebar>


        </React.Fragment>
    )
}

export default SettingsVideo
