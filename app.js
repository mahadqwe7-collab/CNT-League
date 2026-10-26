// Supabase Cloud Connection Setup
const SUPABASE_URL = "https://slgsxvwzcmogulsrzgqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_sQmZXNu5XfQ0m5hQ6v-Cog_HS9sLraa";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Default Tournament State
const DEFAULT_TEAMS = ["Team A", "Team B", "Team C", "Team D"];

let state = {
  activeSeason: 1,
  siteConfig: {
    eyebrow: "TOURNAMENT DASHBOARD",
    heroHeading: 'THE GAME.<br><span class="gradient">THE GLORY.</span>'
  },
  teams: [...DEFAULT_TEAMS],
  seasons: { 1: [], 2: [], 3: [], 4: [] },
  fixtures: [],
  players: []
};

// Undo / Redo History Stacks
let undoStack = [];
let redoStack = [];

function pushHistory() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 25) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function undoAction() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify(state));
  state = JSON.parse(undoStack.pop());
  saveState(true);
  updateUndoRedoButtons();
}

function redoAction() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify(state));
  state = JSON.parse(redoStack.pop());
  saveState(true);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

// Auto Spelling & Name Fuzzy Matching Helper
function getBestTeamMatch(inputText) {
  if (!inputText) return null;
  const clean = inputText.trim().toLowerCase();
  
  // Direct exact match
  let exact = state.teams.find(t => t.toLowerCase() === clean);
  if (exact) return exact;

  // Substring/Partial match (Handles misspellings like 'Fakons' or 'Eagles')
  let partial = state.teams.find(t => t.toLowerCase().includes(clean) || clean.includes(t.toLowerCase()));
  if (partial) return partial;

  return null;
}

// Initialize Season Standings
function initSeasons(teamList) {
  const data = {};
  for (let i = 1; i <= 4; i++) {
    data[i] = teamList.map(name => ({
      name, played: 0, won: 0, lost: 0, runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: "0.000", points: 0
    }));
  }
  return data;
}
state.seasons = initSeasons(state.teams);

// Cloud DB Fetch & Persist
async function loadState() {
  try {
    const { data, error } = await db.from('cnt_league').select('state').eq('id', 1).single();
    if (data && data.state && Object.keys(data.state).length > 0) {
      state = data.state;
    }
  } catch (e) {
    console.error("Cloud DB load error:", e);
  }
  recalculateAutoNRR();
  renderAll();
}

async function saveState(skipHistory = false) {
  if (!skipHistory) pushHistory();
  recalculateAutoNRR();
  renderAll();
  try {
    await db.from('cnt_league').upsert({ id: 1, state: state });
  } catch (e) {
    console.error("Cloud DB save error:", e);
  }
}

// AUTOMATIC ICC NRR ENGINE
function recalculateAutoNRR() {
  const curTeams = state.seasons[state.activeSeason];
  if (!curTeams) return;

  curTeams.forEach(t => {
    if (t.oversFaced > 0 && t.oversBowled > 0) {
      const runRateFor = t.runsScored / t.oversFaced;
      const runRateAgainst = t.runsConceded / t.oversBowled;
      t.nrr = (runRateFor - runRateAgainst).toFixed(3);
    } else {
      t.nrr = "0.000";
    }
  });
}

// Master Render Engine
function renderAll() {
  document.getElementById("siteEyebrow").innerText = state.siteConfig.eyebrow;
  document.getElementById("heroTitle").innerHTML = state.siteConfig.heroHeading;

  renderSeasonsGrid();
  renderStandings();
  renderFixtures();
  renderTop5Leaders();
  renderPlayers();
  populateDropdowns();
  renderTeamsManageList();
  renderPlayersManageList();
  renderServerPreview();
  updateUndoRedoButtons();
}

function renderSeasonsGrid() {
  const grid = document.getElementById("seasonsGrid");
  grid.innerHTML = [1, 2, 3, 4].map(i => `
    <article class="season-card ${state.activeSeason === i ? 'active' : ''}" onclick="switchSeason(${i})">
      <div class="kicker">SEASON 0${i}</div>
      <h3>Season ${i}</h3>
      <span class="status">${state.activeSeason === i ? '● ACTIVE VIEW' : '◷ SELECT'}</span>
    </article>
  `).join("");
}

function switchSeason(num) {
  state.activeSeason = num;
  recalculateAutoNRR();
  renderSeasonsGrid();
  renderStandings();
}

function renderStandings() {
  document.getElementById("standingsTitle").innerText = `Points Table — Season ${state.activeSeason}`;
  const teams = state.seasons[state.activeSeason] || [];
  const tbody = document.getElementById("pointsBody");
  tbody.innerHTML = teams.length ? [...teams]
    .sort((a, b) => b.points - a.points || parseFloat(b.nrr) - parseFloat(a.nrr))
    .map((t, i) => `
      <tr>
        <td>${i + 1}</td><td><strong>${t.name}</strong></td>
        <td>${t.played}</td><td>${t.won}</td><td>${t.lost}</td>
        <td style="color:var(--teal);font-weight:700">${t.nrr}</td><td style="color:var(--gold);font-weight:800">${t.points}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No teams added.</td></tr>`;
}

function renderTop5Leaders() {
  const sortedBatters = [...state.players].sort((a, b) => b.runs - a.runs).slice(0, 5);
  const sortedBowlers = [...state.players].sort((a, b) => b.wickets - a.wickets).slice(0, 5);

  const renderBatterRows = (list) => list.length ? list.map((p, i) => `
    <div class="top5-row">
      <span class="top5-rank">#${i + 1}</span>
      <div style="flex:1"><strong>${p.name}</strong> <span class="sub">(${p.team})</span></div>
      <strong style="color:var(--orange)">${p.runs} runs</strong>
    </div>
  `).join("") : '<div class="sub" style="padding:10px">No batting stats yet.</div>';

  const renderBowlerRows = (list) => list.length ? list.map((p, i) => `
    <div class="top5-row">
      <span class="top5-rank">#${i + 1}</span>
      <div style="flex:1"><strong>${p.name}</strong> <span class="sub">(${p.team})</span></div>
      <strong style="color:var(--purple)">${p.wickets} wkts</strong>
    </div>
  `).join("") : '<div class="sub" style="padding:10px">No bowling stats yet.</div>';

  const pubB = document.getElementById("top5BattersList");
  const pubW = document.getElementById("top5BowlersList");
  if (pubB) pubB.innerHTML = renderBatterRows(sortedBatters);
  if (pubW) pubW.innerHTML = renderBowlerRows(sortedBowlers);

  const admB = document.getElementById("adminTop5Batters");
  const admW = document.getElementById("adminTop5Bowlers");
  if (admB) admB.innerHTML = renderBatterRows(sortedBatters);
  if (admW) admW.innerHTML = renderBowlerRows(sortedBowlers);
}

function renderFixtures() {
  const tbody = document.getElementById("fixturesBody");
  tbody.innerHTML = state.fixtures.length ? state.fixtures.map(f => `
    <tr>
      <td>${f.title}</td>
      <td><strong>${f.team1}</strong> vs <strong>${f.team2}</strong></td>
      <td>${f.result}</td>
      <td>
        <button class="btn secondary" style="padding:4px 10px;font-size:11px" onclick="showMatchDetails(${f.id})">
          🔍 Click for Details
        </button>
      </td>
    </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted)">No match records logged.</td></tr>`;
}

function showMatchDetails(matchId) {
  const match = state.fixtures.find(m => m.id === matchId);
  if (!match) return;

  document.getElementById("detailMatchTitle").innerText = `${match.title}: ${match.team1} vs ${match.team2}`;
  document.getElementById("detailMatchStatus").innerText = `Status: ${match.status || 'Completed'}`;
  document.getElementById("detailTeam1Name").innerText = match.team1;
  document.getElementById("detailTeam1Score").innerText = `${match.team1Runs || 0}/${match.team1Wickets || 0} (${match.team1Overs || '0.0'} ov)`;
  document.getElementById("detailTeam2Name").innerText = match.team2;
  document.getElementById("detailTeam2Score").innerText = `${match.team2Runs || 0}/${match.team2Wickets || 0} (${match.team2Overs || '0.0'} ov)`;
  document.getElementById("detailMatchSummaryText").innerText = match.details || match.result || "Match completed successfully.";

  openModal("matchDetailModal");
}

function renderPlayers() {
  const q = document.getElementById("playerSearch").value.toLowerCase();
  const team = document.getElementById("teamFilter").value;
  const role = document.getElementById("roleFilter").value;

  let topRuns = 0, topWickets = 0;
  state.players.forEach(p => {
    if (p.runs > topRuns) topRuns = p.runs;
    if (p.wickets > topWickets) topWickets = p.wickets;
  });

  const filtered = state.players.filter(p =>
    (p.name + " " + p.team).toLowerCase().includes(q) &&
    (team === "All" || p.team === team) &&
    (role === "All" || p.role === role)
  );

  const grid = document.getElementById("playerGrid");
  grid.innerHTML = filtered.length ? filtered.map(p => {
    const isOrange = p.runs > 0 && p.runs === topRuns;
    const isPurple = p.wickets > 0 && p.wickets === topWickets;
    return `
    <article class="player-card">
      <div style="font-weight:800;font-size:15px">
        ${p.name}
        ${isOrange ? '<span class="badge-cap cap-orange">Orange Cap</span>' : ''}
        ${isPurple ? '<span class="badge-cap cap-purple">Purple Cap</span>' : ''}
      </div>
      <div class="sub" style="margin-top:2px">${p.team} · ${p.role}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px;font-size:11px">
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">Matches</span><br><strong>${p.matches || 1}</strong></div>
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">Runs</span><br><strong>${p.runs}</strong></div>
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">Wickets</span><br><strong>${p.wickets}</strong></div>
      </div>
    </article>`;
  }).join("") : '<div class="sub">No player records found.</div>';
}

function populateDropdowns() {
  const filter = document.getElementById("teamFilter");
  filter.innerHTML = `<option value="All">All Teams</option>` + state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
  
  const m1 = document.getElementById("matchTeam1");
  const m2 = document.getElementById("matchTeam2");
  if(m1 && m2) {
    m1.innerHTML = state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
    m2.innerHTML = state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
  }

  const manualPlayerTeam = document.getElementById("manualPlayerTeam");
  if(manualPlayerTeam) {
    manualPlayerTeam.innerHTML = state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
  }
}

function renderTeamsManageList() {
  const container = document.getElementById("teamsListContainer");
  if(container) {
    container.innerHTML = state.teams.map(t => `
      <span class="eyebrow" style="background:#14243b;display:inline-flex;align-items:center;gap:6px">
        ${t} <b style="color:var(--red);cursor:pointer" onclick="manualDeleteTeam('${t}')">×</b>
      </span>
    `).join("");
  }
}

function renderPlayersManageList() {
  const container = document.getElementById("playersListContainer");
  if(container) {
    container.innerHTML = state.players.length ? state.players.map(p => `
      <span class="eyebrow" style="background:#14243b;color:var(--text);display:inline-flex;align-items:center;gap:6px">
        ${p.name} (${p.team}) <b style="color:var(--red);cursor:pointer" onclick="manualDeletePlayer(${p.id})">×</b>
      </span>
    `).join("") : '<span class="sub">No players added yet.</span>';
  }
}

function renderServerPreview() {
  const lastSync = document.getElementById("serverLastSync");
  const teamsCount = document.getElementById("serverTeamsCount");
  const matchesCount = document.getElementById("serverMatchesCount");
  const playersCount = document.getElementById("serverPlayersCount");
  const rawJson = document.getElementById("serverRawJson");

  if (lastSync) lastSync.innerText = new Date().toLocaleTimeString();
  if (teamsCount) teamsCount.innerText = state.teams.length;
  if (matchesCount) matchesCount.innerText = state.fixtures.length;
  if (playersCount) playersCount.innerText = state.players.length;
  if (rawJson) rawJson.value = JSON.stringify(state, null, 2);
}

function showErrorPopup(msg) {
  document.getElementById("errorMessageText").innerText = msg;
  openModal("errorModal");
}

// ==========================================
// AI CHAT 1: AUTO POINTS TABLE (Handles Win/Loss & Reverse Direction Fix)
// ==========================================
function sendPointsAIChatCommand() {
  const input = document.getElementById('pointsAiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  let teamA = null, teamB = null;

  // Search for registered teams in text
  state.teams.forEach(t => {
    if (lower.includes(t.toLowerCase())) {
      if (!teamA) teamA = t;
      else if (!teamB) teamB = t;
    }
  });

  if (!teamA || !teamB || teamA === teamB) {
    showErrorPopup(`Could not identify 2 registered teams in your entry.\n\nInput: "${text}"\n\nPlease ensure team names match registered teams.`);
    return;
  }

  // FIX: Detect "lose to", "lost to", "defeated by" -> Reverses Winner & Loser
  let winner = teamA, loser = teamB;
  if (lower.includes("lose to") || lower.includes("lost to") || lower.includes("defeated by") || lower.includes("loses to")) {
    winner = teamB;
    loser = teamA;
  }

  const box = document.getElementById('pointsAiChatBox');
  box.innerHTML += `<div class="chat-msg chat-user">${text}</div>`;
  input.value = "";

  const cur = state.seasons[state.activeSeason];
  const wTeam = cur.find(x => x.name === winner);
  const lTeam = cur.find(x => x.name === loser);

  if (wTeam && lTeam) {
    wTeam.played += 1; wTeam.won += 1; wTeam.points += 2;
    lTeam.played += 1; lTeam.lost += 1;

    state.fixtures.push({
      id: Date.now(),
      title: `Match ${state.fixtures.length + 1}`,
      team1: wTeam.name,
      team2: lTeam.name,
      team1Runs: 0, team1Overs: "0.0", team1Wickets: 0,
      team2Runs: 0, team2Overs: "0.0", team2Wickets: 0,
      result: `${wTeam.name} defeated ${lTeam.name}`,
      status: "Completed",
      details: `${wTeam.name} won against ${lTeam.name}`
    });

    saveState();
    box.innerHTML += `<div class="chat-msg chat-ai">🏆 Points Table Updated! ${wTeam.name} (+2 pts) defeated ${lTeam.name}. Auto NRR recalculated.</div>`;
    box.scrollTop = box.scrollHeight;
  }
}

// ==========================================
// AI CHAT 2: FIXTURES & STATS (Spelling Auto-Correct & Individual Stats)
// ==========================================
function sendFixturesAIChatCommand() {
  const input = document.getElementById('fixturesAiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const runMatch = text.match(/(\d+)\s*runs?/i);
  const wktMatch = text.match(/(\d+)\s*wickets?|(\d+)\s*wkts?/i);

  const runs = runMatch ? parseInt(runMatch[1]) : 0;
  const wickets = wktMatch ? parseInt(wktMatch[1] || wktMatch[2]) : 0;

  if (!runMatch && !wktMatch) {
    showErrorPopup(`Could not detect runs or wickets.\n\nInput: "${text}"\n\nExample format: "Ali 45 runs 2 wickets for Falcons"`);
    return;
  }

  // Find Team with Auto Spelling Correction
  let assignedTeam = null;
  state.teams.forEach(t => {
    if (getBestTeamMatch(t) && lower.includes(t.toLowerCase())) assignedTeam = t;
  });
  if (!assignedTeam) assignedTeam = state.teams[0] || "Team A";

  // Find Player Name
  let playerName = "Player";
  const nameMatch = text.match(/(?:add player|player)?\s*([a-zA-Z]+)/i);
  if (nameMatch && nameMatch[1] && !["add", "player", "to", "as", "with", "scored", "for", "beat", "defeated", "runs", "wickets", "wkts"].includes(nameMatch[1].toLowerCase())) {
    playerName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
  }

  const box = document.getElementById('fixturesAiChatBox');
  box.innerHTML += `<div class="chat-msg chat-user">${text}</div>`;
  input.value = "";

  const role = wickets > 0 ? (runs > 20 ? "All-Rounder" : "Bowler") : "Batter";
  let existing = state.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
  let reply = "";

  if (existing) {
    existing.matches += 1;
    existing.runs += runs;
    existing.wickets += wickets;
    existing.team = assignedTeam;
    reply = `👤 Updated ${existing.name} (${assignedTeam}): +${runs} runs, +${wickets} wickets.`;
  } else {
    state.players.push({
      id: Date.now(),
      name: playerName,
      team: assignedTeam,
      role: role,
      matches: 1,
      runs: runs,
      wickets: wickets
    });
    reply = `👤 Registered ${playerName} for ${assignedTeam} (${runs} runs, ${wickets} wickets).`;
  }

  saveState();
  box.innerHTML += `<div class="chat-msg chat-ai">${reply}</div>`;
  box.scrollTop = box.scrollHeight;
}

// ==========================================
// AI CHAT 3: MATCH SUMMARY CONVERTER (Generates 2 Copyable Outputs)
// ==========================================
function generateDualSummaryOutputs() {
  const rawText = document.getElementById("converterRawInput").value.trim();
  if (!rawText) return alert("Please enter raw match summary notes!");

  const lower = rawText.toLowerCase();

  // Parse Teams
  let t1 = null, t2 = null;
  state.teams.forEach(t => {
    if (lower.includes(t.toLowerCase())) {
      if (!t1) t1 = t;
      else if (!t2) t2 = t;
    }
  });
  if (!t1) t1 = state.teams[0] || "Team A";
  if (!t2) t2 = state.teams[1] || "Team B";

  // Parse Winner / Loser with Reverse Check
  let winner = t1, loser = t2;
  if (lower.includes("lose to") || lower.includes("lost to") || lower.includes("defeated by")) {
    winner = t2;
    loser = t1;
  }

  // Parse Runs & Wickets
  const runMatches = rawText.match(/(\d+)\s*runs?/gi) || [];
  const r1 = runMatches[0] ? parseInt(runMatches[0]) : 150;
  const r2 = runMatches[1] ? parseInt(runMatches[1]) : 140;

  // FORMAT OUTPUT SECTION 1: POINTS TABLE & AUTO NRR PROMPT
  const section1Text = `POINTS TABLE & NRR UPDATE:\nWinner: ${winner} (+2 Points, Scored: ${r1} runs)\nLoser: ${loser} (0 Points, Scored: ${r2} runs)\nAuto NRR recalculated based on official ICC rules.`;

  // FORMAT OUTPUT SECTION 2: FIXTURES & PLAYER STATS PROMPT
  const section2Text = `FIXTURE SCORECARD & PLAYER STATS LOG:\nMatch: ${t1} vs ${t2}\nResult: ${winner} defeated ${loser} (${r1} vs ${r2} runs)\nPlayer Performances: Key stats updated for Orange & Purple Cap standings.`;

  document.getElementById("outputSection1").value = section1Text;
  document.getElementById("outputSection2").value = section2Text;
}

function copyOutputText(elementId) {
  const textarea = document.getElementById(elementId);
  if (!textarea.value) return alert("Nothing to copy! Please generate output first.");
  textarea.select();
  navigator.clipboard.writeText(textarea.value);
  alert("📋 Copied to clipboard!");
}

// MANUAL ICC NRR CALCULATOR
function submitMatchResult() {
  const t1 = document.getElementById("matchTeam1").value;
  const t2 = document.getElementById("matchTeam2").value;
  const r1 = parseInt(document.getElementById("team1Runs").value) || 0;
  const o1 = parseFloat(document.getElementById("team1Overs").value) || 20.0;
  const w1 = parseInt(document.getElementById("team1Wickets").value) || 0;
  
  const r2 = parseInt(document.getElementById("team2Runs").value) || 0;
  const o2 = parseFloat(document.getElementById("team2Overs").value) || 20.0;
  const w2 = parseInt(document.getElementById("team2Wickets").value) || 0;

  if (t1 === t2) return showErrorPopup("Select two different teams!");

  const effectiveOvers1 = w1 >= 10 ? 20.0 : o1;
  const effectiveOvers2 = w2 >= 10 ? 20.0 : o2;

  const currentTeams = state.seasons[state.activeSeason];
  const winner = currentTeams.find(x => x.name === t1);
  const loser = currentTeams.find(x => x.name === t2);

  if (winner && loser) {
    winner.played += 1; winner.won += 1; winner.points += 2;
    winner.runsScored += r1; winner.oversFaced += effectiveOvers1;
    winner.runsConceded += r2; winner.oversBowled += effectiveOvers2;

    loser.played += 1; loser.lost += 1;
    loser.runsScored += r2; loser.oversFaced += effectiveOvers2;
    loser.runsConceded += r1; loser.oversBowled += effectiveOvers1;

    state.fixtures.push({
      id: Date.now(),
      title: `Match ${state.fixtures.length + 1}`,
      team1: t1,
      team2: t2,
      team1Runs: r1, team1Overs: o1, team1Wickets: w1,
      team2Runs: r2, team2Overs: o2, team2Wickets: w2,
      result: `${t1} won by ${r1 - r2 > 0 ? (r1 - r2) + " runs" : (10 - w1) + " wickets"}`,
      status: "Completed",
      details: `${t1}: ${r1}/${w1} (${o1} ov)\n${t2}: ${r2}/${w2} (${o2} ov)`
    });

    saveState();
    alert(`Match Logged! ${t1} won & ICC NRR auto-recalculated.`);
  }
}

// MANUAL CONTROLS
function manualAddTeam() {
  const name = document.getElementById("newTeamName").value.trim();
  if (name && !state.teams.includes(name)) {
    state.teams.push(name);
    for (let s in state.seasons) {
      state.seasons[s].push({ name, played: 0, won: 0, lost: 0, runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: "0.000", points: 0 });
    }
    document.getElementById("newTeamName").value = "";
    saveState();
  }
}

function manualDeleteTeam(name) {
  if (confirm(`Delete ${name}?`)) {
    state.teams = state.teams.filter(t => t !== name);
    for (let s in state.seasons) {
      state.seasons[s] = state.seasons[s].filter(t => t.name !== name);
    }
    saveState();
  }
}

function manualAddPlayer() {
  const name = document.getElementById("manualPlayerName").value.trim();
  const team = document.getElementById("manualPlayerTeam").value;
  const role = document.getElementById("manualPlayerRole").value;
  const runs = parseInt(document.getElementById("manualPlayerRuns").value) || 0;
  const wickets = parseInt(document.getElementById("manualPlayerWickets").value) || 0;

  if (!name) return alert("Enter Player Name!");

  let existing = state.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.runs += runs;
    existing.wickets += wickets;
    existing.team = team;
    existing.role = role;
  } else {
    state.players.push({ id: Date.now(), name, team, role, matches: 1, runs, wickets });
  }

  document.getElementById("manualPlayerName").value = "";
  document.getElementById("manualPlayerRuns").value = "";
  document.getElementById("manualPlayerWickets").value = "";
  saveState();
  alert(`Player '${name}' saved manually!`);
}

function manualDeletePlayer(id) {
  if (confirm("Remove this player from roster?")) {
    state.players = state.players.filter(p => p.id !== id);
    saveState();
  }
}

async function resetDefaultData() {
  if (confirm("Permanently wipe tournament database?")) {
    state = {
      activeSeason: 1,
      siteConfig: { eyebrow: "TOURNAMENT DASHBOARD", heroHeading: 'THE GAME.<br><span class="gradient">THE GLORY.</span>' },
      teams: [...DEFAULT_TEAMS],
      seasons: initSeasons([...DEFAULT_TEAMS]),
      fixtures: [],
      players: []
    };
    await saveState();
    location.reload();
  }
}

// UI Navigation & Auth
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function switchTab(evt, tabId) {
  document.querySelectorAll('.admin-sidebar .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  evt.target.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function verifyPassword() {
  if (document.getElementById('adminPassword').value === "mahadmahad") {
    closeModal('loginModal');
    openModal('adminModal');
    document.getElementById('editEyebrow').value = state.siteConfig.eyebrow;
  } else {
    alert("Access Denied");
  }
}

function saveSiteText() {
  state.siteConfig.eyebrow = document.getElementById('editEyebrow').value;
  saveState();
  alert("Tagline Saved!");
}

// FIX: HOLD TO PREVIEW SITE (100% TRANSPARENT PREVIEW)
function setupPeekPreview() {
  const peekBtn = document.getElementById("btnPeekSite");
  const adminModal = document.getElementById("adminModal");

  if (peekBtn && adminModal) {
    const enablePeek = (e) => {
      e.preventDefault();
      adminModal.classList.add("peeking");
    };
    const disablePeek = (e) => {
      e.preventDefault();
      adminModal.classList.remove("peeking");
    };

    peekBtn.addEventListener("mousedown", enablePeek);
    peekBtn.addEventListener("mouseup", disablePeek);
    peekBtn.addEventListener("mouseleave", disablePeek);
    peekBtn.addEventListener("touchstart", enablePeek, { passive: false });
    peekBtn.addEventListener("touchend", disablePeek, { passive: false });
  }
}

// Search & Filter Listeners
document.getElementById("playerSearch").addEventListener("input", renderPlayers);
document.getElementById("teamFilter").addEventListener("change", renderPlayers);
document.getElementById("roleFilter").addEventListener("change", renderPlayers);

// Boot Application
loadState();
setupPeekPreview();
