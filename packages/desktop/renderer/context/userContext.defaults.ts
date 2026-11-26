export const defaultSettings = {
    xhome_bitrate: 0,
    xcloud_bitrate: 0,
    xcloud_show_non_entitled: true,
    video_profiles: [],
    video_codec: 'h264',
    stream_resolution: 0,
    discord_rpc_enabled: false,
    discord_rpc_client_id: '',
    preferred_game_language: 'en-US',
    controller_vibration: true,
    video_size: 'default',
    force_region_ip: '',
    input_touch: false,
    touch_layout_preset: 'standard',
    input_mousekeyboard: false,
    input_mouse_sensitivity: 50,
    input_mousekeyboard_config: {
        ArrowLeft: 'DPadLeft',
        ArrowUp: 'DPadUp',
        ArrowRight: 'DPadRight',
        ArrowDown: 'DPadDown',

        Enter: 'A',
        a: 'A',

        Backspace: 'B',
        b: 'B',

        x: 'X',
        y: 'Y',

        '[': 'LeftShoulder',
        ']': 'RightShoulder',

        '-': 'LeftTrigger',
        '=': 'RightTrigger',

        v: 'View',
        m: 'Menu',
        n: 'Nexus',
    },
    input_newgamepad: false,
    input_local_coop: false,
    input_gamepad_remap: {},
    app_lowresolution: false,
    clarity_boost_strength: 0,
    stream_fps_overlay: false,
    stream_fps_overlay_pos: { x: 16, y: 78 },

    video_enabled: true,
    audio_enabled: true,
    // Device ids from navigator.mediaDevices. '' means system default.
    audio_input_device: '',
    audio_output_device: '',

    // WebUI
    webui_autostart: false,
    webui_port: 9003,

    // Remote Play public port forwarding (global default + per-console overrides)
    remote_port: 9002,
    remote_port_consoles: {},

    // Selected language for i18n. Empty means: follow the system language
    language: '',
}
