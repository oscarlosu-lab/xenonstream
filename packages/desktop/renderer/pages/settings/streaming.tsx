import React from 'react'
import Head from 'next/head'

import SettingsSidebar from '../../components/settings/sidebar'
import Card from '../../components/ui/card'
import Button from '../../components/ui/button'
import Ipc from '../../lib/ipc'

import { useTranslation } from 'react-i18next'

import { useSettings } from '../../context/userContext'
import { defaultSettings } from '../../context/userContext.defaults'

// The region endpoints are configured in `config/regions.json` instead of being
// hardcoded here, so they are not duplicated as string literals in the source.
// They are public xCloud STACK endpoints, one per region. The address is sent
// as the `X-Forwarded-For` header to pin the authentication flow to a region,
// so it has to be an IP address instead of a hostname.
import regions from '../../config/regions.json'


function SettingsStreaming() {
    const { settings, setSettings} = useSettings()
    const { t } = useTranslation()

    React.useEffect(() => {
    //
    })

    function resetDefaults(){
        if(!confirm(t('settings.common.resetDefaultsConfirm'))) return

        const keys = ['xcloud_bitrate', 'xhome_bitrate', 'xcloud_show_non_entitled', 'video_profiles', 'video_codec', 'force_region_ip', 'preferred_game_language', 'remote_port', 'remote_port_consoles']
        const reset = {}
        keys.forEach((k) => { reset[k] = defaultSettings[k] })
        setSettings({ ...settings, ...reset })

        // Re-apply the side effects handled by the main process
        Ipc.send('app', 'setForceRegionIp', { ip: defaultSettings.force_region_ip })
        Ipc.send('app', 'setPreferredGameLanguage', { language: defaultSettings.preferred_game_language })
    }

    function setxCloudBitrate(e){
        console.log('Set xCloud bitrate to:', e.target.value)
        setSettings({
            ...settings,
            xcloud_bitrate: parseInt(e.target.value),
        })
    }

    function setxHomeBitrate(e){
        console.log('Set xHome bitrate to:', e.target.value)
        setSettings({
            ...settings,
            xhome_bitrate: parseInt(e.target.value),
        })
    }

    function setShowNonEntitled(e){
        setSettings({
            ...settings,
            xcloud_show_non_entitled: e.target.checked,
        })
    }

    function setVideoProfile(profile){
        console.log('Set video profile to:', profile)
        setSettings({
            ...settings,
            video_profiles: (profile !== '') ? [profile] : [],
        })
    }

    function setVideoCodec(codec: string){
        setSettings({
            ...settings,
            video_codec: codec || 'h264',
        })
    }

    // video_profiles ([])

    function setStreamResolution(e){
        setSettings({
            ...settings,
            stream_resolution: Number.parseInt(e.target.value),
        })
    }

    function setRemotePort(e){
        const parsed = Number.parseInt(e.target.value, 10)
        setSettings({
            ...settings,
            remote_port: Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 9002,
        })
    }

    function setPreferredGameLanguage(e){
        setSettings({
            ...settings,
            preferred_game_language: e,
        })

        Ipc.send('app', 'setPreferredGameLanguage', { language: e }).then((res) => {
            console.log('Set preferred game language:', res)
        })
    }

    function setForceRegionIp(e){
        setSettings({
            ...settings,
            force_region_ip: e,
        })

        Ipc.send('app', 'setForceRegionIp', { ip: e }).then((res) => {
            console.log('Set force region IP:', res)
        })
    }

    return (
        <React.Fragment>
            <Head>
                <title>XenonStream - {t('settings.streaming.pageTitle')}</title>
            </Head>

            <SettingsSidebar>
                <Card>
                    <h1>{t('settings.streaming.title')}</h1>

                    <p>{t('settings.streaming.description')}</p>
                    <p>

                        <label>{t('settings.streaming.xCloudStreamingBitrateLabel')}</label>
                        <input type="range" min="0" max="40960" step="1024" value={settings.xcloud_bitrate} onChange={ setxCloudBitrate } />
                        <span style={{ display: 'block', marginTop: 4 }}>{ settings.xcloud_bitrate === 0 ? t('settings.streaming.unlimitedLabel') : Math.floor(settings.xcloud_bitrate / 1024) + ' ' + t('settings.streaming.mbpsLabel') }</span>
                    </p>
                    <p>
                        <label>{t('settings.streaming.xHomeStreamingBitrateLabel')}</label>
                        <input type="range" min="0" max="40960" step="1024" value={settings.xhome_bitrate} onChange={ setxHomeBitrate } />
                        <span style={{ display: 'block', marginTop: 4 }}>{ settings.xhome_bitrate === 0 ? t('settings.streaming.unlimitedLabel') : Math.floor(settings.xhome_bitrate / 1024) + ' ' + t('settings.streaming.mbpsLabel') }</span>
                    </p>

                    <p>
                        <label>{t('settings.streaming.showNonEntitledLabel')}</label>
                        <input type='checkbox' checked={settings.xcloud_show_non_entitled} onChange={setShowNonEntitled} />
                    </p>

                    <p>
                        <label>{t('settings.streaming.streamResolutionLabel')}</label>
                        <select value={ settings.stream_resolution } onChange={ setStreamResolution }>
                            <option value={0}>{t('settings.streaming.setH264ProfileValueAuto')}</option>
                            <option value={720}>720p</option>
                            <option value={1080}>1080p</option>
                            <option value={1440}>1440p</option>
                        </select>
                        <br /><small>{t('settings.streaming.streamResolutionDescription')}</small>
                    </p>

                    <p>
                        <label>{t('settings.streaming.preferredCodecLabel')}</label>
                        <select value={ settings.video_codec || 'h264' } onChange={ (e) => setVideoCodec(e.target.value) }>
                            <option value="h264">{t('settings.streaming.preferredCodecValueH264')}</option>
                            <option value="hevc">{t('settings.streaming.preferredCodecValueHEVC')}</option>
                            <option value="av1">{t('settings.streaming.preferredCodecValueAV1')}</option>
                        </select>
                        <br /><small>{t('settings.streaming.preferredCodecDescription')}</small>
                    </p>

                    <p>
                        <label>{t('settings.streaming.setH264ProfileLabel')}</label>
                        <select value={ (settings.video_profiles.length > 0) ? settings.video_profiles[0] : '' } onChange={ (e) => setVideoProfile(e.target.value) }>
                            <option value="">{t('settings.streaming.setH264ProfileValueAuto')}</option>
                            <option value="4d">{t('settings.streaming.setH264ProfileValueHigh')}</option>
                            <option value="42e">{t('settings.streaming.setH264ProfileValueMedium')}</option>
                            <option value="420">{t('settings.streaming.setH264ProfileValueLow')}</option>
                        </select>
                        <br /><small>{t('settings.streaming.setH264ProfileDescription')}</small>
                    </p>

                    <p>
                        <label>{t('settings.streaming.remotePortLabel', { defaultValue: 'Remote Play public port' })}</label>
                        <input
                            type="number"
                            min={1}
                            max={65535}
                            value={settings.remote_port ?? 9002}
                            onChange={setRemotePort}
                            style={{ maxWidth: 140 }}
                        />
                        <br /><small>{t('settings.streaming.remotePortDescription', { defaultValue: 'External UDP port forwarded to your Xbox for Remote Play (default: 9002).' })}</small>
                    </p>

                </Card>

                <Card>
                    <h1>{t('settings.streaming.forceRegionTitle')}</h1>
                    <p>

                        <label>{t('settings.streaming.setRegionLabel')}</label>
                        <select value={ settings.force_region_ip || '' } onChange={ (e) => setForceRegionIp(e.target.value) }>
                            <option value="">{t('settings.streaming.setRegionValueDisabled')}</option>
                            {regions.regions.map((region) => (
                                <option key={region.ip} value={region.ip}>{t(region.label)}</option>
                            ))}
                        </select>
                        <br /><small>{t('settings.streaming.setRegionDescription')}</small>
                    </p>
                    <p>
                        <label>{t('settings.streaming.preferredGameLanguageLabel')}</label>
                        {(() => {
                            const languages = [
                                { code: "ar-SA", label: t('settings.streaming.preferredGameLanguageValueArabic') },
                                { code: "cs-CZ", label: t('settings.streaming.preferredGameLanguageValueCzech') },
                                { code: "da-DK", label: t('settings.streaming.preferredGameLanguageValueDanish') },
                                { code: "de-DE", label: t('settings.streaming.preferredGameLanguageValueGerman') },
                                { code: "el-GR", label: t('settings.streaming.preferredGameLanguageValueGreek') },
                                { code: "en-GB", label: t('settings.streaming.preferredGameLanguageValueEnglishUK') },
                                { code: "en-US", label: t('settings.streaming.preferredGameLanguageValueEnglishUS') },
                                { code: "es-ES", label: t('settings.streaming.preferredGameLanguageValueSpanish') },
                                { code: "es-MX", label: t('settings.streaming.preferredGameLanguageValueSpanishMX') },
                                { code: "fi-FI", label: t('settings.streaming.preferredGameLanguageValueFinnish') },
                                { code: "fr-FR", label: t('settings.streaming.preferredGameLanguageValueFrench') },
                                { code: "he-IL", label: t('settings.streaming.preferredGameLanguageValueHebrew') },
                                { code: "hu-HU", label: t('settings.streaming.preferredGameLanguageValueHungarian') },
                                { code: "it-IT", label: t('settings.streaming.preferredGameLanguageValueItalian') },
                                { code: "ja-JP", label: t('settings.streaming.preferredGameLanguageValueJapanese') },
                                { code: "ko-KR", label: t('settings.streaming.preferredGameLanguageValueKorean') },
                                { code: "nb-NO", label: t('settings.streaming.preferredGameLanguageValueNorwegian') },
                                { code: "nl-NL", label: t('settings.streaming.preferredGameLanguageValueDutch') },
                                { code: "pl-PL", label: t('settings.streaming.preferredGameLanguageValuePolish') },
                                { code: "pt-BR", label: t('settings.streaming.preferredGameLanguageValuePortugueseBR') },
                                { code: "pt-PT", label: t('settings.streaming.preferredGameLanguageValuePortuguese') },
                                { code: "ru-RU", label: t('settings.streaming.preferredGameLanguageValueRussian') },
                                { code: "sk-SK", label: t('settings.streaming.preferredGameLanguageValueSlovak') },
                                { code: "sv-SE", label: t('settings.streaming.preferredGameLanguageValueSwedish') },
                                { code: "tr-TR", label: t('settings.streaming.preferredGameLanguageValueTurkish') },
                                { code: "zh-CN", label: t('settings.streaming.preferredGameLanguageValueChineseCN') },
                                { code: "zh-TW", label: t('settings.streaming.preferredGameLanguageValueChineseTW') },
                            ];
                            // Sort languages alphabetically by label
                            const sortedLanguages = languages.sort((a, b) => a.label.localeCompare(b.label));
                            return (
                                <select value={settings.preferred_game_language || ''} onChange={(e) => setPreferredGameLanguage(e.target.value)}>
                                    {sortedLanguages.map(lang => (
                                        <option key={lang.code} value={lang.code}>{lang.label}</option>
                                    ))}
                                </select>
                            );
                        })()}
                    </p>
                </Card>

                <p style={{ textAlign: 'right' }}>
                    <Button onClick={ resetDefaults } className='btn-small' label={ t('settings.common.resetDefaultsBtn') }></Button>
                </p>
            </SettingsSidebar>


        </React.Fragment>
    )
}

export default SettingsStreaming
