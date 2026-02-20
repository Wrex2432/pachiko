const API_BASE = "http://localhost:3000";
const uidKey = "facechinko_uid";

const uid = (() => {
  let v = localStorage.getItem(uidKey);
  if (!v) {
    v = `fc_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(uidKey, v);
  }
  return v;
})();

const views = {
  join: document.getElementById("join-view"),
  team: document.getElementById("team-view"),
  wait: document.getElementById("wait-view"),
  result: document.getElementById("result-view")
};

const state = { code: "", name: "", teamId: null, poll: null };

function show(name) {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

function q(path, params) {
  const u = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  return fetch(u).then(r => r.json());
}

document.getElementById("validate-btn").onclick = async () => {
  const code = document.getElementById("room-code").value.trim().toUpperCase();
  const name = document.getElementById("player-name").value.trim();
  const error = document.getElementById("join-error");

  const res = await q("/facechinko/validate", { code, name });
  if (!res.ok) {
    error.textContent = res.reason || "Unable to validate";
    return;
  }

  state.code = code;
  state.name = name;
  renderTeams(res.teams || []);
  show("team");
};

function renderTeams(teams) {
  const container = document.getElementById("teams");
  container.innerHTML = "";
  teams.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "team-btn";
    btn.style.background = t.color;
    btn.textContent = t.name;
    btn.onclick = () => chooseTeam(t);
    container.appendChild(btn);
  });
}

async function chooseTeam(team) {
  const res = await q("/facechinko/select-team", {
    code: state.code,
    uid,
    name: state.name,
    teamId: team.teamId
  });

  if (!res.ok) {
    document.getElementById("team-error").textContent = res.reason || "Could not join team";
    return;
  }

  state.teamId = team.teamId;
  document.getElementById("ball-preview").style.background = team.color;
  document.getElementById("preview-name").textContent = state.name;
  document.getElementById("preview-team").textContent = team.name;

  show("wait");
  state.poll = setInterval(pollState, 1500);
}

async function pollState() {
  const res = await q("/facechinko/player-state", { code: state.code, uid });
  if (!res.ok) return;

  const status = document.getElementById("status");
  status.textContent = `Phase: ${res.player.phase}`;

  if (res.player.phase === "ended" && res.result) {
    clearInterval(state.poll);
    show("result");
    document.getElementById("result-title").textContent = res.result.won ? "Your Team Won!" : "You Lose";
    document.getElementById("result-subtitle").textContent = res.result.won
      ? `MVP: ${res.result.mvpName || "TBD"}`
      : `Winning Team: TEAM ${res.result.winningTeamId || "?"}`;
  }
}
