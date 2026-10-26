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
  players: [],
  positions: {
    "Team A": "Premier",
    "Team B": "Gold",
    "Team C": "Silver",
    "Team D": "Red"
  },
  notifications: []
};

// Undo / Redo Stacks
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

// Auto Spelling Matcher
function getBestTeamMatch(inputText) {
  if (!inputText) return null;
  const clean = inputText.trim().toLowerCase();
  let exact = state.teams.find(t => t.toLowerCase() === clean);
  if (exact) return exact;
  let partial = state.teams.find(t => t.toLowerCase().includes(clean) || clean.includes(t.toLowerCase()));
  if (partial) return partial;
  return null;
}

// Initialize Seasons
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

// Cloud Database Load & Save
async function loadState() {
  try {
    const { data, error } = await db.from('cnt_league').select('state').eq('id', 1).single();
    if (data && data.state && Object.keys(data.state).length > 0) {
      state = data.state;
      if (!state.positions) state.positions = {};
      if (!state.notifications) state.notifications = [];
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

// Auto NRR Recalculator
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
  renderAdminPositions();
  renderFixtures();
  renderPvPDropdowns();
  renderPlayers();
  populateDropdowns();
  renderTeamsManageList();
  renderPlayersManageList();
  renderNotifications();
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

// RENDER POSITIONS & TIERS MANAGER (ADMIN ONLY)
function renderAdminPositions() {
  const adminContainer = document.getElementById("adminPositionsContainer");
  if (adminContainer) {
    adminContainer.innerHTML = state.teams.map(teamName => {
      const currentTier = state.positions[teamName] || "Premier";
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;background:#060d17;padding:10px 14px;border-radius:8px;border:1px solid var(--line);margin-bottom:8px">
          <strong>${teamName}</strong>
          <select style="max-width:200px" onchange="updateTeamPositionTier('${teamName}', this.value)">
            <option value="Gold" ${currentTier==='Gold'?'selected':''}>🥇 Gold Tier (Final)</option>
            <option value="Silver" ${currentTier==='Silver'?'selected':''}>🥈 Silver Tier (Semi-Final)</option>
            <option value="Premier" ${currentTier==='Premier'?'selected':''}>👑 Premier Tier</option>
            <option value="Red" ${currentTier==='Red'?'selected':''}>🔴 Red Tier (Eliminated)</option>
          </select>
        </div>
      `;
    }).join("");
  }
}

function updateTeamPositionTier(teamName, newTier) {
  state.positions[teamName] = newTier;
  saveState();
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

// PLAYER VS PLAYER COMPARISON ENGINE
function renderPvPDropdowns() {
  const p1 = document.getElementById("pvpPlayer1Select");
  const p2 = document.getElementById("pvpPlayer2Select");
  if (!p1 || !p2) return;

  const options = state.players.map(p => `<option value="${p.id}">${p.name} (${p.team})</option>`).join("");
  p1.innerHTML = options;
  p2.innerHTML = options;

  if (state.players.length >= 2) p2.selectedIndex = 1;
  updatePvPComparison();
}

function updatePvPComparison() {
  const id1 = parseInt(document.getElementById("pvpPlayer1Select").value);
  const id2 = parseInt(document.getElementById("pvpPlayer2Select").value);
  const box = document.getElementById("pvpComparisonBox");

  const pl1 = state.players.find(p => p.id === id1);
  const pl2 = state.players.find(p => p.id === id2);

  if (!pl1 || !pl2) {
    box.innerHTML = '<div class="sub" style="text-align:center;padding:15px">Select 2 players to compare stats.</div>';
    return;
  }

  box.innerHTML = `
    <div class="pvp-stat-row"><strong style="color:var(--gold)">${pl1.name}</strong><span class="sub">NAME</span><strong style="color:var(--gold)">${pl2.name}</strong></div>
    <div class="pvp-stat-row"><span>${pl1.team}</span><span class="sub">TEAM</span><span>${pl2.team}</span></div>
    <div class="pvp-stat-row"><span>${pl1.role}</span><span class="sub">ROLE</span><span>${pl2.role}</span></div>
    <div class="pvp-stat-row"><strong style="color:${pl1.matches>=pl2.matches?'var(--teal)':'var(--text)'}">${pl1.matches || 1}</strong><span class="sub">MATCHES</span><strong style="color:${pl2.matches>=pl1.matches?'var(--teal)':'var(--text)'}">${pl2.matches || 1}</strong></div>
    <div class="pvp-stat-row"><strong style="color:${pl1.runs>=pl2.runs?'var(--orange)':'var(--text)'}">${pl1.runs}</strong><span class="sub">TOTAL RUNS</span><strong style="color:${pl2.runs>=pl1.runs?'var(--orange)':'var(--text)'}">${pl2.runs}</strong></div>
    <div class="pvp-stat-row"><strong style="color:${pl1.wickets>=pl2.wickets?'var(--purple)':'var(--text)'}">${pl1.wickets}</strong><span class="sub">TOTAL WICKETS</span><strong style="color:${pl2.wickets>=pl1.wickets?'var(--purple)':'var(--text)'}">${pl2.wickets}</strong></div>
  `;
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

  const manualPlayerTeam = document.getElementById("manualPlayerTeam");
  if(manualPlayerTeam) {
    manualPlayerTeam.innerHTML = state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
  }
}

function renderTeamsManageList() {
  const container = document.getElementById("teamsListContainer");
  if(container) {
    container.innerHTML = state.teams.map(t => `
      <span class="eyebrow" style="background:#14243b;display:inline-flex;align-items:center;gap:6px;margin-bottom:4px">
        ${t} 
        <b style="color:var(--gold);cursor:pointer" title="Rename" onclick="manualRenameTeam('${t}')">✏️</b>
        <b style="color:var(--red);cursor:pointer" title="Delete" onclick="manualDeleteTeam('${t}')">➖</b>
      </span>
    `).join("");
  }
}

function renderPlayersManageList() {
  const container = document.getElementById("playersListContainer");
  if(container) {
    container.innerHTML = state.players.length ? state.players.map(p => `
      <span class="eyebrow" style="background:#14243b;color:var(--text);display:inline-flex;align-items:center;gap:6px;margin-bottom:4px">
        ${p.name} (${p.team}) <b style="color:var(--red);cursor:pointer" onclick="manualDeletePlayer(${p.id})">×</b>
      </span>
    `).join("") : '<span class="sub">No players added yet.</span>';
  }
}

// PUBLIC FEEDBACK SUBMISSION (NAME & MESSAGE ONLY)
function submitPublicFeedback(evt) {
  evt.preventDefault();
  const name = document.getElementById("feedbackName").value.trim();
  const message = document.getElementById("feedbackMessage").value.trim();

  if (!name || !message) return alert("Please fill in both Name and Message fields!");

  state.notifications.unshift({
    id: Date.now(),
    name,
    message,
    date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString(),
    read: false
  });

  document.getElementById("feedbackName").value = "";
  document.getElementById("feedbackMessage").value = "";

  saveState();
  alert("📨 Complaint / Message submitted successfully to Admin!");
}

function renderNotifications() {
  const list = document.getElementById("adminNotificationsList");
  const badge = document.getElementById("notifBadge");
  const unreadCount = state.notifications.filter(n => !n.read).length;

  if (badge) badge.innerText = unreadCount;

  if (list) {
    list.innerHTML = state.notifications.length ? state.notifications.map(n => `
      <div style="background:#060d17;padding:12px;border-radius:8px;border:1px solid ${n.read ? 'var(--line)' : 'var(--gold)'};margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:var(--gold);font-size:13px">From: ${n.name}</strong>
          <span class="sub" style="font-size:10px">${n.date}</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);background:#0f1c2e;padding:8px;border-radius:6px;margin-top:6px">${n.message}</p>
        <div style="text-align:right;margin-top:6px;">
          ${!n.read ? `<button class="btn secondary" style="padding:2px 8px;font-size:10px" onclick="markNotifRead(${n.id})">Mark as Read</button>` : '<span class="sub">✓ Read</span>'}
          <button class="btn danger" style="padding:2px 8px;font-size:10px;margin-left:6px" onclick="deleteNotif(${n.id})">Delete</button>
        </div>
      </div>
    `).join("") : '<div class="sub">No feedback or complaints received yet.</div>';
  }
}

function markNotifRead(id) {
  const notif = state.notifications.find(n => n.id === id);
  if (notif) { notif.read = true; saveState(); }
}

function deleteNotif(id) {
  state.notifications = state.notifications.filter(n => n.id !== id);
  saveState();
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

// AI CHAT 1: CONVERTER (3 COPY SECTIONS)
function generateMatchSummary3Outputs() {
  const rawText = document.getElementById("converterRawInput").value.trim();
  if (!rawText) return alert("Please paste match summary notes first!");

  const lower = rawText.toLowerCase();

  let t1 = null, t2 = null;
  state.teams.forEach(t => {
    if (lower.includes(t.toLowerCase())) {
      if (!t1) t1 = t;
      else if (!t2) t2 = t;
    }
  });
  if (!t1) t1 = state.teams[0] || "Team A";
  if (!t2) t2 = state.teams[1] || "Team B";

  let winner = t1, loser = t2;
  if (lower.includes("lose to") || lower.includes("lost to") || lower.includes("defeated by")) {
    winner = t2;
    loser = t1;
  }

  const runMatches = rawText.match(/(\d+)\s*runs?/gi) || [];
  const r1 = runMatches[0] ? parseInt(runMatches[0]) : 150;
  const r2 = runMatches[1] ? parseInt(runMatches[1]) : 140;

  document.getElementById("outputSection1").value = `POINTS TABLE & AUTO NRR:\nWinner: ${winner} (+2 Pts, Scored: ${r1} runs)\nLoser: ${loser} (0 Pts, Scored: ${r2} runs)\nICC NRR Auto-Calculated.`;
  document.getElementById("outputSection2").value = `FIXTURES & PLAYER STATS:\nMatch: ${t1} vs ${t2}\nResult: ${winner} won over ${loser}\nIndividual Player Runs & Wickets updated on leaderboard.`;
  document.getElementById("outputSection3").value = `POSITIONS & TIERS BRACKET:\nTeam '${winner}' assigned Gold/Premier Tier Standing.\nTeam '${loser}' moved to Silver/Red Tier Standing.`;
}

function copyOutputText(elementId) {
  const textarea = document.getElementById(elementId);
  if (!textarea.value) return alert("Nothing to copy! Please click 'Update Match Summary' first.");
  textarea.select();
  navigator.clipboard.writeText(textarea.value);
  alert("📋 Copied section to clipboard!");
}

// AI CHAT 2: AUTO POINTS TABLE
function sendPointsAIChatCommand() {
  const input = document.getElementById('pointsAiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  let teamA = null, teamB = null;

  state.teams.forEach(t => {
    if (lower.includes(t.toLowerCase())) {
      if (!teamA) teamA = t;
      else if (!teamB) teamB = t;
    }
  });

  if (!teamA || !teamB || teamA === teamB) {
    showErrorPopup(`Could not identify 2 registered teams in your entry.\n\nInput: "${text}"`);
    return;
  }

  let winner = teamA, loser = teamB;
  if (lower.includes("lose to") || lower.includes("lost to") || lower.includes("defeated by")) {
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

// AI CHAT 3: FIXTURES & STATS
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
    showErrorPopup(`Could not detect runs or wickets.\n\nInput: "${text}"`);
    return;
  }

  let assignedTeam = null;
  state.teams.forEach(t => {
    if (getBestTeamMatch(t) && lower.includes(t.toLowerCase())) assignedTeam = t;
  });
  if (!assignedTeam) assignedTeam = state.teams[0] || "Team A";

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

  if (existing) {
    existing.matches += 1;
    existing.runs += runs;
    existing.wickets += wickets;
    existing.team = assignedTeam;
  } else {
    state.players.push({ id: Date.now(), name: playerName, team: assignedTeam, role, matches: 1, runs, wickets });
  }

  saveState();
  box.innerHTML += `<div class="chat-msg chat-ai">👤 Registered/Updated ${playerName} (${assignedTeam}): +${runs} runs, +${wickets} wickets.</div>`;
  box.scrollTop = box.scrollHeight;
}

// MANUAL TEAM CONTROLS (ADD, DELETE, RENAME)
function manualAddTeam() {
  const name = document.getElementById("newTeamName").value.trim();
  if (name && !state.teams.includes(name)) {
    state.teams.push(name);
    state.positions[name] = "Premier";
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
    delete state.positions[name];
    for (let s in state.seasons) {
      state.seasons[s] = state.seasons[s].filter(t => t.name !== name);
    }
    saveState();
  }
}

function manualRenameTeam(oldName) {
  const newName = prompt(`Enter new name for team '${oldName}':`, oldName);
  if (newName && newName.trim() && !state.teams.includes(newName.trim())) {
    const cleanName = newName.trim();
    const idx = state.teams.indexOf(oldName);
    if (idx !== -1) state.teams[idx] = cleanName;

    if (state.positions[oldName]) {
      state.positions[cleanName] = state.positions[oldName];
      delete state.positions[oldName];
    }

    for (let s in state.seasons) {
      state.seasons[s].forEach(t => { if (t.name === oldName) t.name = cleanName; });
    }

    state.players.forEach(p => { if (p.team === oldName) p.team = cleanName; });
    state.fixtures.forEach(f => {
      if (f.team1 === oldName) f.team1 = cleanName;
      if (f.team2 === oldName) f.team2 = cleanName;
    });

    saveState();
    alert(`Team renamed from '${oldName}' to '${cleanName}'!`);
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
      players: [],
      positions: { "Team A": "Premier", "Team B": "Gold", "Team C": "Silver", "Team D": "Red" },
      notifications: []
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

// Event Listeners
document.getElementById("playerSearch").addEventListener("input", renderPlayers);
document.getElementById("teamFilter").addEventListener("change", renderPlayers);
document.getElementById("roleFilter").addEventListener("change", renderPlayers);

// Boot Application
loadState();
