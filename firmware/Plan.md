# Firmware Plan

## Goal

Build the ESP32-S3 firmware for the Buckshot Roulette IRL prop. The board acts as the shotgun, Wi-Fi access point, web server, game-state authority, trigger controller, and TFT display driver. Android phones connect to the ESP32-hosted web app and use NFC stickers as physical item tokens.

## Hardware Scope

- ESP32-S3 N16R8 as the main controller.
- 2.4 inch ILI9341 TFT display, 240x320, SPI, landscape orientation.
- Trigger button connected to a GPIO input.
- Mifare Ultralight NFC stickers used as item tokens.
- Player phones connect over the ESP32 access point and browser UI.

## Main Firmware Modules

### 0. Framework and Runtime

- Use ESP-IDF rather than Arduino as the primary framework.
- Use FreeRTOS tasks directly so the gun loop, web server, display updates, button handling, and game-state engine can run without forcing everything through one Arduino-style loop.
- Pin time-critical or user-facing tasks deliberately:
  - game engine and trigger handling should stay responsive
  - web server and WebSocket handling can run separately
  - display rendering can be queued so slow drawing does not block game logic
- Keep shared game state behind a single owner task or a small message queue API to avoid race conditions between HTTP handlers, WebSocket events, and physical button input.

### 1. Board Support

- Define pin mappings for TFT SPI, display control pins, and trigger button.
- Initialize serial logging, GPIO, display, Wi-Fi AP, and web server.
- Add debouncing for the trigger button.
- Keep hardware configuration centralized so pin changes do not touch game logic.

### 2. Display UI

- Show startup and access-point connection information.
- Show an open Wi-Fi AP name and a QR code for the current game session URL.
- Generate a random-ish per-session URL path or join token on boot/game reset.
- Require the scanned QR URL or token before a client can enter the web game.
- Do not expose the playable web game at the root URL, even though the AP has no password.
- Show current round status, active shooter, shell information when revealed, and gun-facing item results.
- Show clear prompts when the shooter must fire or when players are waiting.
- Reserve display output for gun-public information, not private phone-only choices.
- Use ESP-IDF's `esp_lcd` driver layer for the ILI9341 SPI display, with LVGL on top if UI widgets/layouts become useful.
- Keep a direct bitmap drawing path for QR codes, shell art, and preconverted assets where LVGL would add unnecessary overhead.
- Store display assets in firmware storage as preconverted RGB565 or indexed binary blobs where useful.

### 3. Wi-Fi and Web Server

- Start the ESP32 as an open access point.
- Serve the web app from a dedicated filesystem/data partition so website asset changes do not require rebuilding the whole firmware image.
- Prefer LittleFS if available and stable in the chosen ESP-IDF setup; SPIFFS is acceptable if LittleFS integration becomes a blocker.
- Expose HTTP or WebSocket endpoints for:
  - player registration
  - admin setup
  - game start
  - item scan submission
  - player choices
  - current game state updates
- Prefer WebSockets or server-sent events for live turn updates if memory allows.

### 4. Player Registration

- First registered player becomes admin.
- Admin can configure game settings before start:
  - max bullets
  - live/blank ratios
  - player lives
  - item counts per round
  - enabled item set if needed
- Each player gets an id, display name, connection state, lives, inventory, and turn metadata.
- Block game start until the admin confirms all players are registered.

### 5. Item Token Handling

- Use the Chrome Web NFC API on Android phones for NFC sticker reading and writing.
- Treat NFC stickers as NDEF tags containing item token data.
- Maintain a mapping from token id to item type.
- Require each player to scan their assigned items before a round begins.
- Prevent duplicate scans, unknown token ids, and use of items not owned by the current player.
- Mark an item token as consumed when successfully used.
- Provide an admin-only NFC write mode for provisioning tags:
  - admin presses a button in the admin control to enter write mode
  - web UI asks which item type to write
  - phone writes the NDEF payload to the tag using Web NFC
  - ESP32 records or confirms the token id/item mapping
- Design NFC flows around Web NFC constraints:
  - reading and writing must be triggered by a user gesture
  - browser permission may be required
  - phone NFC hardware must be present and enabled
  - only NDEF-level tag data should be assumed

### 6. Game State Engine

- Maintain a single authoritative state machine on the ESP32:
  - lobby
  - setup
  - item distribution
  - round active
  - awaiting shooter action
  - awaiting item choice
  - resolving shot
  - round over
  - game over
- Randomize shells each round from admin settings.
- Track current shell index, current shooter, turn order, skipped players, player lives, and temporary effects.
- Select a random shooter for the first round.
- Continue future turns according to the previous round's order.

### 7. Turn and Shot Rules

- Shooter may either scan/use an item or fire.
- Live shell damages the target.
- Blank shell does no damage.
- Shooting self with a blank keeps the shooter's turn.
- Any other shot result advances the turn.
- Trigger button should only resolve a shot when firmware is in a valid shooting state.

### 8. Item Effects

Implement item behavior as isolated handlers that validate state before applying changes.

- Adrenaline: choose another player, scan one of their items, steal and immediately use it. Cannot steal another adrenaline.
- Beer: eject current shell, reveal whether it was live or blank, and keep turn.
- Burner Phone: reveal the type and position of a random future shell.
- Cigarette Pack: heal 1 life.
- Hand Saw: next live shot deals 2 damage. Effect cannot stack.
- Inverter: flip current shell between live and blank.
- Jammer: choose a player; that player skips their next turn.
- Magnifying Glass: reveal current shell on the gun display.
- Remote: reverse turn order.

## Web App Responsibilities

- Provide registration and admin setup screens.
- Show each player their inventory, lives, and available actions.
- Prompt the active shooter to shoot or use an item.
- Show target selection or item-specific choices when required.
- Use Web NFC to scan item tags and submit token payloads to the ESP32.
- Use Web NFC to write item payloads during admin NFC write mode.
- Gate access to game pages behind the per-session QR URL or token displayed on the gun.
- Avoid trusting client-side state for rule enforcement.

## Persistence

- Store token-to-item mappings and default settings in firmware assets or NVS.
- Store website files in a separate filesystem/data partition.
- Store active game state in RAM.
- Decide later whether interrupted games should be recoverable after reboot.

## Validation and Safety Checks

- Reject actions from non-active players.
- Reject item use outside the correct phase.
- Reject already consumed or unassigned NFC tokens.
- Reject invalid targets, dead players, and illegal self-targeting where applicable.
- Guard against double trigger events from button bounce.
- Keep all randomization on the ESP32 so clients cannot influence shell order.

## Suggested Milestones

1. Bring up an ESP-IDF project structure for ESP32-S3.
2. Add partition table with app, NVS, and web asset filesystem/data partitions.
3. Verify TFT display initialization and render a static join screen with a QR code.
4. Start open Wi-Fi AP and serve a minimal web page from the filesystem partition.
5. Add per-session QR token gating before the playable web game loads.
6. Add player registration and admin setup.
7. Implement core game state, shell randomization, turns, and trigger shooting.
8. Add WebSocket or polling state updates.
9. Add Web NFC scan support, token endpoints, and inventory assignment.
10. Add admin NFC write mode for provisioning item tags.
11. Implement item handlers one by one with validation.
12. Polish display states and phone UI prompts.
13. Run full playtests with multiple phones and physical NFC stickers.

## Open Decisions

- Exact ILI9341 panel component and pin assignments.
- Exact display asset pipeline and binary format.
- Exact filesystem choice: LittleFS preferred, SPIFFS fallback.
- Whether NFC item tags store only opaque token ids or signed item payloads.
- Whether the admin enters NFC write mode from the physical button, web UI, or both.
- How item/token mappings are produced for the 40 NFC stickers.
