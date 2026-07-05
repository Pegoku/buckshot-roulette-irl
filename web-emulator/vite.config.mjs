import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firmwareWebRoot = path.resolve(__dirname, "../firmware/web");

const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];

function makeGame() {
  return {
    ap: "Buckshot-EMU",
    join: "/join/emulator",
    phase: "lobby",
    message: "Emulator ready",
    admin: 255,
    player_count: 0,
    current: 0,
    winner: -1,
    write_mode: false,
    shell_index: 0,
    shell_count: 0,
    live_remaining: 0,
    blank_remaining: 0,
    armed_target: -1,
    armed_target_name: "",
    max_lives: 3,
    max_shells: 6,
    live_shells_setting: 3,
    items_per_player: 2,
    direction: 1,
    saw_active: false,
    nextId: 0,
    players: [],
    shells: []
  };
}

let game = makeGame();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function playerById(pid) {
  return game.players.find((p) => p.id === pid && p.active) || null;
}

function recomputeAdmin() {
  const active = game.players.filter((p) => p.active);
  active.sort((a, b) => a.joinOrder - b.joinOrder);
  game.admin = active[0] ? active[0].id : 255;
  game.player_count = active.length;
}

function isAdmin(pid) {
  return playerById(pid) && game.admin === pid;
}

function liveRemaining() {
  return game.shells.slice(game.shell_index).filter(Boolean).length;
}

function aliveCount() {
  return game.players.filter((p) => p.active && p.alive).length;
}

function inventoryCount(player) {
  return player.inv.reduce((sum, count) => sum + count, 0);
}

function randomItem() {
  const choices = items.filter((name) => name !== "remote" || aliveCount() > 2);
  return items.indexOf(choices[Math.floor(Math.random() * choices.length)]);
}

function stateFor(pid) {
  const live = liveRemaining();
  const activePlayers = game.players.filter((p) => p.active);
  return {
    ok: true,
    ap: game.ap,
    join: game.join,
    phase: game.phase,
    message: game.message,
    you: Boolean(playerById(pid)),
    admin: game.admin,
    player_count: activePlayers.length,
    current: game.current,
    winner: game.winner,
    write_mode: game.write_mode,
    shell_index: game.shell_index,
    shell_count: game.shell_count,
    live_remaining: live,
    blank_remaining: Math.max(0, game.shell_count - game.shell_index - live),
    armed_target: game.armed_target,
    armed_target_name: game.armed_target_name,
    players: activePlayers.map((p) => ({
      id: p.id,
      name: p.name,
      lives: p.lives,
      alive: p.alive,
      admin: p.id === game.admin,
      inv: p.inv
    }))
  };
}

function shuffleShells() {
  const liveCount = Math.max(1, Math.min(game.live_shells_setting, game.max_shells - 1));
  game.shells = Array.from({length: game.max_shells}, (_, i) => i < liveCount);
  for (let i = game.shells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [game.shells[i], game.shells[j]] = [game.shells[j], game.shells[i]];
  }
  game.shell_index = 0;
  game.shell_count = game.shells.length;
}

function giveItems() {
  for (const player of game.players) {
    if (!player.active || !player.alive) continue;
    for (let i = 0; i < game.items_per_player; i++) {
      if (inventoryCount(player) >= 8) break;
      player.inv[randomItem()]++;
    }
  }
}

function nextAlive(from) {
  const alive = game.players.filter((p) => p.active && p.alive);
  if (!alive.length) return 0;
  const sorted = [...alive].sort((a, b) => a.id - b.id);
  let index = sorted.findIndex((p) => p.id === from);
  const direction = game.direction >= 0 ? 1 : -1;
  for (let step = 0; step < sorted.length; step++) {
    index = (index + direction + sorted.length) % sorted.length;
    const player = sorted[index];
    if (player.skip_turn) {
      player.skip_turn = false;
      game.message = `${player.name} was jammed and skips`;
      continue;
    }
    return player.id;
  }
  return from;
}

function itemFromPayload(payload) {
  const match = /^buckshot:item:([^:]+)/.exec(payload || "");
  if (!match) return -1;
  return items.indexOf(match[1]);
}

function mockEspApi() {
  return {
    name: "buckshot-esp-api-emulator",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith("/api/")) {
          next();
          return;
        }

        try {
          if (req.method === "GET" && url.pathname === "/api/state") {
            const pid = Number(url.searchParams.get("pid") ?? -1);
            sendJson(res, 200, stateFor(pid));
            return;
          }

          if (req.method !== "POST") {
            sendJson(res, 405, {ok: false, error: "method not allowed"});
            return;
          }

          const body = await readBody(req);
          const pid = Number(body.get("pid") ?? -1);

          if (url.pathname === "/api/register") {
            if (game.phase !== "lobby") {
              sendJson(res, 400, {ok: false, error: "registration closed"});
              return;
            }
            if (game.players.filter((p) => p.active).length >= 4) {
              sendJson(res, 400, {ok: false, error: "table full"});
              return;
            }
            const id = game.nextId++;
            const name = String(body.get("name") || `P${id + 1}`).slice(0, 15);
            game.players.push({
              id,
              name,
              active: true,
              alive: true,
              lives: game.max_lives,
              joinOrder: Date.now() + id,
              inv: Array(items.length).fill(0)
            });
            recomputeAdmin();
            game.message = `${name} joined`;
            sendJson(res, 200, {ok: true, pid: id, admin: game.admin === id ? 1 : 0});
            return;
          }

          if (url.pathname === "/api/setup") {
            if (!isAdmin(pid) || game.phase !== "lobby") {
              sendJson(res, 400, {ok: false, error: "admin only"});
              return;
            }
            game.max_lives = Math.max(1, Math.min(9, Number(body.get("lives") || game.max_lives)));
            game.max_shells = Math.max(2, Math.min(8, Number(body.get("shells") || game.max_shells)));
            game.live_shells_setting = Math.max(1, Math.min(game.max_shells - 1, Number(body.get("live") || game.live_shells_setting)));
            game.items_per_player = Math.max(0, Math.min(8, Number(body.get("items") || game.items_per_player)));
            for (const player of game.players) {
              if (player.active) {
                player.lives = game.max_lives;
                player.alive = true;
              }
            }
            game.message = "Setup saved";
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/start") {
            if (!isAdmin(pid) || game.players.filter((p) => p.active).length < 2) {
              sendJson(res, 400, {ok: false, error: "need admin and 2 players"});
              return;
            }
            game.phase = "active";
            game.winner = -1;
            game.armed_target = -1;
            game.armed_target_name = "";
            game.direction = 1;
            game.saw_active = false;
            game.current = game.players.find((p) => p.active && p.alive).id;
            for (const player of game.players) {
              if (player.active) {
                player.alive = true;
                player.lives = game.max_lives;
                player.inv = Array(items.length).fill(0);
              }
            }
            shuffleShells();
            giveItems();
            game.message = "Round started";
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/arm") {
            const targetId = Number(body.get("target") ?? -1);
            const shooter = playerById(pid);
            const target = playerById(targetId);
            if (game.phase !== "active" || !shooter || !target || !shooter.alive || !target.alive || game.current !== pid) {
              sendJson(res, 400, {ok: false, error: "bad shot"});
              return;
            }
            game.armed_target = targetId;
            game.armed_target_name = target.name;
            const live = Boolean(game.shells[game.shell_index++]);
            const damage = game.saw_active && live ? 2 : 1;
            if (live) {
              target.lives = Math.max(0, target.lives - damage);
              target.alive = target.lives > 0;
              game.message = `${shooter.name} hit ${target.name} for ${damage}`;
            } else {
              game.message = `${shooter.name} fired blank`;
            }
            game.saw_active = false;
            if (game.players.filter((p) => p.active && p.alive).length === 1) {
              const winner = game.players.find((p) => p.active && p.alive);
              game.winner = winner.id;
              game.phase = "game_over";
              game.message = `${winner.name} wins`;
            } else if (!(!live && targetId === pid)) {
              game.current = nextAlive(pid);
            }
            if (game.phase === "active" && game.shell_index >= game.shell_count) {
              shuffleShells();
              game.message += " / reloaded";
            }
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/item") {
            const player = playerById(pid);
            const item = String(body.get("item") || "");
            const targetId = Number(body.get("target") ?? pid);
            const target = playerById(targetId);
            const itemIndex = items.indexOf(item);
            if (game.phase !== "active" || !player || !player.alive || game.current !== pid || itemIndex < 0 || player.inv[itemIndex] <= 0) {
              sendJson(res, 400, {ok: false, error: "bad item"});
              return;
            }
            player.inv[itemIndex]--;
            if (item === "beer") {
              if (game.shell_index < game.shell_count) {
                const live = Boolean(game.shells[game.shell_index++]);
                game.message = `Beer ejected a ${live ? "live" : "blank"}`;
                if (game.shell_index >= game.shell_count) {
                  shuffleShells();
                  giveItems();
                  game.current = nextAlive(pid);
                }
              }
            } else if (item === "burner") {
              const remaining = game.shell_count - game.shell_index;
              if (remaining > 2) {
                const idx = game.shell_index + 1 + Math.floor(Math.random() * (remaining - 1));
                game.message = `Burner: shell ${idx + 1} is ${game.shells[idx] ? "live" : "blank"}`;
              } else {
                game.message = "Burner: how unfortunate";
              }
            } else if (item === "cigarette") {
              player.lives = Math.min(game.max_lives, player.lives + 1);
              game.message = `${player.name} healed`;
            } else if (item === "saw") {
              game.saw_active = true;
              game.message = "Next live shot deals 2";
            } else if (item === "inverter") {
              if (game.shell_index < game.shell_count) game.shells[game.shell_index] = !game.shells[game.shell_index];
              game.message = "Current shell inverted";
            } else if (item === "glass") {
              game.message = game.shell_index < game.shell_count ? `Current shell is ${game.shells[game.shell_index] ? "live" : "blank"}` : "No shell loaded";
            } else if (item === "remote") {
              if (aliveCount() > 2) {
                game.direction *= -1;
                game.message = "Turn order reversed";
              } else {
                game.message = "Remote did nothing";
              }
            } else if (item === "jammer") {
              if (!target || target.id === player.id || !target.alive) {
                player.inv[itemIndex]++;
                sendJson(res, 400, {ok: false, error: "select target"});
                return;
              }
              target.skip_turn = true;
              game.message = `${player.name} jammed ${target.name}`;
            } else if (item === "adrenaline") {
              if (!target || target.id === player.id || !target.alive) {
                player.inv[itemIndex]++;
                sendJson(res, 400, {ok: false, error: "select target"});
                return;
              }
              const stolen = target.inv.findIndex((count, index) => index !== 0 && count > 0);
              if (stolen >= 0) {
                target.inv[stolen]--;
                if (inventoryCount(player) < 8) player.inv[stolen]++;
                game.message = `${player.name} stole ${items[stolen]}`;
              } else {
                game.message = `${target.name} had no item`;
              }
            }
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/scan") {
            const player = playerById(pid);
            const itemIndex = itemFromPayload(String(body.get("payload") || ""));
            if (!player || itemIndex < 0) {
              sendJson(res, 400, {ok: false, error: "unknown tag"});
              return;
            }
            if (inventoryCount(player) >= 8) {
              sendJson(res, 400, {ok: false, error: "item board full"});
              return;
            }
            player.inv[itemIndex]++;
            game.message = `${player.name} scanned ${items[itemIndex]}`;
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/write-mode") {
            if (!isAdmin(pid) || game.phase !== "lobby") {
              sendJson(res, 400, {ok: false, error: "admin lobby only"});
              return;
            }
            game.write_mode = !game.write_mode;
            game.message = `NFC write mode ${game.write_mode ? "on" : "off"}`;
            sendJson(res, 200, {ok: true});
            return;
          }

          if (url.pathname === "/api/write-token") {
            if (!isAdmin(pid)) {
              sendJson(res, 400, {ok: false, error: "admin only"});
              return;
            }
            if (!game.write_mode) {
              sendJson(res, 400, {ok: false, error: "enable NFC write mode"});
              return;
            }
            const item = String(body.get("item") || "");
            if (!items.includes(item)) {
              sendJson(res, 400, {ok: false, error: "admin only"});
              return;
            }
            const payload = `buckshot:item:${item}:${Math.random().toString(16).slice(2, 10)}`;
            sendJson(res, 200, {ok: true, payload});
            return;
          }

          if (url.pathname === "/api/reset") {
            if (!isAdmin(pid)) {
              sendJson(res, 400, {ok: false, error: "admin only"});
              return;
            }
            game = makeGame();
            game.message = "Game reset";
            sendJson(res, 200, {ok: true});
            return;
          }

          sendJson(res, 404, {ok: false, error: "mock endpoint not implemented"});
        } catch (error) {
          sendJson(res, 500, {ok: false, error: error.message});
        }
      });
    }
  };
}

export default defineConfig({
  root: firmwareWebRoot,
  publicDir: false,
  server: {
    port: 5173,
    host: "0.0.0.0",
    strictPort: true,
    fs: {
      allow: [firmwareWebRoot]
    }
  },
  preview: {
    port: 4173,
    host: "0.0.0.0"
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true
  },
  plugins: [mockEspApi()]
});
