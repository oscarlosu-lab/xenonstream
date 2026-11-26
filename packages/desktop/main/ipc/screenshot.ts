import IpcBase from './base'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024 // 32 MiB
const MAX_BASE64_LENGTH = Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface saveScreenshotArgs {
    image: string; // base64-encoded PNG data (no data: URL prefix)
}

export function validateScreenshotPayload(image: unknown): Buffer {
    if (typeof image !== 'string' || image.length === 0) {
        throw new Error('Invalid screenshot payload: expected non-empty base64 string')
    }
    if (image.length > MAX_BASE64_LENGTH) {
        throw new Error(`Screenshot payload exceeds maximum size of ${MAX_SCREENSHOT_BYTES} bytes`)
    }

    const buffer = Buffer.from(image, 'base64')
    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
        throw new Error(`Screenshot exceeds maximum size of ${MAX_SCREENSHOT_BYTES} bytes`)
    }
    if (buffer.byteLength < PNG_MAGIC.byteLength || !buffer.subarray(0, PNG_MAGIC.byteLength).equals(PNG_MAGIC)) {
        throw new Error('Invalid screenshot payload: missing PNG signature')
    }

    return buffer
}

export default class IpcScreenshot extends IpcBase {

    saveScreenshot(args: saveScreenshotArgs) {
        return new Promise((resolve, reject) => {
            let buffer: Buffer

            try {
                buffer = validateScreenshotPayload(args?.image)
            } catch (error) {
                this._application.log('screenshot', 'Rejected screenshot payload:', error)
                reject(error)
                return
            }

            const screenshotDir = path.join(app.getPath('pictures'), 'XenonStream')

            fs.promises.mkdir(screenshotDir, { recursive: true }).then(() => {
                const filename = 'xenonstream-' + Date.now() + '-' + crypto.randomUUID() + '.png'
                const filePath = path.join(screenshotDir, filename)

                fs.promises.writeFile(filePath, buffer).then(() => {
                    this._application.log('screenshot', 'Saved screenshot to:', filePath)
                    resolve({ path: filePath })
                }).catch((error) => {
                    this._application.log('screenshot', 'Failed to write screenshot:', error)
                    reject(error)
                })
            }).catch((error) => {
                this._application.log('screenshot', 'Failed to create screenshot directory:', error)
                reject(error)
            })
        })
    }
}
