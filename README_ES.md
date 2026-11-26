# XenonStream (`oscarlosu-lab/xenonstream`)

> **[Read in English (README.md)](README.md)** · **[Web Oficial (Diseño Xbox Gaming)](https://oscarlosu-lab.github.io/xenonstream/)**

[![Release](https://img.shields.io/github/v/release/oscarlosu-lab/xenonstream?style=flat-square&color=107c10&label=Release)](https://github.com/oscarlosu-lab/xenonstream/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/oscarlosu-lab/xenonstream/total?style=flat-square&color=4ade80&label=Descargas)](https://github.com/oscarlosu-lab/xenonstream/releases)
[![Platforms](https://img.shields.io/badge/Plataformas-Windows%20%7C%20Linux%20%7C%20Steam%20Deck%20%7C%20macOS-0078D6?style=flat-square&logo=xbox)](https://github.com/oscarlosu-lab/xenonstream/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-45.3.4-47848F?style=flat-square&logo=electron)](packages/desktop/package.json)
[![License](https://img.shields.io/github/license/oscarlosu-lab/xenonstream?style=flat-square)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Project-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/oscarlosu)

**XenonStream** es un cliente open-source multiplataforma para **Xbox Cloud Gaming (xCloud)** y **Xbox Remote Play** en **Windows 10/11**, **Linux (X11 / Wayland / Flatpak / AppImage / DEB)**, **Steam Deck**, **macOS (DMG Universal)** y consolas portátiles PC (**ASUS ROG Ally**, **Lenovo Legion Go**, **MSI Claw**), construido con TypeScript, Electron 45 y [`xbox-xcloud-player`](https://github.com/unknownskl/xbox-xcloud-player).

_AVISO: XenonStream no está afiliado con Microsoft, Xbox ni Moonlight. Todas las marcas pertenecen a sus respectivos propietarios._

---

## Características principales (`v1.0.0`)

| Área | Capacidades |
|---|---|
| **Calidad LAN y Códecs** | Ruta ICE UDP `host`-first en IPv4 privada + respaldo TCP, receptores WebRTC de baja latencia (`playoutDelayHint=0`, `contentHint='motion'`), selector **720p / 1080p / 1440p**, bitrate sin tope (`0` = sin límite SDP), selector **H.264 / HEVC (`H.265`) / AV1** con respaldo H.264 High y `video/rtx`/`red`/`ulpfec` intactos, **Clarity Boost** (nitidez GPU), **puerto público configurable en Remote Play** (`remote_port` y por consola) y prioridad `ABOVE_NORMAL` en Windows. |
| **Linux, Steam Deck y macOS** | Decodificación por hardware **VA-API** en Linux (`VaapiVideoDecoder`, `VaapiVideoDecodeLinuxGL`) + **Wayland** (`UseOzonePlatform`, `ozone-platform-hint=auto`) en AppImage, DEB y Flatpak (`io.github.oscarlosu_lab.xenonstream`); **DMG Universal en macOS** con permisos de micrófono (`entitlements.mac.plist`). |
| **Auth y Seguridad** | Cifrado de tokens con **DPAPI / Keychain (`safeStorage`, `enc:v1:`)**, auto-refresh **401** automático en streams y *Mis Consolas*, **Multi-Cuenta**, login en navegador con `?otc=` prellenado, **código QR Microsoft**, **Multi-Instancia** aislada (`--profile=<nombre>`), Actions fijadas por SHA y Express 5 Web UI. |
| **Entrada y Co-op** | `CompactGamepadDriver` (mandos estándar primero, hotplug, vibración, parada limpia del bucle 60 Hz), **Cooperativo Local** opt-in (hasta 4 mandos), **Touch Overlay** opt-in (*Estándar / Carreras / Mínimo*), **Remapeo personalizado de botones**, exclusividad Ratón/Teclado + sensibilidad + `Esc` = Home / `Shift+Esc` = `Esc`, navegación por mando y foco/ARIA en barra. |
| **UX de Stream y Diagnóstico** | **Interfaz Obsidian Neon Emerald-Cyan**, **flechita (`▲`/`▼`) para ocultar/mostrar la barra superior al instante**, **HUD FPS real arrastrable en verde 36px** (`<fps>FPS` por WebRTC `framesPerSecond`, `z-index: 100`, posición guardada), **Capturas PNG** instantáneas (`p` o botón cámara), **Chat / teclado virtual in-game** (`ShowVirtualKeyboard` / `ShowMessageDialog`), botón ocultar/mostrar vídeo, `StreamDebug` bajo demanda, `stream-path.log` con rotación 5 MB y ventanas **`chrome://gpu`** + **`chrome://webrtc-internals`**. |
| **Audio, Biblioteca e Idiomas** | Selector en vivo de **salida de audio (`setSinkId`) y micrófono**, botones **Encender / Apagar / Actualizar** consolas, biblioteca xCloud resiliente con filtro **Game Pass** y búsqueda con debounce, **Discord Rich Presence** opt-in, **13 idiomas** (autodetección del sistema + diálogos nativos traducidos) y **Electron `45.3.4`**. |

Consulta [CHANGELOG.md](CHANGELOG.md), [NOTICE](NOTICE) y [la web del proyecto](https://oscarlosu-lab.github.io/xenonstream/) para el detalle completo.

---

## Instalación

Descarga la última versión desde [GitHub Releases](https://github.com/oscarlosu-lab/xenonstream/releases/latest):

- **Windows**: `XenonStream Setup 1.0.0.exe` (instalador NSIS) o `XenonStream-1.0.0-win.zip` (portable).
- **Linux / Steam Deck**: `.AppImage`, `.deb` o `.flatpak` (`io.github.oscarlosu_lab.xenonstream`).
- **macOS**: `.dmg` Universal (Apple Silicon + Intel).
- **Compilar desde el código fuente**: consulta [Desarrollo local](#desarrollo-local).

---

## Atajos durante el stream

| Tecla / Atajo | Acción |
|---|---|
| `~` | Mostrar / ocultar panel de estadísticas de depuración |
| `p` | Guardar captura PNG en `Imágenes\XenonStream` |
| `Esc` (en pointer lock M&K) | Pulsar botón Xbox Home (Nexus) |
| `Shift + Esc` (en pointer lock M&K) | Enviar tecla `Esc` al juego |
| `N`, `V`, `M`, `A/B/X/Y`, `[` `]`, `-` `=` | Controles por defecto de Teclado a Mando (configurables en *Ajustes → Entrada*) |

---

## Argumentos opcionales de arranque

| Argumento | Descripción |
|---|---|
| `--fullscreen` | Inicia XenonStream en pantalla completa |
| `--connect=<valor>` | Inicia el stream tras autenticar (`F000000000000000` para consola, `xcloud_<título>` para xCloud) |
| `--profile=<nombre>` | Lanza una instancia simultánea aislada (`userData` + `tokenstore` cifrado en `profiles/<nombre>`) |
| `--console=<id>` | Asigna el ID de consola objetivo al título de la ventana y al IPC |

---

## Desarrollo local

### Requisitos
- Node.js 24 (`node -v`)
- Yarn 1.22 (`yarn -v`)

### Pasos
```bash
git clone https://github.com/oscarlosu-lab/xenonstream.git
cd xenonstream
yarn
yarn desktop dev
```

Verificación y build de producción:
```bash
yarn desktop lint:strict
yarn desktop typecheck
yarn desktop test:xcloud
yarn desktop test:sanitizers
yarn desktop build
```

---

## Licencia y atribución

Licenciado bajo la [Licencia MIT](LICENSE). Basado con agradecimiento en [`unknownskl/greenlight`](https://github.com/unknownskl/greenlight) y [`unknownskl/xbox-xcloud-player`](https://github.com/unknownskl/xbox-xcloud-player) — ver [NOTICE](NOTICE).
