const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];
let playerId = Number(localStorage.getItem("buckshotPlayerId") || "-1");
let isAdmin = localStorage.getItem("buckshotAdmin") === "1";
let selectedTarget = -1;
let state = null;
let writeAbort = null;
let demoMode = false;

const $ = (id) => document.getElementById(id);
const exists = (id) => Boolean($(id));

async function lockLandscape() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Browsers may reject orientation lock outside installed/fullscreen contexts.
  }
}

async function api(path, body) {
  const opts = body ? {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams(body).toString()
  } : {};
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {ok: false, error: text || res.statusText};
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

function itemLabel(name) {
  return {
    adrenaline: "Adrenaline",
    beer: "Beer",
    burner: "Burner Phone",
    cigarette: "Cigarette",
    saw: "Hand Saw",
    inverter: "Inverter",
    jammer: "Jammer",
    glass: "Magnifier",
    remote: "Remote"
  }[name] || name;
}

function makeDemoState() {
  return {
    ap: "LOCAL",
    phase: "round",
    admin: -1,
    current: 0,
    winner: -1,
    message: "terminal link unstable",
    shell_index: 2,
    shell_count: 6,
    live_remaining: 2,
    blank_remaining: 3,
    armed_target_name: "none",
    players: [
      {id: 0, name: "Operator", lives: 3, alive: true, admin: false, inv: [0, 1, 0, 1, 0, 0, 0, 1, 0]},
      {id: 1, name: "Dealer", lives: 3, alive: true, admin: false, inv: [0, 0, 0, 0, 0, 0, 0, 0, 0]}
    ]
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function lifeMeter(lives, maxLives = 3) {
  const total = Math.max(1, Number(maxLives) || 3);
  const alive = Math.max(0, Math.min(total, Number(lives) || 0));
  return Array.from({length: total}, (_, i) => {
    const filled = i < alive ? " filled" : "";
    return `<span class="life-cell${filled}" aria-hidden="true">ϟ</span>`;
  }).join("");
}

function playerBySlot(slot) {
  if (!state) return null;
  if (slot === 0) return state.players.find((p) => p.id === playerId) || null;
  const opponents = state.players.filter((p) => p.id !== playerId);
  return opponents[slot - 1] || null;
}

function render() {
  if (!state) return;
  isAdmin = playerId >= 0 && state.admin === playerId;
  localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");

  const me = state.players.find((p) => p.id === playerId);
  const isMyTurn = Boolean(me && me.id === state.current && state.phase !== "lobby" && state.winner < 0);
  const maxLives = Math.max(3, ...state.players.map((p) => Number(p.lives) || 0));

  $("turnTitle").textContent = state.winner >= 0
    ? (state.winner === playerId ? "YOU LIVED" : "ROUND LOST")
    : state.phase === "lobby"
      ? "WAITING"
      : isMyTurn
        ? "YOUR TURN"
        : "STAND BY";
  $("turnTitle").classList.toggle("hot", isMyTurn);
  $("life").innerHTML = lifeMeter(me ? me.lives : 0, maxLives);
  $("life").setAttribute("aria-label", `${me ? me.lives : 0} life remaining`);
  $("session").textContent = `${state.phase} / ${state.ap}`;

  if (exists("admin")) $("admin").classList.toggle("hidden", !isAdmin);
  if (exists("writeMode")) $("writeMode").textContent = state.write_mode ? "NFC write mode is on" : "NFC write mode is off";
  if (exists("register")) $("register").classList.toggle("hidden", playerId >= 0);
  $("hudActions").classList.toggle("hidden", playerId < 0 || state.phase === "lobby" || state.winner >= 0);
  $("message").textContent = state.message || "";

  $("targets").innerHTML = [
    {slot: 1, label: "Opp1", pos: "top"},
    {slot: 2, label: "Opp2", pos: "right"},
    {slot: 3, label: "Opp3", pos: "left"},
    {slot: 0, label: "You", pos: "bottom"}
  ].map(({slot, label, pos}) => {
    const player = playerBySlot(slot);
    const online = Boolean(player && player.alive);
    const active = player && selectedTarget === player.id ? " active" : "";
    const disabled = online ? "" : " disabled";
    const status = online ? escapeHtml(player.name) : "X";
    return `<button class="target-box target-${pos}${active}"${disabled} onclick="chooseSlot(${slot})">
      <span>${label}</span>
      <small>${status}</small>
    </button>`;
  }).join("");

  $("inventory").innerHTML = items.map((name, i) => {
    const count = me ? me.inv[i] : 0;
    return `<button onclick="useItem('${name}')">${itemLabel(name)} <small>debug ${count}</small></button>`;
  }).join("");
}

window.selectTarget = (id) => {
  selectedTarget = id;
  render();
};

window.chooseTarget = async (id) => {
  selectedTarget = id;
  $("targetDialog").classList.add("hidden");
  await arm(id);
};

window.chooseSlot = async (slot) => {
  const player = playerBySlot(slot);
  if (!player || !player.alive) return;
  await chooseTarget(player.id);
};

async function refresh() {
  if (demoMode) {
    render();
    return;
  }
  state = await api(`/api/state?pid=${playerId}`);
  render();
}

async function join() {
  const name = `P${Math.floor(Math.random() * 1000)}`;
  const r = await api("/api/register", {name});
  playerId = r.pid;
  isAdmin = r.admin === 1;
  localStorage.setItem("buckshotPlayerId", String(playerId));
  localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");
  await refresh();
}

async function setup() {
  await api("/api/setup", {
    pid: playerId,
    lives: $("lives").value,
    shells: $("shells").value,
    live: $("live").value,
    items: $("items").value
  });
  await refresh();
}

async function start() {
  await api("/api/start", {pid: playerId});
  await refresh();
}

async function reset() {
  await api("/api/reset", {pid: playerId});
  localStorage.removeItem("buckshotPlayerId");
  localStorage.removeItem("buckshotAdmin");
  playerId = -1;
  isAdmin = false;
  await refresh();
}

async function toggleWriteMode() {
  await api("/api/write-mode", {pid: playerId});
  await refresh();
}

async function arm(target) {
  if (demoMode) {
    state.armed_target_name = target === playerId ? "self" : "opponent";
    state.message = target === playerId ? "barrel turned inward" : "target locked";
    state.current = playerId;
    render();
    return;
  }
  await api("/api/arm", {pid: playerId, target});
  await refresh();
}

async function useItem(item) {
  if (demoMode) {
    const index = items.indexOf(item);
    if (index >= 0) {
      $("nfc").textContent = `Debug read ${itemLabel(item)}`;
      state.message = `${itemLabel(item)} tag read`;
    }
    render();
    return;
  }
  try {
    await api("/api/scan", {pid: playerId, payload: item});
    $("nfc").textContent = `Debug read ${itemLabel(item)}`;
    await refresh();
  } catch (e) {
    $("nfc").textContent = e.message;
  }
}

async function scanNfc() {
  try {
    if (!("NDEFReader" in window)) throw new Error("Web NFC is not available");
    const reader = new NDEFReader();
    await reader.scan();
    $("nfc").textContent = "Tap an item tag";
    reader.onreading = async (event) => {
      let payload = "";
      for (const record of event.message.records) {
        if (record.recordType === "text") {
          const text = new TextDecoder(record.encoding || "utf-8").decode(record.data);
          payload = text;
        }
      }
      if (!payload) payload = `serial:${event.serialNumber}`;
      await api("/api/scan", {pid: playerId, payload});
      $("nfc").textContent = `Scanned ${payload}`;
      await refresh();
    };
  } catch (e) {
    $("nfc").textContent = e.message;
  }
}

async function writeItem(item) {
  if (writeAbort) return;
  try {
    if (!("NDEFReader" in window)) throw new Error("Web NFC is not available");
    writeAbort = new AbortController();
    $("writePrompt").textContent = `Approach NFC tag to write ${itemLabel(item)}.`;
    $("writeProgress").textContent = "Waiting for tag";
    $("nfcWriteDialog").classList.remove("hidden");
    const r = await api("/api/write-token", {pid: playerId, item});
    const writer = new NDEFReader();
    await writer.write(
      {records: [{recordType: "text", data: r.payload}]},
      {signal: writeAbort.signal}
    );
    $("writeStatus").textContent = `Wrote ${itemLabel(item)}`;
    $("writeProgress").textContent = "Tag written";
  } catch (e) {
    const message = e.name === "AbortError" ? "Write cancelled" : e.message;
    $("writeStatus").textContent = message;
    $("writeProgress").textContent = message;
  } finally {
    writeAbort = null;
    setTimeout(() => $("nfcWriteDialog").classList.add("hidden"), 450);
  }
}

function cancelWrite() {
  if (writeAbort) {
    writeAbort.abort();
  }
}

$("refresh").onclick = refresh;
if (exists("join")) $("join").onclick = join;
if (exists("saveSetup")) $("saveSetup").onclick = setup;
if (exists("start")) $("start").onclick = start;
if (exists("reset")) $("reset").onclick = reset;
if (exists("toggleWriteMode")) $("toggleWriteMode").onclick = toggleWriteMode;
$("shot").onclick = () => $("targetDialog").classList.remove("hidden");
$("closeTarget").onclick = () => $("targetDialog").classList.add("hidden");
$("debugToggle").onclick = () => $("debugPanel").classList.toggle("hidden");
$("closeDebug").onclick = () => $("debugPanel").classList.add("hidden");
$("scan").onclick = scanNfc;
if (exists("cancelWrite")) $("cancelWrite").onclick = cancelWrite;
if (exists("writer")) $("writer").innerHTML = items.map((item) => `<button onclick="writeItem('${item}')">${itemLabel(item)}</button>`).join("");

document.addEventListener("pointerdown", lockLandscape, {once: true});
document.addEventListener("keydown", lockLandscape, {once: true});

async function boot() {
  try {
    if (playerId < 0) await join();
    else await refresh();
  } catch (e) {
    demoMode = true;
    playerId = 0;
    selectedTarget = 1;
    state = makeDemoState();
    render();
  }
}

boot();
setInterval(() => refresh().catch(() => {}), 1500);
