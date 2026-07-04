# Firmware

This folder contains the ESP-IDF firmware for the Buckshot Roulette IRL gun. The current implementation is a playable firmware baseline, not just the earlier hardware smoke test.

It includes:

- ILI9341 SPI display output
- physical trigger button
- open ESP32-S3 Wi-Fi access point
- QR/token-gated web session URL
- real QR rendering on the TFT display
- SPIFFS-hosted web app assets
- player registration with first-player admin
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
AP SSID: Buckshot-A1B2C3
Join URL: http://192.168.4.1/join/01234567abcdef00
```

The AP is open. The playable page is only served through the per-boot `/join/<token>` URL.

## Display Output

In lobby, the display shows a real QR code for the per-boot join URL.

During the game, the display shows a compact numeric status view:

- top color bar: lobby, active game, or game over
- player count
- current player number
- current shell index
- total shells
- player life bars
- remaining shell blocks
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
| Beer | Ejects current shell and reveals whether it was live or blank |
| Burner Phone | Reveals a random future shell |
| Cigarette Pack | Heals 1 life up to max lives |
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

## Current Limits

- The display driver is still the minimal validated ILI9341 SPI driver, not the final `esp_lcd`/LVGL stack.
- Game state is RAM-only and resets on reboot.
- The API uses simple URL-encoded POST bodies instead of JSON parsing.
- Adrenaline is simplified: it steals the first eligible item instead of prompting for a specific stolen physical item.
