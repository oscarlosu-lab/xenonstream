import path from 'path'

export interface StartupFlags {
    fullscreen: boolean
    autoStream: string
    profile: string
    consoleId: string
}

// Strict allowlists: no path separators, dots, spaces, or shell/URL metacharacters.
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/
const WINDOWS_RESERVED_DEVICE_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const CONSOLE_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/

export function validateProfileName(raw: string): string {
    const trimmed = raw.trim()
    if (!PROFILE_NAME_PATTERN.test(trimmed) || WINDOWS_RESERVED_DEVICE_PATTERN.test(trimmed)) {
        return ''
    }
    return trimmed
}

export function validateConsoleId(raw: string): string {
    const trimmed = raw.trim()
    if (!CONSOLE_ID_PATTERN.test(trimmed)) {
        return ''
    }
    return trimmed
}

export function parseStartupFlags(argv: string[]): StartupFlags {
    const flags: StartupFlags = {
        fullscreen: false,
        autoStream: '',
        profile: '',
        consoleId: '',
    }

    for (const arg of argv) {
        if (typeof arg !== 'string') {
            continue
        }
        if (arg === '--fullscreen' || arg.startsWith('--fullscreen=')) {
            flags.fullscreen = true
        } else if (arg.startsWith('--connect=')) {
            flags.autoStream = arg.substring('--connect='.length).trim()
        } else if (arg.startsWith('--profile=')) {
            const raw = arg.substring('--profile='.length)
            flags.profile = validateProfileName(raw)
            if (raw.trim() && !flags.profile) {
                console.warn(`[XenonStream] Ignoring invalid or reserved --profile value "${raw}"; falling back to default profile.`)
            }
        } else if (arg.startsWith('--instance=')) {
            const raw = arg.substring('--instance='.length)
            flags.profile = validateProfileName(raw)
            if (raw.trim() && !flags.profile) {
                console.warn(`[XenonStream] Ignoring invalid or reserved --instance value "${raw}"; falling back to default profile.`)
            }
        } else if (arg.startsWith('--console=')) {
            flags.consoleId = validateConsoleId(arg.substring('--console='.length))
        }
    }

    return flags
}

export function resolveInstanceUserDataPath(baseUserData: string, profile: string): string {
    const safeProfile = validateProfileName(profile)
    if (!safeProfile) {
        return baseUserData
    }
    return path.join(baseUserData, 'profiles', safeProfile)
}

export function formatInstanceWindowTitle(profile: string, consoleId: string): string {
    const parts = ['XenonStream']
    if (profile) {
        parts.push(`[${profile}]`)
    }
    if (consoleId) {
        parts.push(`- ${consoleId}`)
    }
    return parts.join(' ')
}
