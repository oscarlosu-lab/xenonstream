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
})
