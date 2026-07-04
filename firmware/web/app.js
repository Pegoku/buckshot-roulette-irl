const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];
let playerId = Number(localStorage.getItem("buckshotPlayerId") || "-1");
let isAdmin = localStorage.getItem("buckshotAdmin") === "1";
let selectedTarget = -1;
let state = null;
let demoMode = false;

const $ = (id) => document.getElementById(id);

async function lockLandscape() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Browser support varies; landscape CSS fallback still handles layout.
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
    phase: "active",
    admin: -1,
    current: 0,
    winner: -1,
    message: "terminal link unstable",
    players: [
      {id: 0, name: "Operator", lives: 3, alive: true, admin: false, inv: [0, 1, 0, 1, 0, 0, 0, 1, 0]},
      {id: 1, name: "Dealer", lives: 3, alive: true, admin: false, inv: [0, 0, 0, 0, 0, 0, 0, 0, 0]}
    ]
  };
}

function clearSession() {
  localStorage.removeItem("buckshotPlayerId");
  localStorage.removeItem("buckshotAdmin");
  localStorage.removeItem("buckshotJoinPath");
  localStorage.removeItem("buckshotPlayerName");
  playerId = -1;
  isAdmin = false;
  selectedTarget = -1;
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
  $("hudActions").classList.toggle("hidden", playerId < 0);
  $("shot").classList.toggle("hidden", playerId < 0 || state.phase === "lobby" || state.winner >= 0);
  $("adminToggle").classList.toggle("hidden", !isAdmin);
  if (!isAdmin) $("adminPanel").classList.add("hidden");
  $("joinPanel").classList.toggle("hidden", playerId >= 0);
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
  const storedJoin = localStorage.getItem("buckshotJoinPath") || "";
  if (storedJoin && state.join && storedJoin !== state.join) {
    clearSession();
    state.message = "ESP reset detected. Sign in again.";
  } else if (playerId >= 0 && !state.you) {
    clearSession();
    state.message = "Session expired. Sign in again.";
  }
  render();
}

async function join() {
  try {
    const typed = $("name").value.trim();
    const name = typed || `P${Math.floor(Math.random() * 1000)}`;
    const r = await api("/api/register", {name});
    playerId = r.pid;
    isAdmin = r.admin === 1;
    localStorage.setItem("buckshotPlayerId", String(playerId));
    localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");
    localStorage.setItem("buckshotPlayerName", name);
    if (state && state.join) localStorage.setItem("buckshotJoinPath", state.join);
    $("joinStatus").textContent = "";
    await refresh();
  } catch (e) {
    $("joinStatus").textContent = e.message;
  }
}

async function setup() {
  try {
    await api("/api/setup", {
      pid: playerId,
      lives: $("lives").value,
      shells: $("shells").value,
      live: $("live").value,
      items: $("items").value
    });
    $("adminStatus").textContent = "Setup saved";
    await refresh();
  } catch (e) {
    $("adminStatus").textContent = e.message;
  }
}

async function start() {
  try {
    await api("/api/start", {pid: playerId});
    $("adminStatus").textContent = "Round started";
    await refresh();
  } catch (e) {
    $("adminStatus").textContent = e.message;
  }
}

async function reset() {
  try {
    await api("/api/reset", {pid: playerId});
    clearSession();
    $("adminPanel").classList.add("hidden");
    await refresh();
  } catch (e) {
    $("adminStatus").textContent = e.message;
  }
}

async function arm(target) {
  if (demoMode) {
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
    $("nfc").textContent = `Debug read ${itemLabel(item)}`;
    state.message = `${itemLabel(item)} tag read`;
    render();
    return;
  }
  try {
    await api("/api/scan", {pid: playerId, payload: `buckshot:item:${item}:debug`});
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
          payload = new TextDecoder(record.encoding || "utf-8").decode(record.data);
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

$("shot").onclick = () => $("targetDialog").classList.remove("hidden");
$("adminToggle").onclick = () => $("adminPanel").classList.toggle("hidden");
$("closeAdmin").onclick = () => $("adminPanel").classList.add("hidden");
$("join").onclick = join;
$("saveSetup").onclick = setup;
$("start").onclick = start;
$("reset").onclick = reset;
$("closeTarget").onclick = () => $("targetDialog").classList.add("hidden");
$("debugToggle").onclick = () => $("debugPanel").classList.toggle("hidden");
$("closeDebug").onclick = () => $("debugPanel").classList.add("hidden");
$("scan").onclick = scanNfc;

document.addEventListener("pointerdown", lockLandscape, {once: true});
document.addEventListener("keydown", lockLandscape, {once: true});

async function boot() {
  try {
    await refresh();
  } catch (e) {
    try {
      state = await api("/api/state?pid=-1");
      state.message = e.message;
      clearSession();
      render();
    } catch {
      demoMode = true;
      playerId = 0;
      selectedTarget = 1;
      state = makeDemoState();
      render();
    }
  }
}

boot();
setInterval(() => refresh().catch(() => {}), 1500);
