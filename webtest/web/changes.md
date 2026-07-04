# Web UI Changes

## Removed from the normal UI

- Removed the username/join form from the visible flow.
- Removed the admin setup controls from the visible flow.
- Removed the chamber/readout panel, including shell count, known live/blank bullets, and armed target details.
- Removed always-visible item, NFC, and choose-target sections.

## Current player HUD

- The page now behaves like an in-game terminal/HUD instead of a control panel.
- The main screen only shows turn state, life meter, session/phase text, and messages.
- Life is shown as a green pixel/CRT meter.
- The client auto-registers an anonymous player when needed.
- If the backend is unavailable, the client falls back to a demo state so the UI can still be previewed.

## Shot target flow

- The main action button is now `Shot`.
- Pressing `Shot` opens a modal target selector.
- Target layout is directional:
  - `Opp1` at the top
  - `Opp2` on the right
  - `Opp3` on the left
  - `You` at the bottom
- Missing, dead, or unavailable target slots are disabled and show `X`.
- Selecting an available target closes the popup and arms that shot target.

## Debug/NFC flow

- `Debug` opens a hidden debug panel.
- All item buttons are always available in debug, regardless of inventory count.
- Debug item buttons emulate NFC reads through `/api/scan`.
- The real NFC scanner button is still available inside the debug panel.

## Landscape behavior

- The UI is landscape-first.
- Portrait phones show a rotate-device blocker.
- Added `manifest.webmanifest` with fullscreen landscape orientation.
- JavaScript attempts to lock Android/browser orientation after first user input when allowed.

## Visual style

- Replaced the previous table/control-panel styling with an old CRT terminal look.
- Background is very dark gray, not pure black.
- UI uses hacker-green terminal text and borders.
- Added a self-hosted pixel font: `fonts/press-start-2p.ttf`.
- CSS loads the font locally through `@font-face`.
- Added CRT-style effects inspired by shader/CSS references:
  - scanlines
  - RGB/phosphor mask
  - screen-door overlay
  - text shadow color separation
  - flicker
  - wobble/jitter
  - curved glass/vignette
- `prefers-reduced-motion: reduce` disables the motion effects.
