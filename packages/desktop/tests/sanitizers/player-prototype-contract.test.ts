import xCloudPlayer from 'xbox-xcloud-player'
import InputChannel from 'xbox-xcloud-player/dist/Channel/Input'
import MessageChannel from 'xbox-xcloud-player/dist/Channel/Message'
import GamepadDriver from 'xbox-xcloud-player/dist/Driver/Gamepad'

describe('xbox-xcloud-player 0.2.11 prototype contract', () => {
    test('InputChannel.prototype exposes methods patched by mousesensitivitypatch, systemui, and escapekey', () => {
        const proto = InputChannel.prototype as any
        expect(typeof proto.onPointerMove).toBe('function')
        expect(typeof proto.onPointerClick).toBe('function')
        expect(typeof proto.onKeyDown).toBe('function')
        expect(typeof proto.onKeyUp).toBe('function')
    })

    test('MessageChannel.prototype exposes methods patched by systemui', () => {
        const proto = MessageChannel.prototype as any
        expect(typeof proto.onMessage).toBe('function')
        expect(typeof proto.sendTransaction).toBe('function')
    })

    test('xCloudPlayer.prototype exposes setRemoteOffer patched for async SDP error handling', () => {
        const proto = xCloudPlayer.prototype as any
        expect(typeof proto.setRemoteOffer).toBe('function')
    })

    test('GamepadDriver.prototype exposes start, stop, and mapStateLabels extended by CompactGamepadDriver', () => {
        const proto = GamepadDriver.prototype as any
        expect(typeof proto.start).toBe('function')
        expect(typeof proto.stop).toBe('function')
        expect(typeof proto.mapStateLabels).toBe('function')
    })
})
