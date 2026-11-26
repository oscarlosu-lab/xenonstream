import React from 'react'
import Ipc from '../../lib/ipc'
import SidebarFriendItem from './frienditem'
import { useTranslation } from 'react-i18next'

function SidebarFriends() {
    const [onlineFriends, setOnlineFriends] = React.useState([])
    const { t } = useTranslation()

    React.useEffect(() => {
        let isMounted = true

        const updateFriends = () => {
            Ipc.send('app', 'getOnlineFriends').then((onlineFriends) => {
                if (isMounted) {
                    setOnlineFriends(onlineFriends)
                }
            }).catch(() => {
                // Ignore IPC errors on unmount
            })
        }
        const t1 = setTimeout(() => {
            updateFriends()
        }, 1000)
        const t2 = setTimeout(() => {
            updateFriends()
        }, 2000)
        const t3 = setTimeout(() => {
            updateFriends()
        }, 3000)
        const friendsInterval = setInterval(updateFriends, 1000*15)

        return () => {
            isMounted = false
            clearTimeout(t1)
            clearTimeout(t2)
            clearTimeout(t3)
            clearInterval(friendsInterval)
        }
    }, [])

    return (
        <React.Fragment>
            <div id="components_sidebarfriends" key="components_sidebarfriends">
                {(onlineFriends.length > 0) ? onlineFriends.map((item:any) => {
                    return (
                        <SidebarFriendItem key={ item.xuid } userinfo={ item }></SidebarFriendItem>
                    )
                }) : <div className='components_sidebarfrienditem'><div className='components_sidebarfrienditem_userdetails'><p>{t('friends.allFriendsOffline')}</p></div></div> }
            </div>
        </React.Fragment>
    )
}

export default SidebarFriends
