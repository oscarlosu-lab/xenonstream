// Maps legacy language filenames to their canonical BCP-47 locale codes
// so existing user settings survive language file renames without falling back to English.
export const LEGACY_LANGUAGE_MAP: Record<string, string> = {
    Greenlight_Spanish: 'es-ES',
}

export function normalizeLanguageCode(language?: string): string | undefined {
    if (!language) {
        return language
    }
    return LEGACY_LANGUAGE_MAP[language] ?? language
}

export function resolveAvailableLanguage(
    preferred: string | undefined,
    available: string[],
    systemLanguages: string[],
    fallback = 'en-US',
): string {
    const normalized = normalizeLanguageCode(preferred)
    if (normalized && available.includes(normalized)) {
        return normalized
    }

    for (const systemLanguage of systemLanguages) {
        const wanted = (systemLanguage || '').toLowerCase()
        if (!wanted) {
            continue
        }
        const match = available.find((code) => code.toLowerCase() === wanted)
            || available.find((code) => code.toLowerCase().split('-')[0] === wanted.split('-')[0])
        if (match) {
            return match
        }
    }

    return fallback
}
