import fs from 'fs'
import path from 'path'
import { normalizeLanguageCode, resolveAvailableLanguage } from '../../shared/languageMigration'

describe('i18n legacy language migration', () => {
    const available = ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT']

    it('maps legacy Greenlight_Spanish to es-ES', () => {
        expect(normalizeLanguageCode('Greenlight_Spanish')).toBe('es-ES')
        expect(resolveAvailableLanguage('Greenlight_Spanish', available, ['en-US'])).toBe('es-ES')
    })

    it('preserves canonical locale codes and empty/undefined values', () => {
        expect(normalizeLanguageCode('fr-FR')).toBe('fr-FR')
        expect(normalizeLanguageCode('')).toBe('')
        expect(normalizeLanguageCode(undefined)).toBeUndefined()
    })

    it('falls back to system language prefix when preference is empty or unavailable', () => {
        expect(resolveAvailableLanguage('', available, ['es-MX'])).toBe('es-ES')
        expect(resolveAvailableLanguage(undefined, available, ['it'])).toBe('it-IT')
        expect(resolveAvailableLanguage('unknown-XX', available, ['fr-CA'])).toBe('fr-FR')
    })

    it('falls back to en-US when neither preference nor system locale matches', () => {
        expect(resolveAvailableLanguage('', available, ['sv-SE'])).toBe('en-US')
        expect(resolveAvailableLanguage('Greenlight_Spanish', ['en-US'], ['sv-SE'])).toBe('en-US')
    })

    it('keeps all 13 locale files nested strictly under translation with upscaler and bar-toggle keys', () => {
        const langDir = path.join(__dirname, '..', '..', 'renderer', 'languages')
        const files = fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))
        expect(files).toHaveLength(13)

        const requiredVideoAudioKeys = [
            'upscalerLabel',
            'upscalerModeOff',
            'upscalerModeRtxVsr',
            'upscalerModeClarity',
            'upscalerModeCas',
            'upscalerModeFsr1',
            'upscalerSharpnessLabel',
            'upscalerDescription',
        ]
        const requiredStreamKeys = ['hideMenuBar', 'showMenuBar', 'upscalerTitle']

        for (const file of files) {
            const parsed = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'))
            expect(Object.keys(parsed)).toEqual(['translation'])
            for (const key of requiredVideoAudioKeys) {
                expect(typeof parsed.translation.settings.videoAudio[key]).toBe('string')
                expect(parsed.translation.settings.videoAudio[key].length).toBeGreaterThan(0)
            }
            for (const key of requiredStreamKeys) {
                expect(typeof parsed.translation.streamWindow[key]).toBe('string')
                expect(parsed.translation.streamWindow[key].length).toBeGreaterThan(0)
            }
        }
    })
})
