# Changelog

## v1.0.0 (2026-11-26) — Initial Standalone Cross-Platform Release

First standalone release of **XenonStream** (`oscarlosu-lab/xenonstream`) for **Windows, Linux (AppImage / DEB / Flatpak), Steam Deck, and macOS (Universal DMG)**, built on top of the MIT-licensed [`unknownskl/greenlight`](https://github.com/unknownskl/greenlight) and [`unknownskl/xbox-xcloud-player`](https://github.com/unknownskl/xbox-xcloud-player) foundations (see [NOTICE](NOTICE)).

### Cross-Platform & Streaming Quality
- **720p / 1080p / 1440p** stream resolution selector and unlimited bitrate (`0` = no SDP cap for xCloud & Remote Play).
- **H.264 / HEVC (`H.265`) / AV1** video codec selection (`applyVideoCodecPreferences`) with H.264 High/Main/Baseline fallback and preserved `video/rtx`, `video/red`, and `video/ulpfec`.
- **LAN Remote Play Optimization**: private-IPv4 `host`-first UDP ICE sorting with TCP fallback, `playoutDelayHint = 0`, `jitterBufferTarget = 0`, `track.contentHint = 'motion'`, Windows `PRIORITY_ABOVE_NORMAL` during stream, and `powerSaveBlocker`.
- **Configurable Remote Play Public Port**: global `remote_port` (default `9002`) and per-console `remote_port_consoles` overrides in *Settings → Streaming*.
- **Linux VA-API & Wayland**: `VaapiVideoDecoder`, `VaapiVideoDecodeLinuxGL`, `UseOzonePlatform`, `ozone-platform-hint=auto`, and Flatpak `io.github.oscarlosu_lab.xenonstream` (`--socket=wayland`).
- **macOS Microphone Entitlements**: `resources/entitlements.mac.plist`, `NSMicrophoneUsageDescription`, and IPC handlers (`getMicrophoneAccess`, `askMicrophoneAccess`, `openMicrophoneSettings`).
- **Clarity Boost**: real-time GPU SVG 3×3 unsharp-mask sharpening (`0.0–1.0`).

### HUD, UI, Diagnostics, Input & Auth
- **Obsidian Neon Emerald-Cyan UI**: custom app icons (`icon.ico`, `icon.icns`, `icon.png`), frosted command header with pill navigation, branded QR login hero, gradient controls, and elevated game tiles.
- **Instant-Collapse Stream Bar & Draggable 36px Green FPS HUD**: compact `▲`/`▼` chevron toggle tab (`#component_streamcomponent_gamebar_toggle`) to hide or restore the stream toolbar immediately, plus real-time WebRTC `framesPerSecond` readout (`z-index: 100`, persisted position).
- **Stream Toolbar & Diagnostics**: on-demand `StreamDebug`, `stream-path.log` with 5 MB rotation, PNG screenshots (`Pictures\XenonStream`), hide/show video toggle, and `chrome://gpu` + `chrome://webrtc-internals` windows.
- **Security & Multi-Account**: `safeStorage` / DPAPI encrypted token storage (`enc:v1:`), automatic 401 refresh, prefilled `?otc=` browser login, scannable Microsoft QR login, and isolated `--profile=<name>` instances.
- **Input, Audio & Localization**: `CompactGamepadDriver`, 4-player local co-op, Touch Overlay presets, custom button remapping, M&K pointer lock (`Esc` = Xbox Home), live audio output (`setSinkId`) & mic selector, opt-in Discord Rich Presence, **13 languages**, **Electron 45.3.4**, and **90 automated tests** (83 Jest sanitizers/unit + 7 xCloud protocol tests).
