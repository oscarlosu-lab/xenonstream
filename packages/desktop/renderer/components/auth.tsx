import React from 'react'
import Ipc from '../lib/ipc'
import Image from 'next/image'
import QRCode from 'react-qr-code'
import type { DeviceLogin } from '../../device-login'

import Card from '../components/ui/card'
import Button from './ui/button'
import Loader from './ui/loader'

import { useTranslation } from 'react-i18next'
import XenonStreamLogo from '../public/images/logo.png'

interface AuthProps {
  signedIn: boolean;
  gamertag?: string;
  gamerpic?: string;
  gamerscore?: string;
  isLoading?: boolean;
  deviceLogin?: DeviceLogin | null;
}

function Auth({
    signedIn = false,
    gamertag,
    gamerpic,
    gamerscore,
    isLoading = false,
    deviceLogin,
}: AuthProps) {
    const { t } = useTranslation()

    function startAuthFlow(){
        Ipc.send('app', 'login')
    }

    function logout(){
        if(confirm(t('auth.logoutQuestion'))){
            Ipc.send('app', 'clearData')
        }
    }

    function clearData(){
        if(confirm(t('auth.clearDataQuestion'))){
            Ipc.send('app', 'clearData')
        }
    }

    return (
        <React.Fragment>
            <div id="component_auth">

                <div id="component_auth_modal">
                    <div className="xs-auth-brand">
                        <Image src={ XenonStreamLogo } width="60" height="60" alt="XenonStream" className="xs-auth-logo" />
                        <div className="xs-auth-brand-text">
                            <span className="xs-auth-title">Xenon<span>Stream</span></span>
                            <span className="xs-auth-subtitle">1440p • HEVC / AV1 • Remote Play &amp; xCloud</span>
                        </div>
                    </div>
                    { deviceLogin ? <Card>
                        <div className="component_auth_device_login">
                            <div className="component_auth_qr">
                                <QRCode value={ deviceLogin.verificationUri } size={ 128 } title={ t('auth.deviceLoginTitle') } />
                            </div>
                            <div>
                                <h1>{ t('auth.deviceLoginTitle') }</h1>
                                <p>{ t('auth.deviceLoginInstructions') }</p>
                                <code className="component_auth_device_code">{ deviceLogin.userCode }</code>
                                <Button label={ t('auth.openDeviceLogin') } className="btn-primary" onClick={ () => window.XenonStream.openExternal(deviceLogin.verificationUri) } />
                            </div>
                        </div>
                    </Card> : isLoading === false ?
                        <Card>
                            {signedIn === true ? (<div className="component_auth_profile_container">
                                <div className="component_auth_profile_gamerpic">
                                    <Image src={ gamerpic } className="component_auth_profile_gamerpic_img" alt={ gamertag } width='96' height='96'></Image>
                                </div>

                                <div className="component_auth_profile_userdetails">
                                    <h1>{ gamertag }</h1>
                                    <p>
                                        {t('auth.gamerscore')}: { gamerscore }
                                    </p>
                                    {/* <p>
                                        {t('auth.loggingIn')}
                                    </p> */}
                                    <Button label={t('auth.loginBtn')} className='btn-primary' onClick={ () => {
                                        startAuthFlow()
                                    } }></Button> &nbsp;
                                    <Button label={t('auth.logoutBtn')} className='btn' onClick={ () => {
                                        logout()
                                    } }></Button>
                                </div>

                            </div>) : (<div style={{
                                textAlign: 'center',
                                paddingBottom: '20px',
                            }}>
                                <h1>{t('auth.loginWithXbox')}</h1>
                                <p>
                                    {t('auth.pleaseAuthenticate')}
                                </p>
                                <Button label={t('auth.loginBtn')} className='btn-primary' onClick={ () => {
                                    startAuthFlow()
                                } }></Button> &nbsp;
                                <Button label={t('auth.clearDataBtn')} className='btn' onClick={ () => {
                                    clearData()
                                } }></Button>
                            </div>) }
                        </Card>:<Card><div style={{
                            textAlign: 'center',
                        }}><Loader></Loader><br /></div></Card>
                    }
                </div>
            </div>
        </React.Fragment>
    )
}

export default Auth
