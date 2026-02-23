/* Facechinko Web App (single-page)
   - Join (code + name) -> validate via HTTP /game-status
   - Team select (14 teams)
   - Register via WebSocket playerJoin (with teamIndex)
   - Waiting with ball preview
   - Result on gameResult (win team shows MVP name)
*/

"use strict";

/** =========================
 *  CONFIG
 *  ========================= */
const WS_URL = "wss://api.prologuebymetama.com/ws";
const GAME_TYPE = "facechinko";
const TEAM_COUNT = 14;

// Derived HTTP base (used for /game-status validation)
const HTTP_BASE = wsToHttpBase(WS_URL); // e.g. https://api.prologuebymetama.com

// Storage keys
const K_UID = "fc.uid";
const K_SESSION = "fc.session"; // { code, name, teamIndex, resumeToken, phase, winningTeamIndex, mvpName }

/** =========================
 *  TEAM DATA
 *  ========================= */
const TEAM_COLORS = [
  "rgb(242,66,54)",  "rgb(232,31,99)",  "rgb(156,39,176)", "rgb(102,59,184)",
  "rgb(64,82,181)",  "rgb(33,150,243)", "rgb(3,169,244)",  "rgb(0,188,212)",
  "rgb(0,151,136)",  "rgb(76,175,80)",  "rgb(140,194,74)", "rgb(255,153,0)",
  "rgb(255,87,34)",  "rgb(120,84,71)"
];

function teamLabel(teamIndex) {
  return `TEAM ${teamIndex + 1}`;
}

/** =========================
 *  DOM
 *  ========================= */
const ViewJoin = document.getElementById("ViewJoin");
const ViewTeam = document.getElementById("ViewTeam");
const ViewWaiting = document.getElementById("ViewWaiting");
const ViewResult = document.getElementById("ViewResult");
const ViewEnded = document.getElementById("ViewEnded");

const StatusLine = document.getElementById("StatusLine");
const PillCode = document.getElementById("PillCode");
const PillUid = document.getElementById("PillUid");

const JoinForm = document.getElementById("JoinForm");
const RoomCodeInput = document.getElementById("RoomCodeInput");
const NameInput = document.getElementById("NameInput");
const JoinBtn = document.getElementById("JoinBtn");
const JoinError = document.getElementById("JoinError");

const TeamGrid = document.getElementById("TeamGrid");
const BackToJoinBtn = document.getElementById("BackToJoinBtn");
const ConfirmTeamBtn = document.getElementById("ConfirmTeamBtn");
const TeamError = document.getElementById("TeamError");

const BallPreview = document.getElementById("BallPreview");
const BallName = document.getElementById("BallName");
const BallTeam = document.getElementById("BallTeam");
const ConnDetails = document.getElementById("ConnDetails");
const ReconnectBtn = document.getElementById("ReconnectBtn");
const ResetBtn = document.getElementById("ResetBtn");

const ResultTitle = document.getElementById("ResultTitle");
const ResultSub = document.getElementById("ResultSub");
const WinningTeamText = document.getElementById("WinningTeamText");
const MvpNameText = document.getElementById("MvpNameText");
const YourTeamText = document.getElementById("YourTeamText");
const PlayAgainBtn = document.getElementById("PlayAgainBtn");

const EndedResetBtn = document.getElementById("EndedResetBtn");

/** =========================
 *  STATE
 *  ========================= */
const uid = getOrCreateUid();
let ws = null;
let wsOpen = false;

let session = loadSession() || {
  code: "",
  name: "",
  teamIndex: null,
  resumeToken: "",
  phase: "unknown",
  winningTeamIndex: null,
  mvpName: ""
};

let selectedTeamIndex = null;

/** =========================
 *  INIT
 *  ========================= */
boot();

function boot() {
  // Prefill uid pill
  PillUid.textContent = `UID: ${uid.slice(0, 8)}`;

  // Prefill code from query
  const url = new URL(window.location.href);
  const qCode = (url.searchParams.get("code") || "").trim();
  if (qCode) RoomCodeInput.value = qCode.toUpperCase();

  // Build team grid once
  renderTeamGrid();

  // Wire events
  JoinForm.addEventListener("submit", onJoinSubmit);
  BackToJoinBtn.addEventListener("click", () => {
    show(ViewJoin);
    setError(TeamError, "");
  });
  ConfirmTeamBtn.addEventListener("click", onConfirmTeam);
  ReconnectBtn.addEventListener("click", () => reconnect(true));
  ResetBtn.addEventListener("click", hardReset);
  PlayAgainBtn.addEventListener("click", hardReset);
  EndedResetBtn.addEventListener("click", hardReset);

  // Restore previous session if any
  if (session.code && session.name) {
    // If we already have teamIndex, go waiting and try resume/join
    PillCode.textContent = `CODE: ${session.code}`;
    if (typeof session.teamIndex === "number") {
      applyBallPreview(session.name, session.teamIndex);
      show(ViewWaiting);
      setStatus(`Reconnecting to ${session.code}…`);
      reconnect(false);
      return;
    }

    // If no team yet, go to team select
    RoomCodeInput.value = session.code;
    NameInput.value = session.name;
    show(ViewTeam);
    setStatus(`Continue setup…`);
    return;
  }

  // Default: join view
  show(ViewJoin);
  setStatus("Ready");
}

function renderTeamGrid() {
  TeamGrid.innerHTML = "";
  for (let i = 0; i < TEAM_COUNT; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team-btn";
    btn.dataset.teamIndex = String(i);

    const swatch = document.createElement("div");
    swatch.className = "team-swatch";
    swatch.style.background = TEAM_COLORS[i];

    const name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamLabel(i);

    const id = document.createElement("div");
    id.className = "team-id";
    id.textContent = `ID: ${i}`;

    btn.appendChild(swatch);
    btn.appendChild(name);
    btn.appendChild(id);

    btn.addEventListener("click", () => {
      selectedTeamIndex = i;
      // UI selection
      [...TeamGrid.querySelectorAll(".team-btn")].forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      ConfirmTeamBtn.disabled = false;
      setError(TeamError, "");
    });

    TeamGrid.appendChild(btn);
  }
}

/** =========================
 *  FLOW: JOIN -> TEAM
 *  ========================= */
async function onJoinSubmit(e) {
  e.preventDefault();
  setError(JoinError, "");

  const code = lettersOnly(RoomCodeInput.value).slice(0, 8);
  const name = sanitizeName(NameInput.value);

  if (code.length < 4) return setError(JoinError, "Room code must be at least 4 letters.");
  if (name.length < 2) return setError(JoinError, "Name must be at least 2 characters.");

  JoinBtn.disabled = true;

  try {
    // Validate session exists via HTTP
    setStatus("Validating room…");
    const ok = await validateRoom(code);

    if (!ok.ok) {
      JoinBtn.disabled = false;
      return setError(JoinError, ok.error || "Room code not found / not active.");
    }

    // Store partial session (no team yet)
    session.code = code;
    session.name = name;
    session.teamIndex = null;
    session.phase = ok.phase || "join";
    session.resumeToken = session.resumeToken || "";
    saveSession(session);

    PillCode.textContent = `CODE: ${code}`;
    setStatus("Choose your team");
    show(ViewTeam);
  } catch (err) {
    JoinBtn.disabled = false;
    setError(JoinError, String(err && err.message ? err.message : err));
  } finally {
    JoinBtn.disabled = false;
  }
}

async function validateRoom(code) {
  // We assume /game-status exists (your standard backend)
  const url = `${HTTP_BASE}/game-status?code=${encodeURIComponent(code)}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  const data = await res.json();

  // Expected-ish shape: { ok:true, exists:true, phase:"join", gameType:"facechinko", location:"..." }
  // We'll accept as long as it exists and gameType matches (if provided).
  if (data && (data.ok === false)) return { ok: false, error: data.error || "Not ok" };

  const exists = (data && (data.exists === true || data.found === true || data.ok === true));
  if (!exists) return { ok: false, error: data.error || "Room not found" };

  if (data.gameType && String(data.gameType).toLowerCase() !== GAME_TYPE) {
    return { ok: false, error: `Wrong game type (expected ${GAME_TYPE}).` };
  }

  // Optional: if backend returns ended
  if (data.phase && String(data.phase).toLowerCase() === "ended") {
    return { ok: false, error: "Game already ended." };
  }

  return { ok: true, phase: data.phase || "join" };
}

/** =========================
 *  FLOW: TEAM -> REGISTER
 *  ========================= */
function onConfirmTeam() {
  setError(TeamError, "");

  if (selectedTeamIndex == null) {
    return setError(TeamError, "Please select a team.");
  }

  session.teamIndex = selectedTeamIndex;
  saveSession(session);

  applyBallPreview(session.name, session.teamIndex);

  setStatus("Registering player…");
  show(ViewWaiting);

  reconnect(true);
}

/** =========================
 *  WS CONNECT + REGISTER/RESUME
 *  ========================= */
function reconnect(forceClose) {
  if (!session.code || !session.name || typeof session.teamIndex !== "number") {
    setStatus("Missing setup. Go back and enter code/name/team.");
    show(ViewJoin);
    return;
  }

  if (forceClose) closeWs();

  if (ws && wsOpen) {
    // If already open, just re-send join/resume
    registerOrResume();
    return;
  }

  openWs();
}

function openWs() {
  closeWs();

  setStatus("Connecting…");

  ws = new WebSocket(WS_URL);
  wsOpen = false;

  ws.onopen = () => {
    wsOpen = true;
    setStatus("Connected");
    updateConnDetails("WS connected. Registering…");
    registerOrResume();
  };

  ws.onclose = () => {
    wsOpen = false;
    updateConnDetails("WS disconnected.");
    setStatus("Disconnected");
  };

  ws.onerror = () => {
    wsOpen = false;
    updateConnDetails("WS error.");
    setStatus("Connection error");
  };

  ws.onmessage = (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handleWsMessage(msg);
  };
}

function closeWs() {
  try {
    if (ws) ws.close();
  } catch (_) {}
  ws = null;
  wsOpen = false;
}

function registerOrResume() {
  // Best-effort resume if token exists, else join
  if (session.resumeToken) {
    sendWs({
      type: "playerResume",
      gameType: GAME_TYPE,
      code: session.code,
      uid,
      username: session.name,
      teamIndex: session.teamIndex,
      resumeToken: session.resumeToken
    });
    updateConnDetails("Sent playerResume…");
    return;
  }

  sendWs({
    type: "playerJoin",
    gameType: GAME_TYPE,
    code: session.code,
    uid,
    username: session.name,
    teamIndex: session.teamIndex
  });
  updateConnDetails("Sent playerJoin…");
}

function sendWs(obj) {
  if (!ws || !wsOpen) return;
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

/** =========================
 *  INBOUND HANDLING
 *  ========================= */
function handleWsMessage(msg) {
  const type = msg && msg.type ? String(msg.type) : "";
  if (!type) return;

  // Player lifecycle
  if (type === "playerRegistered" || type === "playerJoined" || type === "playerResumed") {
    // Backend may echo/attach a resumeToken
    if (msg.resumeToken && !session.resumeToken) {
      session.resumeToken = String(msg.resumeToken);
      saveSession(session);
    }

    // Backend may return the final player object
    const p = msg.player || null;
    if (p && typeof p.teamIndex === "number") {
      session.teamIndex = p.teamIndex;
      saveSession(session);
      applyBallPreview(session.name, session.teamIndex);
    }

    // Snapshot/phase might be included
    if (msg.phase) {
      session.phase = String(msg.phase);
      saveSession(session);
      onPhase(session.phase);
    }

    updateConnDetails(`${type} received.`);
    return;
  }

  // Backend "unityMsg" envelope may contain phase changes
  if (type === "unityMsg" && msg.payload && msg.payload.kind === "phase") {
    const phase = String(msg.payload.phase || "");
    if (phase) {
      session.phase = phase;
      saveSession(session);
      onPhase(phase);
      updateConnDetails(`Phase: ${phase}`);
    }
    return;
  }

  // Some backends send plain {type:"phase",phase:"active"}
  if (type === "phase") {
    const phase = String(msg.phase || "");
    if (phase) {
      session.phase = phase;
      saveSession(session);
      onPhase(phase);
      updateConnDetails(`Phase: ${phase}`);
    }
    return;
  }

  // Result
  if (type === "gameResult") {
    const winningTeamIndex = typeof msg.winningTeamIndex === "number" ? msg.winningTeamIndex : null;
    const mvpName = msg.mvpName ? String(msg.mvpName) : "";

    session.winningTeamIndex = winningTeamIndex;
    session.mvpName = mvpName;
    session.phase = "ended";
    saveSession(session);

    showResult(winningTeamIndex, mvpName);
    return;
  }

  // Paused / ended
  if (type === "paused") {
    const reason = msg.reason ? String(msg.reason) : "paused";
    setStatus("Paused");
    showEnded("Paused", reason);
    return;
  }

  if (type === "ended") {
    setStatus("Ended");
    showEnded("Game ended", "Please refresh or enter a new code.");
    return;
  }
}

function onPhase(phase) {
  const p = String(phase || "").toLowerCase();
  if (!p) return;

  if (p === "join") {
    setStatus("Lobby (joining)");
    // Stay waiting if already registered
    return;
  }

  if (p === "active") {
    setStatus("Game in progress");
    return;
  }

  if (p === "ended") {
    setStatus("Ended");
    return;
  }
}

/** =========================
 *  UI HELPERS
 *  ========================= */
function show(viewEl) {
  // Hide all
  ViewJoin.hidden = true;
  ViewTeam.hidden = true;
  ViewWaiting.hidden = true;
  ViewResult.hidden = true;
  ViewEnded.hidden = true;

  viewEl.hidden = false;
}

function setStatus(text) {
  StatusLine.textContent = text || "";
}

function updateConnDetails(text) {
  const parts = [];
  parts.push(`WS: ${wsOpen ? "OPEN" : "CLOSED"}`);
  if (session && session.phase) parts.push(`PHASE: ${session.phase}`);
  if (text) parts.push(text);
  ConnDetails.textContent = parts.join(" • ");
}

function setError(el, msg) {
  if (!el) return;
  const clean = (msg || "").trim();
  if (!clean) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = clean;
}

function applyBallPreview(name, teamIndex) {
  BallName.textContent = name || "—";
  BallTeam.textContent = teamLabel(teamIndex);
  BallPreview.style.background = TEAM_COLORS[teamIndex] || "rgba(255,255,255,0.12)";
}

function showResult(winningTeamIndex, mvpName) {
  show(ViewResult);

  const yourTeam = typeof session.teamIndex === "number" ? session.teamIndex : null;
  const yourTeamText = yourTeam != null ? teamLabel(yourTeam) : "—";
  const winningText = (typeof winningTeamIndex === "number") ? teamLabel(winningTeamIndex) : "—";

  WinningTeamText.textContent = winningText;
  MvpNameText.textContent = mvpName || "—";
  YourTeamText.textContent = yourTeamText;

  const won = (yourTeam != null && typeof winningTeamIndex === "number" && yourTeam === winningTeamIndex);

  if (won) {
    ResultTitle.textContent = "YOUR TEAM WON!";
    ResultSub.textContent = mvpName ? `MVP: ${mvpName}` : "Your team is the winner!";
  } else {
    ResultTitle.textContent = "You Lose";
    ResultSub.textContent = mvpName ? `Winning MVP: ${mvpName}` : "Better luck next time!";
  }

  setStatus("Result");
}

function showEnded(title, sub) {
  show(ViewEnded);
  document.getElementById("EndedTitle").textContent = title || "Game ended";
  document.getElementById("EndedSub").textContent = sub || "Please refresh.";
}

function hardReset() {
  closeWs();
  session = { code: "", name: "", teamIndex: null, resumeToken: "", phase: "unknown", winningTeamIndex: null, mvpName: "" };
  saveSession(session);
  selectedTeamIndex = null;

  PillCode.textContent = "CODE: —";
  setStatus("Ready");

  // Clear UI selections
  [...TeamGrid.querySelectorAll(".team-btn")].forEach((el) => el.classList.remove("selected"));
  ConfirmTeamBtn.disabled = true;

  show(ViewJoin);
}

/** =========================
 *  UTIL
 *  ========================= */
function getOrCreateUid() {
  const existing = localStorage.getItem(K_UID);
  if (existing && existing.length >= 10) return existing;

  const u = "fc_" + cryptoRandomId(20);
  localStorage.setItem(K_UID, u);
  return u;
}

function saveSession(obj) {
  try { localStorage.setItem(K_SESSION, JSON.stringify(obj)); } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(K_SESSION);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function lettersOnly(str) {
  return String(str || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function sanitizeName(str) {
  return String(str || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function cryptoRandomId(len) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function wsToHttpBase(wsUrl) {
  // wss://host/ws -> https://host
  // ws://host/ws -> http://host
  const u = new URL(wsUrl);
  const proto = u.protocol === "wss:" ? "https:" : "http:";
  return `${proto}//${u.host}`;
}