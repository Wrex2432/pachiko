function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  } catch (_) {}
}

function broadcastToPlayers(session, obj) {
  const json = JSON.stringify(obj);
  for (const p of Object.values(session.players || {})) {
    try {
      if (p.ws && p.ws.readyState === 1) p.ws.send(json);
    } catch (_) {}
  }
}

function nowIso() {
  return new Date().toISOString();
}

function timestampCompact() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function getS3BucketName(session) {
  return (
    session?.s3Bucket ||
    process.env.S3_BUCKET_NAME ||
    process.env.CINEMAGAMES_S3_BUCKET ||
    process.env.AWS_BUCKET_NAME ||
    ""
  ).trim();
}

async function uploadJsonToS3({ bucket, key, bodyObj }) {
  if (!bucket) return { ok: false, reason: "missing_bucket" };

  let S3Client, PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"));
  } catch (_) {
    return { ok: false, reason: "missing_sdk" };
  }

  const client = new S3Client({
    region: (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1").trim(),
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(bodyObj, null, 2), "utf-8"),
        ContentType: "application/json; charset=utf-8",
      })
    );
    return { ok: true, bucket, key };
  } catch (e) {
    return { ok: false, reason: e?.message || "upload_failed" };
  }
}

function ensureState(session) {
  if (!session.state || typeof session.state !== "object") session.state = {};
  const st = session.state;

  st.teamCount = FACECHINKO_TEAMS.length;
  if (!Array.isArray(st.teams)) st.teams = Array.from({ length: FACECHINKO_TEAMS.length }, (_, i) => ({
    teamIndex: i,
    teamId: i + 1,
    name: FACECHINKO_TEAMS[i].name,
    color: FACECHINKO_TEAMS[i].color,
    players: [],
  }));

  if (!st.playersByUid) st.playersByUid = {};
  if (!st.uidByNameKey) st.uidByNameKey = {};
  if (!st.mvpUid) st.mvpUid = null;
  if (!st.winningTeamIndex && st.winningTeamIndex !== 0) st.winningTeamIndex = null;
  if (!st.startedAt) st.startedAt = null;
  if (!st.endedAt) st.endedAt = null;

  return st;
}

const FACECHINKO_TEAMS = [
  { name: "Team Dana & Greggy", color: "#FFA500" },
  { name: "Team Mond & Saeid", color: "#008000" },
  { name: "Team Jill & Alvin", color: "#0000FF" },
  { name: "Team Sam & Ninya", color: "#800080" },
  { name: "Team Ynna", color: "#FFDF00" },
  { name: "Team Jasper", color: "#4B0082" },
  { name: "Team Jordy", color: "#00A86B" },
  { name: "Team MEDIA", color: "#FFEFD5" },
  { name: "Team STRAT", color: "#4169E1" },
  { name: "Team HR & ADMIN", color: "#F4D23C" },
  { name: "Team FINANCE", color: "#32CD32" },
  { name: "Team Micco", color: "#89CFF0" },
  { name: "Team Bev", color: "#FF0000" },
].map((team, idx) => ({ teamId: idx + 1, ...team }));

function rosterSnapshot(session) {
  const st = ensureState(session);
  const teams = FACECHINKO_TEAMS.map((t, i) => ({
    ...t,
    players: Object.values(st.playersByUid)
      .filter((p) => p.teamIndex === i)
      .map((p) => ({ uid: p.uid, name: p.name })),
  }));
  return {
    code: session.code,
    gameType: session.gameType,
    phase: session.phase,
    location: session.location,
    teams,
    winningTeamIndex: st.winningTeamIndex,
    mvpUid: st.mvpUid,
  };
}

function upsertPlayer(st, player) {
  const nameKey = String(player.name || "").trim().toLowerCase();
  if (!nameKey) return null;

  const existingUid = st.uidByNameKey[nameKey];
  const uid = player.uid || existingUid || `fc_${Math.random().toString(36).slice(2, 12)}`;

  const existing = st.playersByUid[uid] || null;

  // IMPORTANT: Preserve existing teamIndex unless caller explicitly provided one.
  const hasIncomingTeam = Number.isInteger(player.teamIndex);
  const teamIndex = hasIncomingTeam
    ? Math.max(0, Math.min(13, player.teamIndex))
    : existing
      ? existing.teamIndex
      : 0;

  st.playersByUid[uid] = {
    uid,
    name: String(player.name || "").trim(),
    teamIndex,
    connected: !!player.connected,
    joinedAt: existing?.joinedAt || nowIso(),
    updatedAt: nowIso(),
  };

  st.uidByNameKey[nameKey] = uid;
  return st.playersByUid[uid];
}

async function finalizeAndStore(session, reason) {
  const st = ensureState(session);
  if (st.endedAt) return;

  st.endedAt = nowIso();
  session.phase = "ended";

  const winningTeam = Number.isInteger(st.winningTeamIndex)
    ? FACECHINKO_TEAMS[st.winningTeamIndex]
    : null;
  const mvp = st.mvpUid ? st.playersByUid[st.mvpUid] : null;

  const payload = {
    gameType: "facechinko",
    gameCode: session.code,
    location: session.location,
    startedAt: st.startedAt,
    endedAt: st.endedAt,
    reason,
    winningTeam: winningTeam
      ? { teamId: winningTeam.teamId, name: winningTeam.name, color: winningTeam.color }
      : null,
    mvp: mvp ? { uid: mvp.uid, name: mvp.name, teamId: mvp.teamIndex + 1 } : null,
    teams: FACECHINKO_TEAMS.map((t, idx) => ({
      teamId: t.teamId,
      teamName: t.name,
      color: t.color,
      players: Object.values(st.playersByUid)
        .filter((p) => p.teamIndex === idx)
        .map((p) => ({ uid: p.uid, name: p.name })),
    })),
  };

  const key = `games/facechinko/fck${timestampCompact()}_${session.code}.json`;
  const upload = await uploadJsonToS3({ bucket: getS3BucketName(session), key, bodyObj: payload });

  broadcastToPlayers(session, {
    type: "gameResult",
    winningTeamIndex: st.winningTeamIndex,
    winningTeamId: Number.isInteger(st.winningTeamIndex) ? st.winningTeamIndex + 1 : null,
    mvpName: mvp?.name || null,
  });

  safeSend(session.unity?.ws, { type: "recordSaved", ok: upload.ok, key, reason: upload.reason || null });
}

module.exports = {
  teamDefinitions: FACECHINKO_TEAMS,

  onInit() {
    return {
      teamCount: FACECHINKO_TEAMS.length,
      playersByUid: {},
      uidByNameKey: {},
      startedAt: null,
      endedAt: null,
      winningTeamIndex: null,
      mvpUid: null,
    };
  },

  snapshot(session) {
    return rosterSnapshot(session);
  },

  onPlayerJoin(session, clientId) {
    const st = ensureState(session);
    const p = session.players[clientId];
    if (!p) return;

    const uidToUse = p.facechinkoUid || p.resumeToken;

    // If player already exists (e.g., selected team via /facechinko/select-team),
    // do NOT overwrite their team unless a preferredTeamIndex was explicitly provided.
    const existing = st.playersByUid[uidToUse] || null;
    const hasPreferred = Number.isInteger(p.preferredTeamIndex);

    const merged = upsertPlayer(st, {
      uid: uidToUse,
      name: p.username,
      teamIndex: hasPreferred ? p.preferredTeamIndex : (existing ? existing.teamIndex : 0),
      connected: true,
    });
    if (!merged) return;

    p.teamIndex = merged.teamIndex;
    p.facechinkoUid = merged.uid;

    safeSend(session.unity?.ws, { type: "playerJoined", player: merged, snapshot: rosterSnapshot(session) });
  },

  onPlayerResume(session, clientId, entry) {
    const st = ensureState(session);
    const p = session.players[clientId];
    if (!p) return;

    const merged = upsertPlayer(st, {
      uid: entry?.uid || p.resumeToken,
      name: entry?.username || p.username,
      teamIndex: Number.isInteger(entry?.teamIndex) ? entry.teamIndex : (p.teamIndex || 0),
      connected: true,
    });

    if (!merged) return;
    p.teamIndex = merged.teamIndex;
    p.facechinkoUid = merged.uid;

    safeSend(session.unity?.ws, { type: "playerResumed", player: merged, snapshot: rosterSnapshot(session) });
  },

  onPlayerLeave(session, clientId) {
    const st = ensureState(session);
    const p = session.players[clientId];
    const uid = p?.facechinkoUid;
    if (uid && st.playersByUid[uid]) {
      st.playersByUid[uid].connected = false;
      st.playersByUid[uid].updatedAt = nowIso();
      safeSend(session.unity?.ws, { type: "playerLeft", uid, snapshot: rosterSnapshot(session) });
    }
  },

  onPlayerMsg() {},

  onUnityMsg(session, payload) {
    const st = ensureState(session);
    if (!payload || typeof payload !== "object") return;

    if (payload.kind === "phase") {
      if (payload.phase === "active") {
        session.phase = "active";
        st.startedAt = st.startedAt || nowIso();
      } else if (payload.phase === "join") {
        session.phase = "join";
      } else if (payload.phase === "ended") {
        finalizeAndStore(session, "unity_phase_ended").catch(() => {});
      }
      broadcastToPlayers(session, { type: "phase", phase: session.phase });
      return;
    }

    if (payload.kind === "gameOver") {
      // Accept either winningTeamIndex (0-13) or winningTeamId (1-14)
      let wIdx = null;
      if (Number.isInteger(payload.winningTeamIndex)) wIdx = payload.winningTeamIndex;
      else if (Number.isFinite(Number(payload.winningTeamId))) wIdx = Number(payload.winningTeamId) - 1;

      if (Number.isInteger(wIdx)) wIdx = Math.max(0, Math.min(13, wIdx));
      else wIdx = null;

      st.winningTeamIndex = wIdx;
      st.mvpUid = payload.mvpUid || null;
      finalizeAndStore(session, "unity_gameOver").catch(() => {});
      return;
    }

    if (payload.kind === "requestSnapshot") {
      safeSend(session.unity?.ws, { type: "snapshot", snapshot: rosterSnapshot(session) });
    }
  },

  onForcedEnd(session) {
    return finalizeAndStore(session, "forced_end");
  },

  onSessionEnd(session) {
    if (session.phase !== "ended") {
      return finalizeAndStore(session, "session_end");
    }
    return Promise.resolve();
  },

  registerWebPlayer(session, { uid, name, teamId }) {
    const st = ensureState(session);
    const teamIndex = Math.max(0, Math.min(13, Number(teamId) - 1));
    const player = upsertPlayer(st, {
      uid,
      name,
      teamIndex,
      connected: false,
    });
    if (!player) return null;

    safeSend(session.unity?.ws, {
      type: "playerRegistered",
      player,
      snapshot: rosterSnapshot(session),
    });

    return {
      uid: player.uid,
      name: player.name,
      teamIndex: player.teamIndex,
      teamId: player.teamIndex + 1,
      teamName: FACECHINKO_TEAMS[player.teamIndex].name,
      color: FACECHINKO_TEAMS[player.teamIndex].color,
    };
  },

  getWebPlayerState(session, uid) {
    const st = ensureState(session);
    const p = st.playersByUid[uid];
    if (!p) return null;
    const team = FACECHINKO_TEAMS[p.teamIndex];
    return {
      uid: p.uid,
      name: p.name,
      phase: session.phase,
      teamId: team.teamId,
      teamName: team.name,
      color: team.color,
      winningTeamId: Number.isInteger(st.winningTeamIndex) ? st.winningTeamIndex + 1 : null,
      mvpName: st.mvpUid ? st.playersByUid[st.mvpUid]?.name || null : null,
    };
  },
};