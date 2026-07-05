unless mentioned, all of the indications are for the TFT LCD.

# Requirements:
- LVGL **must be used**, the aesthetic design should be similar to the web-app, CRT like, flicker, green-ish monitor vibes are all important.

- Use an 8-bit styled font.

## Boot mode:
- When booted up, the TFT display shows the QR Code on screen, also displaying the amount of players (which is a max of 4) and the SSID of the AP (similar to the current screen).

## Game mode
- Once the game is started, the display must enter "game mode".

- It says something like "get ready", initiates a 3,2,1 countdown. On each second the phones will vibrate in bursts increasing their strenght until the game has started, when a longer vibration will play and a sound. This all will happen on the phones connected.

- When starting a phase or round, the current contents must be greyed out and a ROUND n (n being round number) must me displayed with a slight shake on top for a second.

- Bullets appear one by one with slight separation, before getting really close together with a squash/and stretch animation and heading to the bottom right making a line going to the left.

- When shooting the bullet must be shown in the middle (horizontally) of the screen while graying out the background, shacking and being rotated, going to the left as if it were being loaded. Then it must play the pertinent smoke animation depending on weather it is a live or a blank round. When this happens, phones, synced based on the ESP32's uptime will vibrate and play a shot sound. (on the phones)

- When the game ends, display _User_ won the gamble.