const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];
let playerId = Number(localStorage.getItem("buckshotPlayerId") || "-1");
let isAdmin = localStorage.getItem("buckshotAdmin") === "1";
let selectedTarget = -1;
let state = null;
let demoMode = false;
let wakeLock = null;
let lastLifeKey = "";
let nfcAbort = null;
let playerNfcReader = null;
let playerNfcStarting = false;
let pendingScanPayload = "";
let pendingScanItem = "";
let lastNfcPayload = "";
let lastNfcAt = 0;
let nfcUsePausedUntil = 0;
let lastPendingScanTotal = 0;
let adrenalinePayload = "";
let adrenalineTarget = -1;
let adrenalineSteal = "";
let targetAction = "shot";
let targetItem = "";
let roundLoadKey = "";
let shotAudio = null;
let shotAudioUnlocked = false;
let lastShotMsSeen = null;
let lastServerMillis = 0;
let refreshTimer = null;
let refreshing = false;
let lastBeerEjectSeq = 0;
let beerEjectHideTimer = null;
let playerToken = localStorage.getItem("buckshotPlayerToken") || "";

const shotSoundSrc = "/audio/shotgun.mp3";

const $ = (id) => document.getElementById(id);

function currentJoinPath() {
  return location.pathname.startsWith("/join/") ? location.pathname : "";
}

function isAllowedJoinPath(path, expected) {
  return path === expected || path === "/join/allow";
}

function secureNfcUrl() {
  return `https://${location.hostname}${location.pathname}${location.search}`;
}

function needsSecureNfcContext() {
  return !window.isSecureContext || location.protocol !== "https:";
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

function getShotAudio() {
  if (!shotAudio) {
    shotAudio = new Audio(shotSoundSrc);
    shotAudio.preload = "auto";
    shotAudio.volume = 1;
  }
  return shotAudio;
}

async function unlockShotAudio() {
  if (shotAudioUnlocked) return;
  const audio = getShotAudio();
  try {
    audio.muted = true;
    audio.currentTime = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    shotAudioUnlocked = true;
  } catch {
    audio.muted = false;
  }
}

async function enterImmersiveMode() {
  unlockShotAudio();
  await requestFullscreenMode();
  await lockLandscape();
  await keepAwake();
  if (playerId >= 0) startPlayerNfc();
}

async function api(path, body) {
  const requestStartedAt = Date.now();
  const postBody = body ? {...body} : null;
  if (postBody && postBody.pid !== undefined && playerToken) postBody.token = playerToken;
  const opts = body ? {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams(postBody).toString()
  } : {};
  const res = await fetch(path, opts);
  const text = await res.text();
  const responseAt = Date.now();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {ok: false, error: text || res.statusText};
  }
  if (typeof data.millis === "number") {
    data._clockOffsetMs = Math.round(((requestStartedAt + responseAt) / 2) - data.millis);
    data._responseAt = responseAt;
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

function statePath(pid = playerId) {
  const params = new URLSearchParams({pid: String(pid)});
  if (pid >= 0 && playerToken) params.set("token", playerToken);
  return `/api/state?${params.toString()}`;
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

function itemDescription(name) {
  return {
    adrenaline: "Steal one item from an opponent, verify its tag, and use it immediately.",
    beer: "Rack out the current shell and reveal whether it was live or blank.",
    burner: "Peek at a later shell in the current load.",
    cigarette: "Recover one life, up to the life limit.",
    saw: "The next live shot deals 2 damage.",
    inverter: "Flip the current shell from live to blank, or blank to live.",
    jammer: "Disable one opponent for their next turn.",
    glass: "Show the current shell on the main display for a few seconds.",
    remote: "Reverse turn order when more than two players are alive."
  }[name] || "Unknown item.";
}

function openItemInfo(item) {
  $("itemInfoTitle").textContent = itemLabel(item);
  $("itemInfoText").textContent = itemDescription(item);
  $("itemInfoPanel").classList.remove("hidden");
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

function setNfcStatus(message) {
  $("nfc").textContent = message;
  $("scanStatus").textContent = message;
}

function closeAdrenalinePanel() {
  adrenalinePayload = "";
  adrenalineTarget = -1;
  adrenalineSteal = "";
  $("adrenalinePanel").classList.add("hidden");
  $("adrenalineTargets").innerHTML = "";
  $("adrenalineItems").innerHTML = "";
  $("adrenalineStatus").textContent = "";
}

function openAdrenalinePanel(payload = "") {
  adrenalinePayload = payload;
  adrenalineTarget = -1;
  adrenalineSteal = "";
  $("adrenalinePanel").classList.remove("hidden");
  $("adrenalineStatus").textContent = "Select an opponent";
  $("adrenalineItems").innerHTML = "";
  const opponents = (state ? state.players : []).filter((p) => p.id !== playerId && p.alive);
  $("adrenalineTargets").innerHTML = opponents.map((p) =>
    `<button type="button" onclick="chooseAdrenalineTarget(${p.id})">
      <img class="target-avatar" src="${playerPortraitSrc(p)}" alt="">
      <span>${escapeHtml(p.name)}</span>
    </button>`
  ).join("");
}

window.chooseAdrenalineTarget = (id) => {
  adrenalineTarget = id;
  const target = state && state.players.find((p) => p.id === id);
  if (!target) return;
  $("adrenalineStatus").textContent = `Select item from ${target.name}`;
  $("adrenalineItems").innerHTML = items.map((name, index) => {
    const count = target.inv[index] || 0;
    if (index === 0 || count <= 0) return "";
    return `<button type="button" onclick="chooseAdrenalineItem('${name}')">${itemLabel(name)} <small>${count}</small></button>`;
  }).join("") || "<p class='message'>No stealable items</p>";
};

window.chooseAdrenalineItem = (item) => {
  adrenalineSteal = item;
  $("adrenalineStatus").textContent = `Scan ${itemLabel(item)} tag to verify`;
};

async function finishAdrenalineUse(stealPayload = "") {
  if (!adrenalineSteal || adrenalineTarget < 0) return;
  if (adrenalinePayload) {
    await api("/api/scan", {pid: playerId, payload: adrenalinePayload, target: adrenalineTarget, steal: adrenalineSteal, steal_payload: stealPayload});
  } else {
    await api("/api/item", {pid: playerId, item: "adrenaline", target: adrenalineTarget, steal: adrenalineSteal, steal_payload: stealPayload});
  }
  closeAdrenalinePanel();
  await refresh();
  setNfcStatus(`Used Adrenaline`);
}

async function handleAdrenalineVerification(payload) {
  const info = payloadInfo(payload);
  if (!info.valid || info.item !== adrenalineSteal) {
    $("adrenalineStatus").textContent = `Wrong tag. Scan ${itemLabel(adrenalineSteal)}.`;
    return;
  }
  $("adrenalineStatus").textContent = "Tag verified. Using item...";
  try {
    await finishAdrenalineUse(payload);
  } catch (e) {
    $("adrenalineStatus").textContent = e.message;
    setNfcStatus(e.message);
  }
}

async function submitScanPayload(payload, target = selectedTarget) {
  if (adrenalineSteal) {
    await handleAdrenalineVerification(payload);
    return;
  }
  const info = payloadInfo(payload);
  const me = state && state.players.find((p) => p.id === playerId);
  const claiming = me && Number(me.pending_scans) > 0;
  const pendingTotal = state ? Number(state.pending_scan_total) || 0 : 0;
  if (!claiming && pendingTotal > 0) {
    setNfcStatus("Waiting for others");
    return;
  }
  if (!claiming && Date.now() < nfcUsePausedUntil) {
    setNfcStatus("Items arming...");
    return;
  }
  if (!claiming && info.valid && info.item === "adrenaline") {
    openAdrenalinePanel(payload);
    return;
  }
  if (!claiming && info.valid && itemNeedsTarget(info.item) && (target < 0 || target === playerId)) {
    pendingScanPayload = payload;
    pendingScanItem = info.item;
    setNfcStatus(`Select a target for ${itemLabel(info.item)}`);
    openTargetDialog("scanItem", info.item);
    return;
  }
  const result = await api("/api/scan", {pid: playerId, payload, target});
  await refresh();
  const updatedMe = state && state.players.find((p) => p.id === playerId);
  const left = updatedMe ? Number(updatedMe.pending_scans) || 0 : 0;
  const updatedPendingTotal = state ? Number(state.pending_scan_total) || 0 : 0;
  if (result.mode === "claim") {
    setNfcStatus(left > 0 ? `Tag accepted. Scan ${left} more.` :
      (updatedPendingTotal > 0 ? "Tag accepted. Waiting for others." : "Tag accepted. Item scans complete."));
  } else {
    setNfcStatus(`Used ${info.valid ? itemLabel(info.item) : "item"}`);
  }
}

async function startPlayerNfc() {
  if (demoMode || playerId < 0 || playerNfcReader || playerNfcStarting) return;
  try {
    if (needsSecureNfcContext()) {
      setNfcStatus("Open secure NFC page");
      return;
    }
    requireWebNfc();
    playerNfcStarting = true;
    const reader = new NDEFReader();
    await reader.scan();
    playerNfcReader = reader;
    setNfcStatus("NFC listening");
    $("scanRequired").textContent = "NFC listening";
    $("scanRequired").disabled = true;
    reader.onreading = async (event) => {
      const payload = payloadFromNfcEvent(event) || `serial:${event.serialNumber}`;
      const now = Date.now();
      if (!adrenalineSteal && payload === lastNfcPayload && now - lastNfcAt < 1400) return;
      lastNfcPayload = payload;
      lastNfcAt = now;
      try {
        await submitScanPayload(payload);
      } catch (e) {
        setNfcStatus(e.message);
      }
    };
    reader.onreadingerror = () => setNfcStatus("NFC read failed");
  } catch (e) {
    setNfcStatus(e.message);
  } finally {
    playerNfcStarting = false;
  }
}

function makeDemoState() {
  return {
    ap: "LOCAL",
    phase: "active",
    admin: -1,
    current: 0,
    winner: -1,
    pending_scan_total: 4,
    message: "terminal link unstable",
    players: [
      {id: 0, name: "Operator", color: "pink", lives: 3, alive: true, jammed: false, admin: false, pending_scans: 2, inv: [0, 1, 0, 1, 0, 0, 0, 1, 0]},
      {id: 1, name: "Dealer", color: "blue", lives: 3, alive: true, jammed: false, admin: false, pending_scans: 2, inv: [0, 0, 0, 0, 0, 0, 0, 0, 0]}
    ]
  };
}

function clearSession() {
  localStorage.removeItem("buckshotPlayerId");
  localStorage.removeItem("buckshotAdmin");
  localStorage.removeItem("buckshotPlayerToken");
  localStorage.removeItem("buckshotJoinPath");
  localStorage.removeItem("buckshotPlayerName");
  playerId = -1;
  isAdmin = false;
  playerToken = "";
  selectedTarget = -1;
  closeAdrenalinePanel();
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

function playerPortraitSrc(player) {
  const color = ["pink", "blue", "green", "yellow"].includes(player && player.color) ? player.color : "green";
  let frame = 4;
  if (player && player.alive && Number(player.lives) >= 3) {
    frame = 1;
  } else if (player && player.alive && Number(player.lives) === 2) {
    frame = 2;
  } else if (player && player.alive && Number(player.lives) === 1) {
    frame = 3;
  }
  return `/images/soups/soup-${color}-${frame}.png`;
}

function playerBySlot(slot) {
  if (!state) return null;
  if (slot === 0) return state.players.find((p) => p.id === playerId) || null;
  const opponents = state.players.filter((p) => p.id !== playerId);
  return opponents[slot - 1] || null;
}

function renderEndScreen() {
  const panel = $("endScreenPanel");
  const winner = state && state.players.find((p) => p.id === state.winner);
  const show = Boolean(state && state.winner >= 0 && !state.round_intro_active);
  panel.classList.toggle("hidden", !show);
  if (!show) return;

  $("endTitle").textContent = winner ? `${winner.name} survived` : "Round over";
  $("endText").textContent = winner && winner.id === playerId ? "You won the gamble." : `${winner ? winner.name : "Someone"} won the gamble.`;
  $("endStart").classList.toggle("hidden", !isAdmin);
}

function renderRoundLoad() {
  const panel = $("roundLoadPanel");
  if (!state || state.phase !== "active" || !state.round_intro_active) {
    panel.classList.add("hidden");
    roundLoadKey = "";
    return;
  }
  const live = Math.max(0, Number(state.live_remaining) || 0);
  const blank = Math.max(0, Number(state.blank_remaining) || 0);
  const total = live + blank;
  if (total <= 0) {
    panel.classList.add("hidden");
    roundLoadKey = "";
    return;
  }

  const elapsed = Math.max(0, Number(state.round_intro_elapsed_ms) || 0);
  const duration = Math.max(1, Number(state.round_intro_duration_ms) || 5200);
  const key = `${state.round}:${state.shell_index}:${live}:${blank}:${duration}`;
  panel.classList.remove("hidden");
  $("roundLoadTitle").textContent = `Round ${state.round || ""}`;
  if (roundLoadKey !== key) {
    const revealMs = Math.min(total * 430, 3500);
    const shells = [];
    for (let i = 0; i < total; i++) {
      const shellLive = i >= blank;
      const startX = Math.round((i - (total - 1) / 2) * 48 - 21);
      const groupX = Math.round((i - (total - 1) / 2) * 24 - 21);
      const delay = Math.round((i * revealMs) / total);
      shells.push(`<img class="round-load-shell" src="/images/bullets/${shellLive ? "live" : "blank"}.png" alt="" style="--start-x:${startX};--group-x:${groupX};--shell-delay:${delay}ms;">`);
    }
    $("roundLoadShells").innerHTML = shells.join("");
    roundLoadKey = key;
  }
  $("roundLoadShells").style.setProperty("--round-duration", `${duration}ms`);
  $("roundLoadShells").style.setProperty("--round-offset", `${elapsed}ms`);
}

function hideBeerEject() {
  $("beerEjectPanel").classList.add("hidden");
}

function renderBeerEject() {
  if (!state) return;
  const seq = Number(state.beer_eject_seq) || 0;
  if (!seq) {
    lastBeerEjectSeq = 0;
    hideBeerEject();
    return;
  }
  if (seq === lastBeerEjectSeq) return;

  const eventMs = Number(state.beer_eject_ms) || 0;
  const serverMillis = Number(state.millis) || 0;
  const duration = Math.max(1, Number(state.beer_eject_duration_ms) || 900);
  const elapsed = Math.max(0, serverMillis && eventMs ? serverMillis - eventMs : 0);
  lastBeerEjectSeq = seq;
  if (elapsed >= duration) {
    hideBeerEject();
    return;
  }

  const panel = $("beerEjectPanel");
  const shell = $("beerEjectShell");
  shell.src = `/images/bullets/${state.beer_eject_live ? "live" : "blank"}.png`;
  shell.style.setProperty("--beer-eject-duration", `${duration}ms`);
  shell.style.setProperty("--beer-eject-offset", `${elapsed}ms`);
  shell.style.animation = "none";
  void shell.offsetWidth;
  shell.style.animation = "";
  panel.classList.remove("hidden");
  if (beerEjectHideTimer) window.clearTimeout(beerEjectHideTimer);
  beerEjectHideTimer = window.setTimeout(hideBeerEject, duration - elapsed + 80);
}

function playShotEffect(live, playAudio) {
  if ("vibrate" in navigator) {
    navigator.vibrate(live ? [55, 28, 95, 32, 60] : [38, 22, 42]);
  }
  if (!playAudio) return;
  try {
    const audio = getShotAudio();
    audio.pause();
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // Audio can still be blocked if the browser has not accepted a gesture yet.
  }
}

function syncShotEffect() {
  if (!state || playerId < 0 || !state.you) return;

  const serverMillis = Number(state.millis) || 0;
  if (serverMillis && lastServerMillis && serverMillis + 10000 < lastServerMillis) {
    lastShotMsSeen = null;
  }
  if (serverMillis) lastServerMillis = serverMillis;

  const seq = Number(state.shot_seq) || 0;
  const shotMs = Number(state.last_shot_ms) || 0;
  if (!seq || !shotMs) {
    if (!seq) lastShotMsSeen = 0;
    return;
  }
  if (lastShotMsSeen === null) {
    lastShotMsSeen = shotMs;
    return;
  }
  if (shotMs <= lastShotMsSeen) return;

  lastShotMsSeen = shotMs;
  const shooter = Number(state.last_shot_shooter);
  const playAudio = shooter === playerId;
  const phoneDelay = Number(state.shot_phone_delay_ms) || 220;
  const offset = Number.isFinite(state._clockOffsetMs) ? state._clockOffsetMs : Date.now() - serverMillis;
  const targetLocalMs = shotMs + phoneDelay + offset;
  const delay = Math.max(0, Math.min(750, targetLocalMs - Date.now()));
  const live = Boolean(state.last_shot_live);
  window.setTimeout(() => playShotEffect(live, playAudio), delay);
}

function render() {
  if (!state) return;
  isAdmin = playerId >= 0 && state.admin === playerId;
  localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");

  const me = state.players.find((p) => p.id === playerId);
  const currentPlayer = state.players.find((p) => p.id === state.current);
  const jammed = Boolean(me && me.alive && me.jammed);
  const isMyTurn = Boolean(me && me.id === state.current && state.phase !== "lobby" && state.winner < 0 && !jammed);
  const maxLives = Math.max(3, ...state.players.map((p) => Number(p.lives) || 0));
  const pendingScanTotal = Number(state.pending_scan_total) || 0;
  if (lastPendingScanTotal > 0 && pendingScanTotal === 0) {
    nfcUsePausedUntil = Date.now() + 5000;
  }
  lastPendingScanTotal = pendingScanTotal;
  document.body.classList.toggle("dead-player", Boolean(me && !me.alive));
  document.body.classList.toggle("jammed-player", jammed);
  syncShotEffect();
  renderRoundLoad();
  renderBeerEject();
  renderEndScreen();

  const turnTitle = $("turnTitle");
  let title = "WAITING";
  let ticker = false;
  if (state.winner >= 0) {
    title = state.winner === playerId ? "YOU LIVED" : "ROUND LOST";
  } else if (state.phase !== "lobby") {
    if (jammed) {
      title = "SIGNAL JAMMED";
    } else if (isMyTurn) {
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
  $("selfAvatar").classList.toggle("hidden", !me);
  if (me) {
    $("selfAvatar").src = playerPortraitSrc(me);
  }
  $("session").textContent = `${state.phase} / ${state.ap}`;
  $("hudActions").classList.toggle("hidden", playerId < 0);
  $("shot").classList.toggle("hidden", playerId < 0 || state.phase === "lobby" || state.winner >= 0);
  $("shot").disabled = !isMyTurn || jammed;
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
    const avatar = player ? `<img class="target-avatar" src="${playerPortraitSrc(player)}" alt="">` : "<span class='target-avatar empty'></span>";
    return `<button class="target-box target-${pos}${active}"${disabled} onclick="chooseSlot(${slot})">
      ${avatar}
      <span>${label}</span>
      <small>${status}</small>
    </button>`;
  }).join("");

  $("inventory").innerHTML = items.map((name, i) => {
    const count = me ? me.inv[i] : 0;
    return `<button type="button" onclick="openItemInfo('${name}')">${itemLabel(name)} <small>${count}</small></button>`;
  }).join("");
  const pendingScans = me ? Number(me.pending_scans) || 0 : 0;
  $("scan").textContent = pendingScans > 0 ? `Scan ${pendingScans} item tag${pendingScans === 1 ? "" : "s"}` : "No item scans";
  $("scan").disabled = playerId < 0 || state.phase !== "active" || pendingScans <= 0;
  const needsScans = playerId >= 0 && state.phase === "active" && pendingScanTotal > 0;
  $("scanPanel").classList.toggle("hidden", !needsScans);
  $("scanPanel").classList.toggle("with-round-load", needsScans && Boolean(state.round_intro_active));
  document.body.classList.toggle("scan-over-round-load", needsScans && Boolean(state.round_intro_active));
  $("scanPrompt").textContent = pendingScans > 0
    ? `Scan ${pendingScans} item tag${pendingScans === 1 ? "" : "s"} to continue.`
    : "Waiting for others";
  $("scanRequired").textContent = playerNfcReader ? "NFC listening" : "Start NFC";
  $("scanRequired").disabled = playerNfcReader || !needsScans;
  if (playerId >= 0) startPlayerNfc();
}

function openTargetDialog(action, item = "") {
  targetAction = action;
  targetItem = item;
  $("targetTitle").textContent = action === "item" || action === "scanItem" ? `Use ${itemLabel(item)}` : "Shoot target";
  $("targetDialog").classList.remove("hidden");
}

window.chooseTarget = async (id) => {
  selectedTarget = id;
  $("targetDialog").classList.add("hidden");
  if (targetAction === "scanItem") {
    try {
      await submitScanPayload(pendingScanPayload, id);
    } catch (e) {
      setNfcStatus(e.message);
    }
    pendingScanPayload = "";
    pendingScanItem = "";
  } else if (targetAction === "item") {
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
  state = await api(statePath());
  if (currentJoinPath() && state.join && !isAllowedJoinPath(currentJoinPath(), state.join)) {
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

function refreshDelayMs() {
  if (demoMode) return 1500;
  if (state && state.phase === "active" && state.winner < 0) return 300;
  return 1000;
}

function scheduleRefreshLoop() {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshLoop, refreshDelayMs());
}

async function refreshLoop() {
  if (refreshing) {
    scheduleRefreshLoop();
    return;
  }
  refreshing = true;
  try {
    await refresh();
  } catch {
    // Keep the local UI alive during transient AP/HTTPS stalls.
  } finally {
    refreshing = false;
    scheduleRefreshLoop();
  }
}

async function join() {
  try {
    const name = $("name").value.trim();
    if (!name) return;
    const r = await api("/api/register", {name, join: currentJoinPath()});
    playerId = r.pid;
    isAdmin = r.admin === 1;
    playerToken = r.token || "";
    localStorage.setItem("buckshotPlayerId", String(playerId));
    localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");
    localStorage.setItem("buckshotPlayerToken", playerToken);
    localStorage.setItem("buckshotPlayerName", name);
    if (state && state.join) localStorage.setItem("buckshotJoinPath", state.join);
    $("joinStatus").textContent = "";
    await startPlayerNfc();
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
  if (item === "adrenaline") {
    openAdrenalinePanel("");
  } else if (itemNeedsTarget(item)) {
    openTargetDialog("item", item);
  } else {
    await useItemWithTarget(item, playerId);
  }
}

async function scanNfc() {
  if (needsSecureNfcContext()) {
    location.href = secureNfcUrl();
    return;
  }
  await startPlayerNfc();
}

function openNfcPanel() {
  if (needsSecureNfcContext()) {
    location.href = secureNfcUrl();
    return;
  }
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
$("endStart").onclick = start;
$("reset").onclick = reset;
$("nfcAdmin").onclick = openNfcPanel;
$("closeNfc").onclick = closeNfcPanel;
$("testNfc").onclick = testNfc;
$("writeNfc").onclick = openWriteNfcPanel;
$("cancelNfcWrite").onclick = closeWriteNfcPanel;
$("cancelAdrenaline").onclick = closeAdrenalinePanel;
$("closeTarget").onclick = () => {
  targetAction = "shot";
  targetItem = "";
  pendingScanPayload = "";
  pendingScanItem = "";
  $("targetDialog").classList.add("hidden");
};
$("debugToggle").onclick = () => $("debugPanel").classList.toggle("hidden");
$("closeDebug").onclick = () => $("debugPanel").classList.add("hidden");
$("closeItemInfo").onclick = () => $("itemInfoPanel").classList.add("hidden");
$("scan").onclick = scanNfc;
$("scanRequired").onclick = scanNfc;

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
      state = await api(statePath(-1));
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

syncJoinButton();
boot().finally(scheduleRefreshLoop);
