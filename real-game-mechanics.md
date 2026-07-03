# Buckshot Roulette Multiplayer — Regular Game Rules 

This guide explains how a regular **Buckshot Roulette Multiplayer** game works: turn flow, shotgun mechanics, shells, items, death conditions, and win conditions.

Reference: Buckshot Roulette Wiki / Fandom. Multiplayer was released on **October 31, 2024**, supports **2–4 players**, can include bots, and replaces Handcuffs with the multiplayer-only **Jammer** item. ([Buckshot Roulette][1])

---

## 1. Goal of the game

The goal is to be the **last player alive**.

Each player has a number of **charges**, which act like health. When a player is shot with a **live shell**, they lose charges. When a player reaches **0 charges**, they die. In multiplayer, a dead player stays dead for the rest of the game. ([Buckshot Roulette][1])

---

## 2. Players

A regular multiplayer game needs at least **2 players** and can have up to **4 players**. The host can also add bots. Players sit around the table and take turns using the same shotgun. ([Buckshot Roulette][1])

The turn order normally moves around the table in a cycle. In games with more than 2 players, the **Remote** item can reverse the turn direction. ([Buckshot Roulette][2])

---

## 3. The shotgun

The game uses a shared **12-gauge pump-action shotgun**. In multiplayer, up to four players use the shotgun to shoot themselves or other players. ([Buckshot Roulette][3])

At the start of a load, the shotgun is filled with a random mix of shells. The game shows how many shells are **live** and how many are **blank**, but the order is hidden. The shotgun can hold up to **8 shells**, and each load contains **2–8 shells**. ([Buckshot Roulette][3])

Example:

```md
Loaded shells:
Live: 3
Blank: 2

Total shells in shotgun: 5
Order: hidden
```

Players should remember how many live and blank shells remain as shots are fired or shells are ejected.

---

## 4. Shell types

There are two shell types:

### Live shell

A **live shell** deals damage to the target.

Normally, a live shell deals **1 damage**. If the shooter used a **Hand Saw** before firing, the next live shot deals **2 damage** instead. ([Buckshot Roulette][3])

When a live shell is fired, the shooter’s turn ends, regardless of whether they shot themselves or another player. ([Buckshot Roulette][3])

### Blank shell

A **blank shell** deals no damage.

If a player shoots **themselves** with a blank, they keep the shotgun and get another turn. If they shoot **another player** with a blank, nobody takes damage and the shooter’s turn ends. ([Buckshot Roulette][3])

---

## 5. What you can do on your turn

On your turn, you may usually do two things:

1. Use any available items you have.
2. Fire the shotgun at yourself or at another living player.

Items are optional. You can use multiple items before shooting, depending on what you have and what the game allows. Most items are consumed after one use.

After you shoot, the current shell is spent. Depending on the result, either your turn ends or you keep playing.

---

## 6. Shooting rules

### Shooting yourself

If the shell is **blank**:

```md
You take no damage.
Your turn continues.
You may act again.
```

If the shell is **live**:

```md
You lose 1 charge.
You lose 2 charges if Hand Saw was active.
Your turn ends.
```

### Shooting another player

If the shell is **blank**:

```md
Target takes no damage.
Your turn ends.
```

If the shell is **live**:

```md
Target loses 1 charge.
Target loses 2 charges if Hand Saw was active.
Your turn ends.
```

---

## 7. Reloading / new load

When all shells in the shotgun have been used or ejected, the shotgun is reloaded with a new hidden order of live and blank shells.

The game shows the number of live and blank shells before loading, but not their order. The order is random. ([Buckshot Roulette][3])

---

## 8. Death and elimination

A player dies when their charges reach **0**.

In multiplayer, death is permanent for that match: once a player dies, they are out for the rest of the game. They cannot be targeted by items like Jammer, and they no longer take turns. ([Buckshot Roulette][1])

The game continues until only one player remains alive.

---

## 9. Win condition

The winner is the **last surviving player**.

Example:

```md
Players:
- Player A: dead
- Player B: 1 charge
- Player C: dead
- Player D: dead

Winner: Player B
```

---

# Items

Multiplayer has the following usable items: **Adrenaline, Beer, Burner Phone, Cigarette Pack, Hand Saw, Inverter, Jammer, Magnifying Glass, and Remote**. The wiki’s multiplayer item category lists these as multiplayer-usable items. ([Buckshot Roulette][4])

---

## Adrenaline

```md
Effect:
Steal an item from another player and use it immediately.
```

Adrenaline lets you take one item from an opposing player’s board and use it right away. You cannot steal another Adrenaline. After using Adrenaline, you have about **10 seconds** to choose the item, or the effect expires. ([Buckshot Roulette][5])

Typical uses:

```md
Steal a Hand Saw before firing a known live shell.
Steal a Magnifying Glass to check the current shell.
Steal a Cigarette Pack to heal immediately.
Steal a Jammer to skip a dangerous opponent.
```

Important detail:

```md
Adrenaline does not simply add the stolen item to your inventory.
It forces you to use the stolen item immediately.
```

---

## Beer

```md
Effect:
Rack the shotgun and eject the current shell without firing it.
```

Beer safely ejects the shell currently in the chamber. This removes that shell from the current load. If the ejected shell was live, that live shell is gone. If it was blank, that blank is gone. ([Buckshot Roulette][6])

If Beer is used on the **last shell** of a load, that player’s turn ends. ([Buckshot Roulette][6])

Example:

```md
Remaining shells:
Live: 2
Blank: 1

You use Beer.
The current shell is ejected.

If it was live:
Remaining shells become Live: 1, Blank: 1.

If it was blank:
Remaining shells become Live: 2, Blank: 0.
```

Beer is useful when you want to remove uncertainty, burn a dangerous shell, or manipulate the remaining shell count.

---

## Burner Phone

```md
Effect:
Reveals the position and type of a random future shell.
```

Burner Phone gives information about a random shell inside the shotgun, described relative to the current shell. For example, “second shell” means the shell after the current chambered shell. ([Buckshot Roulette][7])

Important multiplayer condition:

```md
In multiplayer, if there are 2 shells or fewer left, the phone returns “How Unfortunate...” and the item is wasted.
```

This makes Burner Phone better early in a load, when there are more shells left. ([Buckshot Roulette][7])

Example:

```md
Phone says:
"Third shell: live"

Meaning:
The current shell is unknown.
The next shell is unknown.
The shell after that is live.
```

---

## Cigarette Pack

```md
Effect:
Regain 1 charge.
```

Cigarette Pack heals the user by **1 charge**. It does not restore charges if the user is already at full charges. ([Buckshot Roulette][8])

Example:

```md
You have 2 / 4 charges.
You use Cigarette Pack.
You now have 3 / 4 charges.
```

It is usually best used when damaged, but sometimes a player may use it at full health to prevent another player from stealing it with Adrenaline. ([Buckshot Roulette][8])

---

## Hand Saw

```md
Effect:
The shotgun deals 2 damage for the next shot if the shell is live.
```

Hand Saw doubles the damage of the next live shot. The effect lasts for the next shot/turn and only matters if the chambered shell is live. If the shell is blank, the shot still does no damage. ([Buckshot Roulette][9])

Example:

```md
You use Magnifying Glass.
You see the current shell is live.
You use Hand Saw.
You shoot another player.
They lose 2 charges instead of 1.
```

Best combo:

```md
Magnifying Glass + Hand Saw = confirmed 2 damage if the shell is live.
Inverter + Hand Saw = turn a blank into live, then deal 2 damage.
```

---

## Inverter

```md
Effect:
Turns the current shell into its opposite type.
```

Inverter changes the current chambered shell:

```md
Live -> Blank
Blank -> Live
```

It only affects the current shell in the chamber. ([Buckshot Roulette][10])

Examples:

```md
You know the current shell is blank.
You use Inverter.
It becomes live.
You use Hand Saw.
You shoot an opponent for 2 damage.
```

```md
You know the current shell is live.
You use Inverter.
It becomes blank.
You shoot yourself and keep your turn.
```

Inverter is very strong when combined with information items like Magnifying Glass or Burner Phone.

---

## Jammer

```md
Effect:
Choose an opposing player. That player skips their next turn.
```

Jammer is the multiplayer replacement for Handcuffs. It is only available in multiplayer. You cannot Jam yourself, and you cannot Jam dead players. The selected opponent’s next turn is skipped, even in a 2-player game. ([Buckshot Roulette][11])

Example:

```md
Turn order:
A -> B -> C -> D

Player A uses Jammer on Player B.
Player A shoots.
Next turn would be B, but B is skipped.
Turn goes to C.
```

Good uses:

```md
Skip a player with many dangerous items.
Skip the player who would act after you.
Skip the strongest surviving opponent.
```

---

## Magnifying Glass

```md
Effect:
Check the current shell in the chamber.
```

Magnifying Glass shows whether the current shell is live or blank. It does not remove the shell and does not fire it. ([Buckshot Roulette][12])

Example:

```md
You use Magnifying Glass.
It shows a live shell.

Possible plays:
- Shoot an opponent.
- Use Hand Saw, then shoot an opponent.
- Use Inverter to make it blank, then shoot yourself to keep your turn.
```

This is one of the most important items because it removes uncertainty about the current shot.

---

## Remote

```md
Effect:
Reverse the turn order.
```

Remote reverses the direction of play. It is only available in multiplayer games with more than 2 players. It works like an Uno reverse card. ([Buckshot Roulette][2])

Example:

```md
Current order:
A -> B -> C -> D -> A

Player A uses Remote.

New order:
A -> D -> C -> B -> A
```

The Remote is useless in 2-player games and will be wasted there. ([Buckshot Roulette][2])

Good uses:

```md
Avoid giving the next turn to a dangerous player.
Force the turn toward a weaker player.
Change who receives the shotgun after your turn ends.
```

---

# Turn examples

## Example 1: Safe self-shot

```md
Remaining shells:
Live: 1
Blank: 2

Player A does not know the current shell.
Player A shoots themselves.

Result:
The shell is blank.
Player A takes no damage.
Player A gets another turn.
```

---

## Example 2: Failed attack

```md
Remaining shells:
Live: 2
Blank: 1

Player A shoots Player B.

Result:
The shell is blank.
Player B takes no damage.
Player A's turn ends.
```

---

## Example 3: Confirmed double damage

```md
Player A uses Magnifying Glass.
Current shell is live.

Player A uses Hand Saw.
Player A shoots Player B.

Result:
Player B loses 2 charges.
Player A's turn ends.
```

---

## Example 4: Turning a blank into a kill shot

```md
Player A uses Magnifying Glass.
Current shell is blank.

Player A uses Inverter.
Current shell becomes live.

Player A uses Hand Saw.
Player A shoots Player B.

Result:
Player B loses 2 charges.
```

---

## Example 5: Beer changes the shell count

```md
Remaining shells:
Live: 2
Blank: 2

Player A uses Beer.
The current shell is ejected.

If the ejected shell was live:
Remaining: Live 1, Blank 2.

If the ejected shell was blank:
Remaining: Live 2, Blank 1.
```

---

# Shell counting

Shell counting is the core skill of the game.

At the start of each load, remember:

```md
Live shells: X
Blank shells: Y
```

Every time a shell is fired or ejected, subtract it from the count.

Example:

```md
Start of load:
Live: 3
Blank: 2

Shot 1:
Blank fired.
Remaining: Live 3, Blank 1.

Shot 2:
Live fired.
Remaining: Live 2, Blank 1.

Beer used:
Live shell ejected.
Remaining: Live 1, Blank 1.
```

The fewer shells remain, the more valuable your information becomes.

Example:

```md
Remaining:
Live: 1
Blank: 0

The next shell must be live.
```

```md
Remaining:
Live: 0
Blank: 1

The next shell must be blank.
```

---

# Basic strategy

## Shoot yourself when blanks are likely

Shooting yourself with a blank gives you another turn. This is powerful because it lets you keep control of the shotgun.

```md
Many blanks remaining = self-shot is safer.
Many lives remaining = self-shot is risky.
```

---

## Shoot opponents when lives are likely

If you know or strongly suspect the current shell is live, shooting an opponent is usually best.

```md
Known live shell + Hand Saw = high damage.
Known live shell + weak opponent = possible elimination.
```

---

## Use information before damage items

Hand Saw is dangerous to waste. It is best used after confirming or manipulating the shell.

Good order:

```md
Magnifying Glass -> Hand Saw -> Shoot opponent
```

```md
Magnifying Glass -> Inverter -> Hand Saw -> Shoot opponent
```

---

## Watch other players’ items

In multiplayer, your opponents’ items matter as much as your own.

Dangerous items to watch:

```md
Hand Saw: can deal 2 damage.
Magnifying Glass: can confirm a live shot.
Inverter: can turn blanks into live shells.
Adrenaline: can steal your best item.
Jammer: can skip your next turn.
Remote: can change who plays next.
Cigarette Pack: can keep someone alive.
```

---

## Use Jammer and Remote to control tempo

Jammer and Remote are multiplayer-specific control tools.

```md
Jammer removes a player’s next turn.
Remote changes who goes next.
```

They are especially useful when another player is about to act with strong items.

---

# Quick reference table

| Item             | Effect                                          | Best use                                         |
| ---------------- | ----------------------------------------------- | ------------------------------------------------ |
| Adrenaline       | Steal an opponent’s item and use it immediately | Take a key item before they use it               |
| Beer             | Eject current shell                             | Remove uncertainty or burn a shell               |
| Burner Phone     | Reveal a future shell                           | Plan future turns                                |
| Cigarette Pack   | Heal 1 charge                                   | Survive longer                                   |
| Hand Saw         | Next live shot deals 2 damage                   | Finish or heavily damage a player                |
| Inverter         | Swap current shell live/blank                   | Create a live shot or make a safe blank          |
| Jammer           | Skip an opponent’s next turn                    | Stop a dangerous player                          |
| Magnifying Glass | Reveal current shell                            | Decide whether to shoot self or opponent         |
| Remote           | Reverse turn order                              | Avoid giving the next turn to a dangerous player |

---

# Full regular multiplayer loop

```md
1. Players enter the lobby.
2. The game starts with 2–4 players.
3. The shotgun is loaded with a hidden order of live and blank shells.
4. The game shows how many live and blank shells are in the load.
5. The first player takes the shotgun.
6. On their turn, the player may use items.
7. The player chooses a target:
   - themselves
   - another living player
8. The shotgun fires the current shell.
9. Resolve the shell:
   - Live: target loses charges.
   - Blank: no damage.
10. Resolve the turn:
   - Self-shot blank: same player continues.
   - Live shot: turn ends.
   - Blank shot at another player: turn ends.
11. If any player reaches 0 charges, they die and are removed from the match.
12. If the shotgun is empty, reload with a new set of shells.
13. Continue turn order, skipping dead players and Jammed players.
14. If only one player remains alive, that player wins.
```

---

# Key rule summary

```md
Live shell = damage.
Blank shell = no damage.
Shoot yourself with blank = extra turn.
Shoot opponent with blank = turn ends.
Live shot always ends your turn.
Hand Saw makes the next live shot deal 2 damage.
Beer ejects the current shell.
Magnifying Glass checks the current shell.
Burner Phone reveals a future shell.
Inverter flips the current shell.
Cigarette Pack heals 1 charge.
Adrenaline steals and instantly uses an enemy item.
Jammer skips an opponent’s next turn.
Remote reverses turn order in 3–4 player games.
Dead players stay dead.
Last living player wins.
```

[1]: https://buckshot-roulette.fandom.com/wiki/Multiplayer "Multiplayer | Buckshot Roulette Wiki | Fandom"
[2]: https://buckshot-roulette.fandom.com/wiki/Remote "Remote | Buckshot Roulette Wiki | Fandom"
[3]: https://buckshot-roulette.fandom.com/wiki/Shotgun "Shotgun | Buckshot Roulette Wiki | Fandom"
[4]: https://buckshot-roulette.fandom.com/wiki/Category%3AMultiplayer_items "Category:Multiplayer items | Buckshot Roulette Wiki | Fandom"
[5]: https://buckshot-roulette.fandom.com/wiki/Adrenaline "Adrenaline | Buckshot Roulette Wiki | Fandom"
[6]: https://buckshot-roulette.fandom.com/wiki/Beer "Beer | Buckshot Roulette Wiki | Fandom"
[7]: https://buckshot-roulette.fandom.com/wiki/Burner_Phone "Burner Phone | Buckshot Roulette Wiki | Fandom"
[8]: https://buckshot-roulette.fandom.com/wiki/Cigarette_Pack "Cigarette Pack | Buckshot Roulette Wiki | Fandom"
[9]: https://buckshot-roulette.fandom.com/wiki/Hand_Saw "Hand Saw | Buckshot Roulette Wiki | Fandom"
[10]: https://buckshot-roulette.fandom.com/wiki/Inverter "Inverter | Buckshot Roulette Wiki | Fandom"
[11]: https://buckshot-roulette.fandom.com/wiki/Jammer "Jammer | Buckshot Roulette Wiki | Fandom"
[12]: https://buckshot-roulette.fandom.com/wiki/Magnifying_Glass "Magnifying Glass | Buckshot Roulette Wiki | Fandom"
