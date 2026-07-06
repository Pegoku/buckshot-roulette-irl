# SoupShot Roulette Firmware

This folder contains the ESP-IDF firmware for the SoupShot Roulette gun. The current implementation is a playable firmware baseline, not just the earlier hardware smoke test.

It includes:

- ILI9341 SPI display output
- physical trigger button
- open ESP32-S3 Wi-Fi access point
- HTTP QR/token-gated web session URL, with HTTPS kept for Web NFC
- real QR rendering on the TFT display
- event-driven display redraws to avoid constant full-screen flashing
- SPIFFS-hosted web app assets
- player registration with first-player admin
- automatic admin transfer when the current admin disconnects
- player timeout cleanup from app heartbeat
- admin game setup
- shell randomization and turn handling
- trigger-resolved armed shots
- Web NFC item scanning
- Web NFC admin tag writing behind NFC write mode
- persisted NFC tag mapping in NVS
- basic item effects

## Pinout

These defaults are defined at the top of `main/main.c`.

| Signal | ESP32-S3 GPIO | Notes |
| --- | ---: | --- |
| TFT MOSI | GPIO11 | ILI9341 SDI/MOSI |
| TFT SCLK | GPIO12 | ILI9341 SCK |
| TFT CS | GPIO10 | ILI9341 CS |
| TFT DC | GPIO9 | ILI9341 D/C or RS |
| TFT RST | GPIO8 | ILI9341 reset |
| TFT BL | GPIO7 | Backlight enable, active high |
| TFT MISO | not connected | Not needed |
| Trigger button | GPIO4 | Button pulls GPIO4 to GND |
| 3V3 | 3.3 V | Display logic power |
| GND | GND | Common ground |

Change the `PIN_*` defines in `main/main.c` if your ESP32-S3 board is wired differently.

## Assembly

1. Connect the display VCC to 3.3 V and GND to GND.
2. Connect the ILI9341 SPI pins using the table above.
3. Connect the trigger button between GPIO4 and GND.
4. Leave the trigger GPIO unconnected to VCC. The firmware enables the internal pull-up.
5. Connect the ESP32-S3 to USB for flashing and serial logs.

If the display stays white, check `CS`, `DC`, `RST`, and `BL` first. If the display is rotated incorrectly, adjust the `0x36` MADCTL value in `lcd_init()`.

## Build Environment

ESP-IDF is expected at:

```sh
/opt/esp-idf
```

Load ESP-IDF into the shell:

```sh
source /opt/esp-idf/export.sh
export IDF_COMPONENT_CACHE_PATH=/tmp/idf-component-cache
```

## Commands

Run these from the `firmware/` directory.

Set the target once:

```sh
idf.py set-target esp32s3
```

Build:

```sh
IDF_COMPONENT_CACHE_PATH=/tmp/idf-component-cache idf.py build
```

Flash app, partition table, and web assets:

```sh
IDF_COMPONENT_CACHE_PATH=/tmp/idf-component-cache idf.py -p /dev/ttyACM0 flash monitor
```

If your board appears as a different port, replace `/dev/ttyACM0`. Common alternatives are `/dev/ttyUSB0` and `/dev/ttyACM1`.

Exit the monitor with `Ctrl+]`.

## Serial Output

On boot, the firmware prints:

```text
AP SSID: SoupShot-A1B2C3
Join URL: http://192.168.4.1/join/01234567abcdef00
Secure NFC URL: https://192.168.4.1/join/01234567abcdef00
```

The AP is open. The playable page is served through the per-boot `/join/<token>` URL on HTTP by default. HTTPS serves the same join path for Web NFC scanning/writing, because browser NFC APIs require a secure context.

## HTTPS Certificate

The firmware embeds a self-signed certificate generated for `192.168.4.1` with a subject alternative name:

```text
IP:192.168.4.1
DNS:buckshot.local
```

Files:

- `certs/server.crt`
- `certs/server.key`

To regenerate them:

```sh
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout certs/server.key \
  -out certs/server.crt \
  -subj "/CN=192.168.4.1/O=SoupShot Roulette" \
  -addext "subjectAltName=IP:192.168.4.1,DNS:buckshot.local"
```

Certificate setup flow for NFC:

1. Connect the phone to the SoupShot AP.
2. Open `http://192.168.4.1/`.
3. Download `buckshot-irl.crt` from the setup page, or open `http://192.168.4.1/cert` directly.
4. Install it as a CA certificate and trust it for VPN and apps.
5. Use the normal HTTP join URL for gameplay. When scanning/writing NFC, the app opens the HTTPS copy of the same join URL.

Android Chrome will show a certificate warning until the certificate is trusted by the phone. If Chrome still treats the page as not secure after trusting it, reconnect to the AP and reopen the join URL.

## Display Output

In lobby, the display shows a real QR code for the per-boot HTTP join URL.
The lower-left number is the count of registered players. The lower-right yellow number is the current admin player number when an admin exists.

During the game, the display shows a compact numeric status view:

- top color bar: lobby, active game, or game over
- player count
- current player number
- current shell index
- total shells
- player life bars
- remaining shell blocks

The current display code does not use LVGL. It uses the small direct ILI9341 SPI driver in `main/main.c`. Redraws are event-driven through `mark_display_dirty()`, so the screen should update only after game state changes instead of refreshing continuously.
- remaining shell blocks

## Game Test Flow

1. Flash and monitor the board.
2. Connect phones to the open AP shown in serial.
3. Open the printed join URL.
4. Register at least two players.
5. The first player is admin.
6. Admin sets lives, shell count, live shell count, and items per player.
7. Admin presses `Start round`.
8. The active player selects a target and presses `Arm self shot` or `Arm target shot`.
9. Pull the physical trigger to resolve the armed shot.

## Player Timeout and Admin Transfer

The phone app polls `/api/state?pid=<id>` about every 1.5 seconds. That poll is the player heartbeat.

Timeout behavior:

- after 20 seconds without heartbeat, the firmware starts timeout checks
- it then waits through 3 missed checks spaced 2 seconds apart
- after the third missed check, the player is removed

Admin behavior:

- admin is always the earliest joined active player
- if players A, B, and C join, A is admin
- if A times out or leaves, B becomes admin
- the web UI updates admin controls automatically on the next state poll

Shooting rules implemented:

- live shell damages the target
- saw makes the next live shot deal 2 damage
- blank shot against self keeps the turn
- blank shot against another player advances the turn
- dead players are skipped
- last living player wins
- empty shotgun reloads automatically

## Web NFC

Android Chrome can scan and write item tags from the web app.

Admin tag writing:

1. Join as admin.
2. Enable `NFC write mode` in the admin panel, or press the physical trigger while the gun is still in lobby.
3. Use the `NFC writer` buttons.
4. Tap a writable NFC sticker to the phone.
5. The tag receives a payload like `buckshot:item:beer:1234abcd`.

The item tag mapping is saved in NVS. The owner/consumed state is per game and resets on reboot or game reset, so the same physical stickers can be reused.

Player scanning:

1. Press `Scan item tag`.
2. Tap a written NFC sticker.
3. The matching item is claimed by that player and added to inventory.

Duplicate scans, consumed tags, and tags owned by another player are rejected.

Web NFC only works on supported Android Chrome devices, requires NFC hardware to be enabled, and must be started from a user button press.

## Items Implemented

| Item | Current behavior |
| --- | --- |
| Adrenaline | Steals the first non-adrenaline item found from the selected target |
| Soup | Ejects current shell and reveals whether it was live or blank |
| Burner Phone | Reveals a random future shell |
| FireSticks | Heals 1 life up to max lives |
| Hand Saw | Next live shot deals 2 damage |
| Inverter | Flips the current shell |
| Jammer | Selected target skips their next turn |
| Magnifying Glass | Reveals current shell |
| Remote | Reverses turn order |

## Web Asset Partition

The web app lives in `firmware/web/` and is packed into the `web` SPIFFS partition by:

```cmake
spiffs_create_partition_image(web web FLASH_IN_PROJECT)
```

Because `FLASH_IN_PROJECT` is enabled, `idf.py flash` flashes the web partition too.

## Web Emulator

Use the local Vite emulator to test the ESP-hosted website without flashing the ESP32:

```sh
cd web-emulator
npm install
npm run dev
```

Open:

```text
http://localhost:5173/join/emulator
```

The emulator serves the real files from `firmware/web/` and mocks the `/api/*` endpoints used by the app, so CSS/HTML/JS edits hot-reload immediately. The first joined tab is admin. Open another browser profile or incognito tab to simulate a second player.

## Current Limits

- The display driver is still the minimal validated ILI9341 SPI driver, not the final `esp_lcd`/LVGL stack.
- Game state is RAM-only and resets on reboot.
- The API uses simple URL-encoded POST bodies instead of JSON parsing.
- Adrenaline is simplified: it steals the first eligible item instead of prompting for a specific stolen physical item.
