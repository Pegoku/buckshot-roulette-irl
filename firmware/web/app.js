const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];
let playerId = Number(localStorage.getItem("buckshotPlayerId") || "-1");
let isAdmin = localStorage.getItem("buckshotAdmin") === "1";
let selectedTarget = -1;
let state = null;
let demoMode = false;
let wakeLock = null;
let lastLifeKey = "";
let nfcAbort = null;
let targetAction = "shot";
let targetItem = "";

const $ = (id) => document.getElementById(id);

function currentJoinPath() {
  return location.pathname.startsWith("/join/") ? location.pathname : "";
}

function expireTab() {
  clearSession();
  location.replace("/expired");
}

async function requestFullscreenMode() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen({navigationUI: "hide"});
      } catch {
        await document.documentElement.requestFullscreen();
      }
    }
  } catch {
    // Some mobile browsers, especially iOS Safari, do not expose page fullscreen.
  }
}

async function lockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Browser support varies; landscape CSS fallback still handles layout.
  }
}

async function keepAwake() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    wakeLock = null;
  }
}

async function enterImmersiveMode() {
  await requestFullscreenMode();
  await lockLandscape();
  await keepAwake();
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

function stopNfcOperation() {
  if (nfcAbort) {
    nfcAbort.abort();
    nfcAbort = null;
  }
}

function payloadInfo(payload) {
  const text = String(payload || "").trim();
  const match = /^buckshot:item:([^:]+)(?::(.+))?$/.exec(text);
  if (!match) {
    return {valid: false, text, message: text ? `Invalid tag: ${text}` : "No NFC text payload"};
  }
  const item = match[1];
  if (!items.includes(item)) {
    return {valid: false, text, message: `Unknown item tag: ${item}`};
  }
  const token = match[2] || "";
  return {
    valid: true,
    item,
    text,
    message: `Valid ${itemLabel(item)} tag${token ? ` / ${token}` : ""}`
  };
}

function payloadFromNfcEvent(event) {
  for (const record of event.message.records) {
    if (record.recordType === "text") {
      return new TextDecoder(record.encoding || "utf-8").decode(record.data);
    }
  }
  return "";
}

function requireWebNfc() {
  if (!("NDEFReader" in window)) throw new Error("Web NFC is not available");
}

function itemNeedsTarget(item) {
  return item === "jammer" || item === "adrenaline";
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
      {id: 0, name: "Operator", lives: 3, alive: true, admin: false, pending_scans: 2, inv: [0, 1, 0, 1, 0, 0, 0, 1, 0]},
      {id: 1, name: "Dealer", lives: 3, alive: true, admin: false, pending_scans: 2, inv: [0, 0, 0, 0, 0, 0, 0, 0, 0]}
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
    const src = i < alive ? "/images/koi/koi_alive.png" : "/images/koi/deadkoi.png";
    const alt = i < alive ? "life remaining" : "life lost";
    const shine = i < alive ? `<img class="koi-shine" src="${src}" alt="" aria-hidden="true">` : "";
    return `<span class="life-cell${filled}"><img class="koi-base" src="${src}" alt="${alt}">${shine}</span>`;
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
  const currentPlayer = state.players.find((p) => p.id === state.current);
  const isMyTurn = Boolean(me && me.id === state.current && state.phase !== "lobby" && state.winner < 0);
  const maxLives = Math.max(3, ...state.players.map((p) => Number(p.lives) || 0));

  const turnTitle = $("turnTitle");
  let title = "WAITING";
  let ticker = false;
  if (state.winner >= 0) {
    title = state.winner === playerId ? "YOU LIVED" : "ROUND LOST";
  } else if (state.phase !== "lobby") {
    if (isMyTurn) {
      title = "YOUR TURN";
    } else {
      title = `${currentPlayer ? currentPlayer.name : "SOMEONE"} has your lives at stake`;
      ticker = true;
    }
  }
  turnTitle.classList.toggle("ticker", ticker);
  if (turnTitle.dataset.title !== title || turnTitle.dataset.ticker !== String(ticker)) {
    const safeTitle = escapeHtml(title);
    turnTitle.innerHTML = ticker
      ? `<span class="ticker-track"><span>${safeTitle}</span><span aria-hidden="true">${safeTitle}</span></span>`
      : safeTitle;
    turnTitle.dataset.title = title;
    turnTitle.dataset.ticker = String(ticker);
  }
  const syncTicker = () => {
    const trackItem = turnTitle.querySelector(".ticker-track span");
    const distance = trackItem ? Math.ceil(trackItem.scrollWidth + 48) : turnTitle.clientWidth;
    const duration = Math.max(2.4, distance / 72);
    turnTitle.style.setProperty("--ticker-distance", `-${distance}px`);
    turnTitle.style.setProperty("--ticker-duration", `${duration}s`);
  };
  requestAnimationFrame(syncTicker);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncTicker).catch(() => {});
  }
  turnTitle.classList.toggle("hot", isMyTurn);
  const lifeKey = `${me ? me.lives : 0}/${maxLives}`;
  if (lifeKey !== lastLifeKey) {
    $("life").innerHTML = lifeMeter(me ? me.lives : 0, maxLives);
    lastLifeKey = lifeKey;
  }
  $("life").setAttribute("aria-label", `${me ? me.lives : 0} life remaining`);
  $("session").textContent = `${state.phase} / ${state.ap}`;
  $("hudActions").classList.toggle("hidden", playerId < 0);
  $("shot").classList.toggle("hidden", playerId < 0 || state.phase === "lobby" || state.winner >= 0);
  $("shot").disabled = !isMyTurn;
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
    const disabled = !isMyTurn || count <= 0 ? " disabled" : "";
    return `<button type="button"${disabled} onclick="useItem('${name}')">${itemLabel(name)} <small>${count}</small></button>`;
  }).join("");
  const pendingScans = me ? Number(me.pending_scans) || 0 : 0;
  $("scan").textContent = pendingScans > 0 ? `Scan ${pendingScans} item tag${pendingScans === 1 ? "" : "s"}` : "No item scans";
  $("scan").disabled = playerId < 0 || state.phase !== "active" || pendingScans <= 0;
}

function openTargetDialog(action, item = "") {
  targetAction = action;
  targetItem = item;
  $("targetTitle").textContent = action === "item" ? `Use ${itemLabel(item)}` : "Shoot target";
  $("targetDialog").classList.remove("hidden");
}

window.chooseTarget = async (id) => {
  selectedTarget = id;
  $("targetDialog").classList.add("hidden");
  if (targetAction === "item") {
    await useItemWithTarget(targetItem, id);
  } else {
    await arm(id);
  }
  targetAction = "shot";
  targetItem = "";
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
  if (currentJoinPath() && state.join && currentJoinPath() !== state.join) {
    expireTab();
    return;
  }
  const storedJoin = localStorage.getItem("buckshotJoinPath") || "";
  if (storedJoin && state.join && storedJoin !== state.join) {
    expireTab();
    return;
  } else if (playerId >= 0 && !state.you) {
    clearSession();
    state.message = "Session expired. Sign in again.";
  }
  render();
}

async function join() {
  try {
    const name = $("name").value.trim();
    if (!name) return;
    const r = await api("/api/register", {name, join: currentJoinPath()});
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

function syncJoinButton() {
  $("join").disabled = $("name").value.trim().length === 0;
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
    $("adminPanel").classList.add("hidden");
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

async function useItemWithTarget(item, target) {
  if (demoMode) {
    $("nfc").textContent = `Used ${itemLabel(item)}`;
    state.message = `${itemLabel(item)} used`;
    render();
    return;
  }
  try {
    await api("/api/item", {pid: playerId, item, target});
    $("nfc").textContent = `Used ${itemLabel(item)}`;
    await refresh();
  } catch (e) {
    $("nfc").textContent = e.message;
  }
}

async function useItem(item) {
  if (itemNeedsTarget(item)) {
    openTargetDialog("item", item);
  } else {
    await useItemWithTarget(item, playerId);
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
      await refresh();
      const me = state && state.players.find((p) => p.id === playerId);
      const left = me ? Number(me.pending_scans) || 0 : 0;
      $("nfc").textContent = left > 0 ? `Tag accepted. Scan ${left} more.` : "Tag accepted. Item scans complete.";
    };
  } catch (e) {
    $("nfc").textContent = e.message;
  }
}

function openNfcPanel() {
  $("adminPanel").classList.add("modal-blocked");
  $("nfcPanel").classList.remove("hidden");
  $("nfcAdminStatus").textContent = state && state.write_mode ? "Write mode is on" : "";
}

function closeNfcPanel() {
  stopNfcOperation();
  closeWriteNfcPanel();
  $("nfcPanel").classList.add("hidden");
  $("adminPanel").classList.remove("modal-blocked");
}

async function testNfc() {
  try {
    requireWebNfc();
    stopNfcOperation();
    const controller = new AbortController();
    nfcAbort = controller;
    const reader = new NDEFReader();
    await reader.scan({signal: controller.signal});
    $("nfcAdminStatus").textContent = "Approach NFC tag to test";
    reader.onreading = (event) => {
      const payload = payloadFromNfcEvent(event);
      const info = payloadInfo(payload);
      $("nfcAdminStatus").textContent = info.message;
      stopNfcOperation();
    };
  } catch (e) {
    if (e.name !== "AbortError") $("nfcAdminStatus").textContent = e.message;
  }
}

function openWriteNfcPanel() {
  $("nfcWriteItems").innerHTML = items.map((name) =>
    `<button type="button" onclick="writeNfcItem('${name}')">${itemLabel(name)}</button>`
  ).join("");
  $("nfcWriteStatus").textContent = "Select an item to write";
  $("nfcWritePanel").classList.remove("hidden");
}

function closeWriteNfcPanel() {
  stopNfcOperation();
  $("nfcWritePanel").classList.add("hidden");
}

window.writeNfcItem = async (item) => {
  try {
    requireWebNfc();
    if (!isAdmin) throw new Error("admin only");
    stopNfcOperation();
    $("nfcWriteStatus").textContent = `Preparing ${itemLabel(item)} tag`;
    if (!state || !state.write_mode) {
      await api("/api/write-mode", {pid: playerId});
      await refresh();
    }
    const token = await api("/api/write-token", {pid: playerId, item});
    const controller = new AbortController();
    nfcAbort = controller;
    $("nfcWriteStatus").textContent = `Approach NFC tag to write ${itemLabel(item)}`;
    const writer = new NDEFReader();
    await writer.write({
      records: [{recordType: "text", data: token.payload}]
    }, {signal: controller.signal});
    $("nfcWriteStatus").textContent = `Wrote ${itemLabel(item)} tag`;
    stopNfcOperation();
    await refresh();
  } catch (e) {
    if (e.name !== "AbortError") $("nfcWriteStatus").textContent = e.message;
  }
};

$("shot").onclick = () => openTargetDialog("shot");
$("adminToggle").onclick = () => $("adminPanel").classList.toggle("hidden");
$("closeAdmin").onclick = () => $("adminPanel").classList.add("hidden");
$("join").onclick = join;
$("name").addEventListener("input", syncJoinButton);
$("name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!$("join").disabled) join();
  }
});
$("saveSetup").onclick = setup;
$("start").onclick = start;
$("reset").onclick = reset;
$("nfcAdmin").onclick = openNfcPanel;
$("closeNfc").onclick = closeNfcPanel;
$("testNfc").onclick = testNfc;
$("writeNfc").onclick = openWriteNfcPanel;
$("cancelNfcWrite").onclick = closeWriteNfcPanel;
$("closeTarget").onclick = () => {
  targetAction = "shot";
  targetItem = "";
  $("targetDialog").classList.add("hidden");
};
$("debugToggle").onclick = () => $("debugPanel").classList.toggle("hidden");
$("closeDebug").onclick = () => $("debugPanel").classList.add("hidden");
$("scan").onclick = scanNfc;

document.addEventListener("pointerdown", enterImmersiveMode);
document.addEventListener("click", enterImmersiveMode);
document.addEventListener("touchend", enterImmersiveMode);
document.addEventListener("keydown", enterImmersiveMode);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    keepAwake();
  }
});

async function boot() {
  await enterImmersiveMode();
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
syncJoinButton();
setInterval(() => refresh().catch(() => {}), 1500);
