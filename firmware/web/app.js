const items = ["adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote"];
let playerId = Number(localStorage.getItem("buckshotPlayerId") || "-1");
let isAdmin = localStorage.getItem("buckshotAdmin") === "1";
let selectedTarget = -1;
let state = null;
let writeAbort = null;
let autoJoinInFlight = false;

const $ = (id) => document.getElementById(id);

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

function clearSession() {
  localStorage.removeItem("buckshotPlayerId");
  localStorage.removeItem("buckshotAdmin");
  playerId = -1;
  isAdmin = false;
  selectedTarget = -1;
}

function render() {
  if (!state) return;
  isAdmin = playerId >= 0 && state.admin === playerId;
  localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");
  $("session").textContent = `${state.ap} | ${state.phase}`;
  $("admin").classList.toggle("hidden", !isAdmin);
  $("writeMode").textContent = state.write_mode ? "NFC write mode is on" : "NFC write mode is off";
  $("register").classList.toggle("hidden", playerId >= 0);
  $("actions").classList.toggle("hidden", playerId < 0 || state.phase === "lobby" || state.winner >= 0);
  $("message").textContent = state.message || "";

  $("players").innerHTML = state.players.map((p) => {
    const cls = p.alive ? "player" : "player dead";
    const mark = p.id === state.current ? " <span class=pill>turn</span>" : "";
    const admin = p.admin ? " <span class=pill>admin</span>" : "";
    const me = p.id === playerId ? " <span class=pill>you</span>" : "";
    return `<div class="${cls}"><span>${p.name}${mark}${admin}${me}</span><span>${p.lives} hp</span></div>`;
  }).join("");

  $("shotgun").innerHTML = `<div class=shells><span>Shells</span><span>${state.shell_index}/${state.shell_count}</span></div>
    <div class=shells><span>Known remaining</span><span>${state.live_remaining} live / ${state.blank_remaining} blank</span></div>
    <div class=shells><span>Armed target</span><span>${state.armed_target_name || "none"}</span></div>`;

  $("targets").innerHTML = state.players.filter((p) => p.alive).map((p) => {
    const active = selectedTarget === p.id ? "active" : "";
    return `<button class="${active}" onclick="selectTarget(${p.id})">${p.name}</button>`;
  }).join("");

  const me = state.players.find((p) => p.id === playerId);
  $("inventory").innerHTML = items.map((name, i) => {
    const count = me ? me.inv[i] : 0;
    return `<button ${count ? "" : "disabled"} onclick="useItem('${name}')">${itemLabel(name)} (${count})</button>`;
  }).join("");
}

window.selectTarget = (id) => {
  selectedTarget = id;
  render();
};

async function refresh() {
  state = await api(`/api/state?pid=${playerId}`);
  if (playerId >= 0 && !state.you) {
    const savedName = localStorage.getItem("buckshotPlayerName") || "";
    clearSession();
    if (savedName && state.phase === "lobby" && !autoJoinInFlight) {
      autoJoinInFlight = true;
      try {
        await join(savedName);
        return;
      } catch (e) {
        state.message = e.message;
      } finally {
        autoJoinInFlight = false;
      }
    }
  }
  render();
}

async function join(nameOverride) {
  const name = (nameOverride || $("name").value).trim() || `P${Math.floor(Math.random() * 100)}`;
  const r = await api("/api/register", {name});
  playerId = r.pid;
  isAdmin = r.admin === 1;
  localStorage.setItem("buckshotPlayerId", String(playerId));
  localStorage.setItem("buckshotAdmin", isAdmin ? "1" : "0");
  localStorage.setItem("buckshotPlayerName", name);
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
  clearSession();
  await refresh();
}

async function toggleWriteMode() {
  await api("/api/write-mode", {pid: playerId});
  await refresh();
}

async function arm(target) {
  await api("/api/arm", {pid: playerId, target});
  await refresh();
}

async function useItem(item) {
  await api("/api/item", {pid: playerId, item, target: selectedTarget});
  await refresh();
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
$("join").onclick = () => join();
$("saveSetup").onclick = setup;
$("start").onclick = start;
$("reset").onclick = reset;
$("toggleWriteMode").onclick = toggleWriteMode;
$("armSelf").onclick = () => arm(playerId);
$("armTarget").onclick = () => arm(selectedTarget);
$("scan").onclick = scanNfc;
$("cancelWrite").onclick = cancelWrite;
$("writer").innerHTML = items.map((item) => `<button onclick="writeItem('${item}')">${itemLabel(item)}</button>`).join("");
$("name").value = localStorage.getItem("buckshotPlayerName") || "";

refresh().catch((e) => $("message").textContent = e.message);
setInterval(() => refresh().catch(() => {}), 1500);
