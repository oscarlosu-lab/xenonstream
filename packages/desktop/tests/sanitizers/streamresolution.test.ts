import MessageChannel from 'xbox-xcloud-player/dist/Channel/Message'
import ControlChannel from 'xbox-xcloud-player/dist/Channel/Control'
import { configureStreamResolution } from '../../renderer/lib/streamresolution'

describe('configureStreamResolution (720p / 1080p / 1440p)', () => {
    for (const height of [720, 1080, 1440]) {
        const width = (height * 16) / 9

        it(`sends ${width}x${height} dimensions, VideoPreference, and resolutionAlias on HandshakeAck`, () => {
            const messages: any[] = []
            const controls: any[] = []
            const client = {
                _config: {},
                _inputDriver: { start() {} },
                _keyboardDriver: { start() {} },
                getChannelProcessor: (name: string) => name === 'control' ? control : { start() {} },
                getEventBus: () => ({ emit() {} }),
            }

            const control = new ControlChannel('control', client as any)
            control.send = (data: string) => controls.push(JSON.parse(data))

            const channel = new MessageChannel('message', client as any)
            channel.send = (data: string) => messages.push(JSON.parse(data))

            configureStreamResolution({
                getChannelProcessor: (name: string) => name === 'message' ? channel : control,
            } as any, height)

            channel.onMessage({ data: JSON.stringify({ type: 'HandshakeAck' }) } as any)

            const dimensions = messages.find((m) => m.target === '/streaming/characteristics/dimensionschanged')
            expect(dimensions).toBeDefined()
            const parsed = JSON.parse(dimensions.content)
            expect(parsed.horizontal).toBe(width)
            expect(parsed.vertical).toBe(height)
            expect(parsed.preferredWidth).toBe(width)
            expect(parsed.preferredHeight).toBe(height)
            expect(parsed.safeAreaRight).toBe(width)
            expect(parsed.safeAreaBottom).toBe(height)

            const videoPref = controls.find((m) => m.message === 'VideoPreference')
            expect(videoPref).toEqual({
                message: 'VideoPreference',
                type: 'VideoPreference',
                resolution: { width, height },
                dimensions: { width, height },
                maxFPS: 60,
            })

            const resUpdate = controls.filter((m) => m.message === 'userRequestedResolutionUpdate')
            expect(resUpdate).toEqual([{ message: 'userRequestedResolutionUpdate', resolutionAlias: String(height) }])
        })
    }
})
