# XenonStream (`oscarlosu-lab/xenonstream`)

> **[Leer en español (README_ES.md)](README_ES.md)** · **[Official Website (Xbox Gaming UI)](https://oscarlosu-lab.github.io/xenonstream/)**

[![Release](https://img.shields.io/github/v/release/oscarlosu-lab/xenonstream?style=flat-square&color=107c10&label=Release)](https://github.com/oscarlosu-lab/xenonstream/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/oscarlosu-lab/xenonstream/total?style=flat-square&color=4ade80&label=Downloads)](https://github.com/oscarlosu-lab/xenonstream/releases)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20Steam%20Deck%20%7C%20macOS-0078D6?style=flat-square&logo=xbox)](https://github.com/oscarlosu-lab/xenonstream/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-45.3.4-47848F?style=flat-square&logo=electron)](packages/desktop/package.json)
[![License](https://img.shields.io/github/license/oscarlosu-lab/xenonstream?style=flat-square)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Project-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/oscarlosu)

**XenonStream** is an open-source, cross-platform **Xbox Cloud Gaming (xCloud)** and **Xbox Remote Play** desktop client for **Windows 10/11**, **Linux (X11 / Wayland / Flatpak / AppImage / DEB)**, **Steam Deck**, **macOS (Universal DMG)**, and Windows PC gaming handhelds (**ASUS ROG Ally**, **Lenovo Legion Go**, **MSI Claw**), built with TypeScript, Electron 45, and [`xbox-xcloud-player`](https://github.com/unknownskl/xbox-xcloud-player).

_DISCLAIMER: XenonStream is not affiliated with Microsoft, Xbox, or Moonlight. All rights and trademarks belong to their respective owners._

---

## Key Features (`v1.0.0`)

| Area | Capabilities |
|---|---|
| **LAN Quality & Codecs** | Private-IPv4 `host`-first UDP ICE sorting + TCP fallback, low-latency WebRTC receivers (`playoutDelayHint=0`, `contentHint='motion'`), **720p / 1080p / 1440p** selector, unlimited bitrate (`0` = no SDP cap), **H.264 / HEVC (`H.265`) / AV1** codec selector with H.264 High fallback + `video/rtx`/`red`/`ulpfec` preserved, **Clarity Boost** GPU sharpening, configurable **Remote Play public port** (`remote_port` & per-console overrides), and Windows `ABOVE_NORMAL` stream priority. |
| **Linux, Steam Deck & macOS** | Linux **VA-API** hardware video decoding (`VaapiVideoDecoder`, `VaapiVideoDecodeLinuxGL`) + **Wayland** (`UseOzonePlatform`, `ozone-platform-hint=auto`) in AppImage, DEB, and Flatpak (`io.github.oscarlosu_lab.xenonstream`); **macOS Universal DMG** with microphone entitlements (`entitlements.mac.plist`) and system permission prompts. |
| **Auth & Security** | **DPAPI / Keychain (`safeStorage`)** token encryption (`enc:v1:`), automatic **401 token refresh** for streams and *My Consoles*, **Multi-Account** switcher, prefilled `?otc=` browser login, scannable **Microsoft QR login**, isolated **Multi-Instance** profiles (`--profile=<name>`), SHA-pinned CI workflows, and Express 5 Web UI support. |
| **Input & Co-op** | `CompactGamepadDriver` (standard pads prioritized first, hotplug, vibration, clean loop stop), opt-in **Local Co-op** (up to 4 pads), opt-in **Touch Overlay** (*Standard / Racing / Minimal*), **Custom Button Remapping**, M&K mutual exclusivity + sensitivity slider + `Esc` = Xbox Home / `Shift+Esc` = `Esc`, gamepad UI navigation, and toolbar ARIA/keyboard focus. |
| **Streaming UX & Diagnostics** | **Obsidian Neon Emerald-Cyan UI**, **instant-collapse top bar chevron (`▲`/`▼`)**, **draggable 36px green real-time FPS HUD** (`<fps>FPS` via WebRTC `framesPerSecond`, `z-index: 100`, persisted position), instant **PNG Screenshots** (`p` / camera button), **In-Game Text Entry & Dialogs** (`ShowVirtualKeyboard` / `ShowMessageDialog`), hide/show video toggle, on-demand `StreamDebug`, `stream-path.log` with 5 MB rotation, and **`chrome://gpu`** + **`chrome://webrtc-internals`** diagnostic windows. |
| **Audio, Library & i18n** | Live **Audio Output (`setSinkId`) & Microphone** selector, Console **Power On/Off/Refresh** buttons, resilient xCloud library with **Game Pass** filter + 250 ms debounce, opt-in **Discord Rich Presence**, **13 languages** (with system language auto-detect + translated native dialogs), and **Electron `45.3.4`**. |

See [CHANGELOG.md](CHANGELOG.md), [NOTICE](NOTICE), and [the project website](https://oscarlosu-lab.github.io/xenonstream/) for full details.

---

## Install

Download the latest release from [GitHub Releases](https://github.com/oscarlosu-lab/xenonstream/releases/latest):

- **Windows**: `XenonStream Setup 1.0.0.exe` (NSIS installer) or `XenonStream-1.0.0-win.zip` (portable).
- **Linux / Steam Deck**: `.AppImage`, `.deb`, or `.flatpak` (`io.github.oscarlosu_lab.xenonstream`).
- **macOS**: Universal `.dmg` (Apple Silicon + Intel).
- **Compile from source**: see [Local Development](#local-development).

---

## Keyboard & Stream Shortcuts

| Key / Shortcut | Action |
|---|---|
| `~` | Toggle on-demand Debug stats panel |
| `p` | Capture PNG screenshot to `Pictures\XenonStream` |
| `Esc` (M&K pointer lock) | Press Xbox Home (Nexus) button |
| `Shift + Esc` (M&K pointer lock) | Send `Esc` key to the game |
| `N`, `V`, `M`, `A/B/X/Y`, `[` `]`, `-` `=` | Default Keyboard-to-Gamepad bindings (configurable in *Settings → Input*) |

---

## Optional Launch Arguments

| Argument | Description |
|---|---|
| `--fullscreen` | Starts XenonStream in fullscreen mode |
| `--connect=<value>` | Auto-starts stream after auth (`F000000000000000` for console, `xcloud_<title>` for xCloud) |
| `--profile=<name>` | Launches an isolated concurrent instance (`userData` + encrypted `tokenstore` under `profiles/<name>`) |
| `--console=<id>` | Sets the target console ID for the instance window title and IPC |

---

## Local Development

### Requirements
- Node.js 24 (`node -v`)
- Yarn 1.22 (`yarn -v`)

### Steps
```bash
git clone https://github.com/oscarlosu-lab/xenonstream.git
cd xenonstream
yarn
yarn desktop dev
```

Run checks & production build:
```bash
yarn desktop lint:strict
yarn desktop typecheck
yarn desktop test:xcloud
yarn desktop test:sanitizers
yarn desktop build
```

---

## License & Attribution

Licensed under the [MIT License](LICENSE). Built with gratitude upon [`unknownskl/greenlight`](https://github.com/unknownskl/greenlight) and [`unknownskl/xbox-xcloud-player`](https://github.com/unknownskl/xbox-xcloud-player) — see [NOTICE](NOTICE).
