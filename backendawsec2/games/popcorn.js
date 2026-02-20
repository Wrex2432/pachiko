// games/popcorn.js
// Flavor Frenzy (formerly popcorn) adapter
// Handles team assignment, phase transitions, shake relays, winner tier awarding

/* ===========================
   Helpers
=========================== */

function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  } catch (_) {}
}

function broadcastToPlayers(session, obj) {
  const json = JSON.stringify(obj);
  for (const pid of Object.keys(session.players || {})) {
    const p = session.players[pid];
    try {
      if (p.ws && p.ws.readyState === 1) p.ws.send(json);
    } catch (_) {}
  }
}

function broadcastToUnity(session, obj) {
  safeSend(session.unity?.ws, obj);
}

/* ===========================
   Team assignment
=========================== */

function getTeamSizes(state) {
  const sizes = [];
  for (let i = 0; i < state.teamCount; i++) {
    const arr = state.teams[i] || [];
    sizes.push(arr.length);
  }
  return sizes;
}

function pickLeastFilledRoundRobin(state) {
  const sizes = getTeamSizes(state);
  const minSize = Math.min(...sizes);
  const candidates = [];
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] === minSize) candidates.push(i);
  }

  let pick = candidates[0];
  if (candidates.includes(state.nextTeamPtr)) {
    const idx = candidates.indexOf(state.nextTeamPtr);
    pick = candidates[idx];
    const nextIdx = (idx + 1) % candidates.length;
    state.nextTeamPtr = candidates[nextIdx];
  } else {
    pick = candidates[0];
    const nextIdx = (0 + 1) % candidates.length;
    state.nextTeamPtr = candidates[nextIdx];
  }
  return pick;
}

function pickTeamIndexForJoin(state, usernameLower, seatId) {
  const mode = state.teamAssignmentMode || "roundRobin";

  for (let i = 0; i < state.teamCount; i++) {
    if (!state.teams[i]) state.teams[i] = [];
  }

  if (mode === "seatPinned") {
    if (seatId) {
      const key = String(seatId).trim().toUpperCase();
      if (Object.prototype.hasOwnProperty.call(state.seatToTeam, key)) {
        return state.seatToTeam[key];
      }
    }
    return pickLeastFilledRoundRobin(state);
  }

  // "roundRobin" (default)
  return pickLeastFilledRoundRobin(state);
}

/**
 * NOTE: Currently not used at runtime.
 * We intentionally DO NOT rebalance teams after someone leaves,
 * so that team membership stays stable for the entire game and
 * winner awarding does not "mix" teams.
 */
function normalizeTeams(state) {
  const { teamCount, teamAssignmentMode, nameToSeat, seatToTeam } = state;

  const flat = [];
  for (let i = 0; i < teamCount; i++) {
    const arr = state.teams[i] || [];
    for (const uname of arr) flat.push(uname);
  }

  const teams = Array.from({ length: teamCount }, () => []);
  state.assignment = {};
  state.nextTeamPtr = 0;

  for (const u of flat) {
    const key = u.toLowerCase();
    let tIdx = null;

    if (teamAssignmentMode === "seatPinned") {
      const seat = nameToSeat?.[key];
      if (seat) {
        const seatKey = String(seat).trim().toUpperCase();
        if (Object.prototype.hasOwnProperty.call(seatToTeam, seatKey)) {
          tIdx = seatToTeam[seatKey];
        }
      }
      if (tIdx == null) tIdx = pickLeastFilledRoundRobin(state);
    } else {
      tIdx = pickLeastFilledRoundRobin(state);
    }

    teams[tIdx].push(u);
    state.assignment[key] = tIdx;
  }

  state.teams = teams;
}

/* ===========================
   Winner tier awarding
   (winTop1, winTopUnder, winStandard)
=========================== */

/**
 * Compute tiers for a winning team using shake scores + config:
 * - winTop1: ranks 1 .. (winTopUnderStart - 1)
 * - winTopUnder: ranks winTopUnderStart .. winTopUnderMax
 * - winStandard: ranks > winTopUnderMax
 */
function _awardTiersToWinningTeam(session, teamIndex) {
  const st = session.state;
  const team = (st.teams && st.teams[teamIndex]) ? st.teams[teamIndex] : [];
  if (!Array.isArray(team) || team.length === 0) return;

  st.lastAwards = st.lastAwards || {};
  st.shakeScores = st.shakeScores || {};

  // Parse config from state (numbers as strings from control.json)
  let startRaw = st.winTopUnderStart;
  let maxRaw = st.winTopUnderMax;

  let winTopUnderStart = parseInt(startRaw, 10);
  let winTopUnderMax = parseInt(maxRaw, 10);

  if (!Number.isFinite(winTopUnderStart) || winTopUnderStart < 2) {
    // Ensure at least rank 1 is winTop1; start can't be 1 or less
    winTopUnderStart = 2;
  }
  if (!Number.isFinite(winTopUnderMax) || winTopUnderMax < winTopUnderStart) {
    winTopUnderMax = winTopUnderStart;
  }

  // Build ranking list for this team
  const ranked = team.map((username) => {
    const key = String(username).toLowerCase();
    const shakes = st.shakeScores[key] || 0;
    return { username, key, shakes };
  });

  // Sort descending by shakes (ties broken by original order)
  ranked.sort((a, b) => b.shakes - a.shakes);

  const now = Date.now();
  const winnersSummary = [];

  for (let i = 0; i < ranked.length; i++) {
    const rank = i + 1;
    const { username, key, shakes } = ranked[i];

    let tier;
    if (rank < winTopUnderStart) {
      tier = "winTop1";
    } else if (rank >= winTopUnderStart && rank <= winTopUnderMax) {
      tier = "winTopUnder";
    } else {
      tier = "winStandard";
    }

    // Record last award per player
    st.lastAwards[key] = {
      teamIndex,
      tier,
      shakes,
      at: now,
      voucher: null, // reserved for future if you reintroduce codes
    };

    winnersSummary.push({ username, tier, shakes });

    // Send winner tier to active player socket (if connected)
    for (const [pid, p] of Object.entries(session.players || {})) {
      if (
        p.username &&
        p.username.toLowerCase() === key &&
        p.ws &&
        p.ws.readyState === 1
      ) {
        safeSend(p.ws, {
          type: "voucher",   // keep existing message type so web app logic still fires
          teamIndex,
          code: null,        // no actual voucher code for now
          tier,              // "winTop1" | "winTopUnder" | "winStandard"
          shakes,
          note: "congrats",
        });
      }
    }
  }

  // Notify Unity with a summary of winners + tiers
  broadcastToUnity(session, {
    type: "winnersAwarded",
    teamIndex,
    winners: winnersSummary,
    snapshot: snapshot(session),
  });

  // Optional public broadcast to all players (web app may ignore this)
  broadcastToPlayers(session, {
    type: "winnersPublic",
    teamIndex,
    winners: winnersSummary,
  });

  session.phase = "ended";
}

/* ===========================
   Snapshot
=========================== */

function snapshot(session) {
  const st = session.state;
  const names = st.teamNames || [];
  const counts = (st.teams || []).map((arr) => (arr ? arr.length : 0));
  const teamsCopy = (st.teams || []).map((arr) => (arr ? arr.slice() : []));

  return {
    code: session.code,
    teamCount: st.teamCount,
    allowedNumberOfPlayers: session.allowedNumberOfPlayers,
    phase: session.phase,
    teams: teamsCopy,
    counts,
    playersTotal: Object.keys(session.players || {}).length,
    voucherRemaining: Array.isArray(st.voucherPool) ? st.voucherPool.length : 0,
    teamNames: names,
    teamAssignmentMode: st.teamAssignmentMode || "roundRobin",
  };
}

/* ===========================
   Adapter entry points
=========================== */

module.exports = {
  onInit(cfg) {
    const seatToTeam = {};
    if (Array.isArray(cfg.teamA_playerSeat)) {
      for (const s of cfg.teamA_playerSeat) {
        seatToTeam[String(s).trim().toUpperCase()] = 0;
      }
    }
    if (Array.isArray(cfg.teamB_playerSeat)) {
      for (const s of cfg.teamB_playerSeat) {
        seatToTeam[String(s).trim().toUpperCase()] = 1;
      }
    }

    const mode = (cfg.teamAssignmentMode || "roundRobin").toString().trim();
    const VALID = new Set(["roundRobin", "seatPinned"]);
    const teamAssignmentMode = VALID.has(mode) ? mode : "roundRobin";
    const teamCount = Math.max(2, cfg.teamCount || 2);

    return {
      code: cfg.code,
      teamCount,
      allowedNumberOfPlayers: cfg.allowedNumberOfPlayers,
      voucherPool: Array.isArray(cfg.voucherPool) ? cfg.voucherPool.slice() : [],
      teams: Array.from({ length: teamCount }, () => []),
      assignment: {},
      nextTeamPtr: 0,
      seatToTeam,
      nameToSeat: {},
      teamNames: [
        cfg.teamA_name || "TEAM A",
        cfg.teamB_name || "TEAM B",
      ],
      teamAssignmentMode,
      lastAwards: {},
      // NEW: per-player shake scores (usernameLower -> total)
      shakeScores: {},
      // NEW: tier config coming from control.json (as strings)
      winTopUnderStart: cfg.winTopUnderStart || "2",
      winTopUnderMax: cfg.winTopUnderMax || "10",
    };
  },

  onPlayerJoin(session, clientId, seatId) {
    const st = session.state;
    const p = session.players[clientId];
    if (!p) return;

    const uname = String(p.username);
    const unameLower = uname.toLowerCase();

    const seatKey = (seatId ? String(seatId).trim().toUpperCase() : null);
    if (seatKey) st.nameToSeat[unameLower] = seatKey;
    else if (!Object.prototype.hasOwnProperty.call(st.nameToSeat, unameLower)) {
      st.nameToSeat[unameLower] = null;
    }

    const teamIndex = pickTeamIndexForJoin(st, unameLower, seatKey);
    p.teamIndex = teamIndex;

    if (!st.teams[teamIndex]) st.teams[teamIndex] = [];
    st.teams[teamIndex].push(uname);
    st.assignment[unameLower] = teamIndex;

    broadcastToUnity(session, {
      type: "playerJoined",
      username: uname,
      teamIndex,
      snapshot: snapshot(session),
    });

    const teamName = st.teamNames?.[teamIndex] ?? `TEAM ${teamIndex + 1}`;
    safeSend(p.ws, { type: "joined", teamIndex, teamName });

    const prev = st.lastAwards?.[unameLower];
    if (prev) {
      // Resend tier-based "voucher" if they already had one
      safeSend(p.ws, {
        type: "voucher",
        teamIndex: prev.teamIndex,
        code: prev.voucher ?? null,
        tier: prev.tier,
        shakes: prev.shakes,
        note: "resend",
      });
    }
  },

  // resumable path – put player back to the SAME team without rebalancing
  onPlayerResume(session, clientId, resumeData) {
    const st = session.state;
    const p = session.players[clientId];
    if (!p || !resumeData) return;

    const uname = String(resumeData.username);
    const unameLower = uname.toLowerCase();
    const teamIndex = Number.isInteger(resumeData.teamIndex)
      ? resumeData.teamIndex
      : 0;

    // update seat memory
    const seatKey = (resumeData.seat
      ? String(resumeData.seat).trim().toUpperCase()
      : null);
    if (seatKey) st.nameToSeat[unameLower] = seatKey;

    // if already present in any roster, strip it first (defensive)
    for (let i = 0; i < st.teamCount; i++) {
      const arr = st.teams[i];
      if (!arr) continue;
      const ix = arr.indexOf(uname);
      if (ix !== -1) arr.splice(ix, 1);
    }

    // lock to same team
    p.teamIndex = teamIndex;
    if (!st.teams[teamIndex]) st.teams[teamIndex] = [];
    st.teams[teamIndex].push(uname);
    st.assignment[unameLower] = teamIndex;

    // notify unity and player
    broadcastToUnity(session, {
      type: "playerJoined",
      username: uname,
      teamIndex,
      snapshot: snapshot(session),
    });

    const teamName = st.teamNames?.[teamIndex] ?? `TEAM ${teamIndex + 1}`;
    safeSend(p.ws, { type: "joined", teamIndex, teamName });

    // if they had a tier already, resend
    const prev = st.lastAwards?.[unameLower];
    if (prev) {
      safeSend(p.ws, {
        type: "voucher",
        teamIndex: prev.teamIndex,
        code: prev.voucher ?? null,
        tier: prev.tier,
        shakes: prev.shakes,
        note: "resend",
      });
    }
  },

  onPlayerLeave(session, clientId) {
    const st = session.state;
    const p = session.players[clientId];
    if (!p) return;

    const uname = String(p.username);
    const unameLower = uname.toLowerCase();
    const tIdx = p.teamIndex;

    // Remove them from their current team roster
    if (tIdx != null && st.teams[tIdx]) {
      st.teams[tIdx] = st.teams[tIdx].filter((u) => u !== uname);
    }

    // Clear assignment – they no longer participate in the game
    //delete st.assignment[unameLower];

    // IMPORTANT:
    // We DO NOT call normalizeTeams() here anymore.
    // No rebalancing after someone leaves, to avoid mixing teams
    // and messing up winner calculations.

    broadcastToUnity(session, {
      type: "playerLeft",
      username: uname,
      snapshot: snapshot(session),
    });
  },

  onPlayerMsg(session, clientId, payload) {
    const st = session.state;
    const p = session.players[clientId];
    if (!p) return;

    const unameLower = p.username.toLowerCase();

    if (payload && payload.kind === "voucherRequest") {
      const award = st.lastAwards?.[unameLower];
      if (award) {
        safeSend(p.ws, {
          type: "voucher",
          teamIndex: award.teamIndex,
          code: award.voucher ?? null,
          tier: award.tier,
          shakes: award.shakes,
          note: "resend",
        });
      }
      return;
    }

    if (payload && payload.kind === "shake") {
      if (session.phase !== "active") return;

      // Track shakes on backend for ranking
      const intensity =
        typeof payload.intensity === "number" && payload.intensity > 0
          ? payload.intensity
          : 1;
      st.shakeScores = st.shakeScores || {};
      st.shakeScores[unameLower] =
        (st.shakeScores[unameLower] || 0) + intensity;

      // Forward to Unity as before
      broadcastToUnity(session, {
        type: "shake",
        username: p.username,
        teamIndex: p.teamIndex,
        on: !!payload.on,
        intensity: payload.intensity,
      });
      return;
    }
  },

  onUnityMsg(session, payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.kind === "phase") {
      const phase = payload.phase;
      if (phase === "active") {
        session.phase = "active";
        broadcastToPlayers(session, { type: "phase", phase: "active" });
      }
      return;
    }

    if (payload.kind === "requestSnapshot") {
      safeSend(session.unity?.ws, {
        type: "state",
        snapshot: snapshot(session),
      });
      return;
    }

    if (payload.kind === "announce") {
      const text = payload.text || "";
      broadcastToPlayers(session, { type: "announce", text });
      return;
    }

    if (payload.kind === "gameOver") {
      const { winnerTeamIndex } = payload;
      if (typeof winnerTeamIndex === "number") {
        _awardTiersToWinningTeam(session, winnerTeamIndex);
        session.phase = "ended";
        broadcastToPlayers(session, { type: "phase", phase: "ended" });
      }
      return;
    }

    if (payload.kind === "devWin") {
      const { teamIndex } = payload;
      if (typeof teamIndex === "number") {
        _awardTiersToWinningTeam(session, teamIndex);
        session.phase = "ended";
        broadcastToPlayers(session, { type: "phase", phase: "ended" });
      }
      return;
    }
  },

  snapshot,
};