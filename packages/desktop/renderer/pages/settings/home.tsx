import React from 'react'
import { useTranslation } from 'react-i18next'
import LanguageSelector from '../../components/settings/LanguageSelector'
import Head from 'next/head'
import Link from 'next/link'
import Ipc from '../../lib/ipc'

import SettingsSidebar from '../../components/settings/sidebar'
import Image from 'next/image'
import XenonStreamLogo from '../../public/images/logo.png'
import Card from '../../components/ui/card'
import Button from '../../components/ui/button'
import { useSettings } from '../../context/userContext'

interface userData {
  gamerpic?: string;
  gamerscore?: string;
  gamertag?: string;
  level?: number;
  signedIn?: boolean;
  type?: string;
}

interface accountData {
  xuid: string;
  gamertag: string;
  gamerpic: string;
  gamerscore: string;
  active: boolean;
}

function SettingsHome() {
    const [user, setUser] = React.useState<userData>({})
    const [accounts, setAccounts] = React.useState<accountData[]>([])
    const { t } = useTranslation()
    const { settings, setSettings } = useSettings()
    const isWebUI = window.XenonStream.isWebUI()

    React.useEffect(() => {
        Ipc.send('app', 'getAccounts').then((accounts) => {
            setAccounts(accounts)
        })
    }, [])

    React.useEffect(() => {
        if(Object.keys(user).length === 0){
            Ipc.send('app', 'loadCachedUser').then((user) => {
                console.log('Set user:', user)
                setUser(user)
            })
        }
    }, [user])

    function logout(){
        if(confirm(t('settings.about.logoutQuestion'))){
            const active = accounts.find((account) => account.active)
            if(active !== undefined){
                Ipc.send('app', 'removeAccount', { xuid: active.xuid })
            } else {
                Ipc.send('app', 'clearData')
            }
        }
    }

    function switchAccount(xuid:string){
        Ipc.send('app', 'switchAccount', { xuid: xuid })
    }

    function addAccount(){
        Ipc.send('app', 'addAccount')
    }

    function removeAccount(account:accountData){
        if(confirm(t('settings.accounts.removeQuestion', { gamertag: account.gamertag }))){
            Ipc.send('app', 'removeAccount', { xuid: account.xuid }).then(() => {
                setAccounts(accounts.filter((item) => item.xuid !== account.xuid))
            })
        }
    }

    return (
        <React.Fragment>
            <Head>
                <title>XenonStream - {t('settings.about.title')}</title>
            </Head>

            <SettingsSidebar>
                <Card>
                    <div id="component_auth_modal">
                        <div className="component_auth_profile_gamerpic" style={{
                            float: 'left',
                            marginTop: 20,
                            marginLeft: 20,
                            marginRight: 40,
                        }}>
                            <Image src={ user.gamerpic } alt={ user.gamertag } width='100' height='100' className="component_auth_profile_gamerpic_img" />
                        </div>

                        <div className="component_auth_profile_userdetails">
                            <h1 style={{ paddingBottom: 5 }}>{ user.gamertag }</h1>
                            <p>
                                {t('settings.about.gamerscore')}: { user.gamerscore }
                            </p>
                            <Button label={t('settings.about.logout')} className='btn' disabled={(window.XenonStream.isWebUI() === false) ? false : true } onClick={ () => {
                                logout()
                            } }></Button>
                        </div>

                        <br style={{ clear: 'both' }} />
                    </div>
                </Card>

                <Card>
                    <h1>{t('settings.accounts.title')}</h1>

                    {accounts.map((account) => (
                        <div key={account.xuid} style={{ display: 'flex', alignItems: 'center', gap: 15, paddingBottom: 10 }}>
                            <Image src={ account.gamerpic } alt={ account.gamertag } width='40' height='40' className="component_auth_profile_gamerpic_img" />
                            <div style={{ flex: 1 }}>
                                <strong>{ account.gamertag }</strong><br />
                                {t('settings.about.gamerscore')}: { account.gamerscore }
                            </div>
                            {account.active ? <span>{t('settings.accounts.active')}</span> : <React.Fragment>
                                <Button label={t('settings.accounts.switch')} className='btn-primary' disabled={isWebUI} onClick={ () => {
                                    switchAccount(account.xuid)
                                } }></Button>
                                <Button label={t('settings.accounts.remove')} className='btn' disabled={isWebUI} onClick={ () => {
                                    removeAccount(account)
                                } }></Button>
                            </React.Fragment>}
                        </div>
                    ))}

                    <Button label={t('settings.accounts.add')} className='btn' disabled={isWebUI} onClick={ () => {
                        addAccount()
                    } }></Button>
                </Card>

                <LanguageSelector />

                <Card>
                    <h1>Discord Rich Presence</h1>
                    <p>
                        <label>
                            <input
                                type='checkbox'
                                checked={settings.discord_rpc_enabled === true}
                                onChange={(e) => {
                                    setSettings({
                                        ...settings,
                                        discord_rpc_enabled: e.target.checked,
                                    })
                                }}
                            />&nbsp; Enable Discord Rich Presence (opt-in)
                        </label>
                    </p>
                    {settings.discord_rpc_enabled === true && (
                        <p>
                            <label>Discord Application Client ID</label><br />
                            <input
                                type='text'
                                className='text'
                                placeholder='e.g. 123456789012345678'
                                value={settings.discord_rpc_client_id || ''}
                                onChange={(e) => {
                                    setSettings({
                                        ...settings,
                                        discord_rpc_client_id: e.target.value,
                                    })
                                }}
                            />
                        </p>
                    )}
                </Card>

                <Card>
                    <div style={{ textAlign: 'center' }}>
                        <Image src={ XenonStreamLogo } width="100" height="100" alt="XenonStream" />

                        <h2>XenonStream</h2>
                        <p>
                            {t('settings.about.version')}: { window.XenonStream.getVersion() }<br /><br />
                            <small>{t('settings.about.website')}: <Link href="#" title={t('settings.about.websiteLinkTitle')} onClick={ () => {
                                window.XenonStream.openExternal('https://github.com/oscarlosu-lab/xenonstream')
                            }}>github.com/oscarlosu-lab/xenonstream</Link></small><br />
                            <small>{t('authorOfLocalization')}</small>
                        </p>
                    </div>
                </Card>
            </SettingsSidebar>


        </React.Fragment>
    )
}

export default SettingsHome
