# Web Emulator

Local Vite emulator for the ESP32-hosted web UI.

The emulator serves the real files from `../firmware/web`, so edits to the firmware site hot-reload without flashing the ESP32. It also mocks the ESP API endpoints used by the site.

## Run

```sh
cd web-emulator
npm install
npm run dev
```

Open:

```text
http://localhost:5173/join/emulator
```

The mock API supports:

- `/api/state`
- `/api/register`
- `/api/setup`
- `/api/start`
- `/api/arm`
- `/api/scan`
- `/api/reset`

## Notes

- Web NFC is still browser/device dependent. The emulator is mainly for UI and game-flow testing.
- The first registered browser tab is admin, matching the firmware.
- Start a round with at least two joined players, or use a second browser profile/incognito tab to join another player.
