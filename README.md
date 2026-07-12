![zine](zine/zine.png)

# SoupShot Roulette
### (buckshot-roulette-irl)
Recreation of the buckshot roulette using a combination of electronics for Fallout in Shenzhen, this ~~lighthearded~~ very serious project makes sense within the competition's lore.

# Context:

The world is ending!!! Resources are scarce and there is too many people (🙁) for shelters.

What is the fairest way to reduce population numbers you may ask? By **gambling**, but, more fair... kind of??? mostly; I mean... technically...

Let's make killing each other a mostly lighthearted game (yay!) by referencing the hit videogame _Buckshot Roulette_.

![soupshot_roulette](images/soupshot_roulette.jpg)

## Hardware used:

- ESP32-S3 N16R8 acting as the gun connected to the button.
- 2.4" TFT Display (ILI9341, 240x320, spi, landscape).
- Mifrare ultralight NFC stickers (36 units for this project).
- Android smartphones with a chromium-based web browser to interact with NFC.
- Button (for the trigger).


## Game flow 

### Tips:

Simply log into the same wifi connection as the ESP32 and download the APK, this will be enough to get the game going.

When actually playing, scan the items to get their effects.

> ![props](images/props.jpg)
> most of the item props

The shotgun HUD shows animations and data relevant to the game itself and specific items as well, keep it in mind when playing.

### More concrete information (only read if you have doubts):

All players connect to the shotgun (esp32) through our app (available in releases). The first user will be the _admin_ and will be able to set settings like max number of bullets, ratios, etc... After all players have registered, and the settings are set, the _admin_ will start the game.

If it's the first round, the shotgun will randomly select a player to be the "shooter", if not, the shooter will be the one who's turn should be according to their previous round.
All players get the number of items indicated by each phone, and THEY MUST SCAN THEM to be able to use them (safety measure).
After all users have scanned all their items, the round will start.

The user who is the shooter will be prompted take action by scanning an item or shooting. If they scan an item, it will be deducted from their inventory, and will be used.
Possible actions:
- Adrenaline: select a player who you want to steal from, grab an item from their inventory and scan it. Then use it immediately. (You cannot steal another adrenaline)
- Soup: eject the current shell without shooting it and keep your turn. (you'll be shown the type of shell it was (blank of live))
- Burner Phone: reveal the type/position of a random future shell.
- FireSticks: heal 1 life.
- Hand Saw: next live shot deals 2 damage instead of 1. (cannot be stacked with other hand saws)
- Inverter: flip the current shell: live becomes blank, blank becomes live. (It won't)
- Jammer: choose a player; they skip their next turn.
- Magnifying Glass: reveal the current shell.
- Remote: reverse the turn order.
- Shot: You deal damage to a user if you shoot a live shell. If you shoot a blank shell, you don't make damage. If you shoot yourself with a blank round, you continue playing, any other option will make you pass turn.

When the player uses an item, if needed, the phone of the user who used the item will show an apropiate menu with a message, buttons, or watever, e.g. select target player, or watever.
If an action is something like a magnifying glass (which indicates something about the gun) it will be shown in the gun's display instead of the user's phone.


## Software

The software is divided into two parts: the gun and the web app.
All of the code will run in the esp32-S3, which will act as a web server and will serve the web app to the players. The gun will also handle the game logic, including the randomization of the shells and the management of player turns.

## Wiring:

> ![wiring except button](images/wiring-except-button.jpg)
> Button not pictured due to making the picture much harder to read easily.

These defaults are defined at the top of `firmware/main/main.c`.

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

Change the `PIN_*` defines in `firmware/main/main.c` if you wish to use a different pinout.

### How to properly assemble:

1. Connect the display VCC to 3.3 V and GND to GND.
2. Connect the ILI9341 SPI pins using the table above.
3. Connect the trigger button between GPIO4 and GND.
4. Leave the trigger GPIO unconnected to VCC.

* If the display stays white, check `CS`, `DC`, `RST`, and `BL` first. 
* If the display is rotated incorrectly, adjust the `0x36` MADCTL value in `lcd_init()`.

## How to build:

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

_Made with much love, inspired to create hate :)_

![Youtube Demo Video](https://youtu.be/sbjFrd9ozms?si=yU_X_v44XawgDQTZ)
