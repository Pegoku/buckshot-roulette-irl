# Firmware MVP Smoke Test

This is the first ESP32-S3 firmware test for the Buckshot Roulette IRL gun. It verifies the core hardware path before the real game logic exists:

- ILI9341 display over SPI
- trigger button input with debounce
- ESP32 open Wi-Fi access point
- tiny HTTP server
- per-boot random join URL
- Web NFC browser read/write smoke-test page for Android Chrome

The root web page is intentionally not the game page. The real test page is under a random `/join/<token>` URL printed over serial at boot. Later this token will be shown as a QR code on the gun display.

## Current Pinout

These defaults are defined at the top of `main/main.c`.

| Signal | ESP32-S3 GPIO | Notes |
| --- | ---: | --- |
| TFT MOSI | GPIO11 | ILI9341 SDI/MOSI |
| TFT SCLK | GPIO12 | ILI9341 SCK |
| TFT CS | GPIO10 | ILI9341 CS |
| TFT DC | GPIO9 | ILI9341 D/C or RS |
| TFT RST | GPIO8 | ILI9341 reset |
| TFT BL | GPIO7 | Backlight enable, active high |
| TFT MISO | not connected | Not needed for this test |
| Trigger button | GPIO4 | Button pulls GPIO4 to GND |
| 3V3 | 3.3 V | Display logic power |
| GND | GND | Common ground |

Change the `PIN_*` defines in `main/main.c` if your ESP32-S3 board has these pins wired differently.

## Assembly

1. Connect the display VCC to 3.3 V and GND to GND.
2. Connect the ILI9341 SPI pins using the table above.
3. Connect the trigger button between GPIO4 and GND.
4. Leave the trigger GPIO unconnected to VCC. The firmware enables the internal pull-up.
5. Connect the ESP32-S3 to USB for flashing and serial logs.

If the display stays white, check `CS`, `DC`, `RST`, and `BL` first. If the colors are rotated incorrectly, adjust the `0x36` MADCTL value in `lcd_init()`.

## Build Environment

ESP-IDF is expected at:

```sh
/opt/esp-idf
```

Load ESP-IDF into the shell:

```sh
source /opt/esp-idf/export.sh
```

## Commands

Run these from the `firmware/` directory.

Set the target:

```sh
idf.py set-target esp32s3
```

Build:

```sh
idf.py build
```

Flash and monitor:

```sh
idf.py -p /dev/ttyACM0 flash monitor
```

If your board appears as a different port, replace `/dev/ttyACM0`. Common alternatives are `/dev/ttyUSB0` and `/dev/ttyACM1`.

Exit the monitor with `Ctrl+]`.

## Expected Serial Output

On boot, the firmware prints lines like:

```text
AP SSID: Buckshot-A1B2C3
Join URL: http://192.168.4.1/join/01234567abcdef00
```

The token changes each boot.

## Expected Display Output

The display should show:

- a color bar strip at the top
- a large trigger press counter
- a green/red block that toggles on each trigger press
- small token indicator blocks at the bottom

This MVP does not render text or a real QR code yet. The serial monitor is the source of truth for the join URL in this first smoke test.

## Web Test

1. Connect an Android phone or laptop to the open Wi-Fi AP shown in serial logs.
2. Open the printed join URL, for example `http://192.168.4.1/join/<token>`.
3. Press the trigger and confirm the count updates on the web page.
4. On Android Chrome, press `Scan NFC tag`.
5. Tap a Mifare Ultralight NFC sticker to the phone.
6. Press `Write test item tag`.
7. Tap a writable NFC sticker to the phone and confirm the browser reports success.

Web NFC only works on supported Android Chrome devices, requires NFC hardware to be enabled, and must be started from a user button press.

## Current Limits

- No real QR code rendering yet.
- No filesystem-hosted web assets yet.
- NFC write support only writes a fixed `buckshot:item:test` smoke-test payload.
- No game rules yet.
- The display driver is a minimal ILI9341 SPI smoke-test driver. The production path should move to `esp_lcd` and optional LVGL after pinout and display behavior are confirmed.
