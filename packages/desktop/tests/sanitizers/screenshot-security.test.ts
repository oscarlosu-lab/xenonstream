jest.mock('electron', () => ({
    app: { getPath: jest.fn(() => '/tmp') },
}))

import { MAX_SCREENSHOT_BYTES, validateScreenshotPayload } from '../../main/ipc/screenshot'

describe('IpcScreenshot payload security validation', () => {
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

    it('accepts a valid PNG base64 payload within size limit', () => {
        const result = validateScreenshotPayload(validPngHeader.toString('base64'))
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result.equals(validPngHeader)).toBe(true)
    })

    it('rejects non-PNG payloads (e.g. arbitrary text, HTML, PE/ELF executables)', () => {
        expect(() => validateScreenshotPayload(Buffer.from('<html>not a png</html>').toString('base64'))).toThrow(/PNG signature/i)
        expect(() => validateScreenshotPayload(Buffer.from('MZ\x90\x00\x03\x00\x00\x00').toString('base64'))).toThrow(/PNG signature/i)
        expect(() => validateScreenshotPayload(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))).toThrow(/PNG signature/i)
    })

    it('rejects empty or non-string payloads', () => {
        expect(() => validateScreenshotPayload('')).toThrow(/non-empty base64/i)
        expect(() => validateScreenshotPayload(null)).toThrow(/non-empty base64/i)
        expect(() => validateScreenshotPayload(undefined)).toThrow(/non-empty base64/i)
        expect(() => validateScreenshotPayload(12345)).toThrow(/non-empty base64/i)
    })

    it('rejects payloads exceeding 32 MiB before writing to disk', () => {
        const oversizedBase64 = 'A'.repeat(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 16)
        expect(() => validateScreenshotPayload(oversizedBase64)).toThrow(/exceeds maximum size/i)
    })
})
