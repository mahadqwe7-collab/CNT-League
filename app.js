// Supabase Connection Initialization
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

// Cloud Database Load & Save
async function loadState() {
  try {
    const { data, error } = await db.from('cnt_league').select('state').eq('id', 1).single();
    if (data && data.state && Object.keys(data.state).length > 0) {
      state = data.state;
    }
  } catch (e) {
    console.error("Cloud DB load error:", e);
  }
  renderAll();
}

async function saveState() {
  renderAll();
  try {
    await db.from('cnt_league').upsert({ id: 1, state: state });
  } catch (e) {
    console.error("Cloud DB save error:", e);
  }
}

// Master Render Function
function renderAll() {
  document.getElementById("siteEyebrow").innerText = state.siteConfig.eyebrow;
  document.getElementById("heroTitle").innerHTML = state.siteConfig.heroHeading;

  renderSeasonsGrid();
  renderStandings();
  renderFixtures();
  renderPlayers();
  populateDropdowns();
  renderTeamsManageList();
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
        <td>${t.nrr}</td><td style="color:var(--gold);font-weight:800">${t.points}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No teams added.</td></tr>`;
}

function renderFixtures() {
  const tbody = document.getElementById("fixturesBody");
  tbody.innerHTML = state.fixtures.length ? state.fixtures.map(f => `
    <tr>
      <td>${f.title}</td><td>${f.team1} vs ${f.team2}</td>
      <td>${f.result}</td><td><span class="eyebrow" style="padding:2px 8px">${f.status}</span></td>
    </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted)">No match records logged.</td></tr>`;
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

// Error Modal Trigger
function showErrorPopup(message) {
  document.getElementById("errorMessageText").innerText = message;
  openModal("errorModal");
}

// PART 1: MATCH SUMMARY AI CHAT
function sendMatchAIChatCommand() {
  const input = document.getElementById('matchAiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  let foundWinner = null, foundLoser = null;

  // Search text for existing team names
  state.teams.forEach(teamName => {
    if (lower.includes(teamName.toLowerCase())) {
      if (!foundWinner) foundWinner = teamName;
      else if (!foundLoser) foundLoser = teamName;
    }
  });

  // Validation Check: Must identify 2 valid registered teams
  if (!foundWinner || !foundLoser) {
    showErrorPopup(`Could not identify 2 valid teams in your match summary.\n\nInput: "${text}"\n\nPlease ensure team names match registered teams exactly!`);
    return;
  }

  // Determine winner vs loser (Look for keywords like "beat", "defeated", "won")
  const box = document.getElementById('matchAiChatBox');
  box.innerHTML += `<div class="chat-msg chat-user">${text}</div>`;
  input.value = "";

  const cur = state.seasons[state.activeSeason];
  const wTeam = cur.find(x => x.name === foundWinner);
  const lTeam = cur.find(x => x.name === foundLoser);

  if (wTeam && lTeam) {
    wTeam.played += 1; wTeam.won += 1; wTeam.points += 2;
    lTeam.played += 1; lTeam.lost += 1;

    state.fixtures.push({
      id: Date.now(),
      title: `Match ${state.fixtures.length + 1}`,
      team1: wTeam.name,
      team2: lTeam.name,
      result: `${wTeam.name} defeated ${lTeam.name}`,
      status: "Completed"
    });

    saveState();
    box.innerHTML += `<div class="chat-msg chat-ai">🏆 Result logged! ${wTeam.name} +2 pts (Won against ${lTeam.name}).</div>`;
    box.scrollTop = box.scrollHeight;
  }
}

// PART 2: PLAYER STATS AI CHAT
function sendPlayerAIChatCommand() {
  const input = document.getElementById('playerAiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const runMatch = text.match(/(\d+)\s*runs?/i);
  const wktMatch = text.match(/(\d+)\s*wickets?|(\d+)\s*wkts?/i);

  const runs = runMatch ? parseInt(runMatch[1]) : 0;
  const wickets = wktMatch ? parseInt(wktMatch[1] || wktMatch[2]) : 0;

  // Validation Check: If no numbers detected at all
  if (!runMatch && !wktMatch) {
    showErrorPopup(`Could not detect runs or wickets in player entry.\n\nInput: "${text}"\n\nExample format: "Ali 45 runs 2 wickets for Team A"`);
    return;
  }

  // Match Team Name
  let assignedTeam = null;
  state.teams.forEach(t => {
    if (lower.includes(t.toLowerCase())) assignedTeam = t;
  });
  if (!assignedTeam) assignedTeam = state.teams[0] || "Team A";

  // Match Player Name
  let playerName = "Player";
  const nameMatch = text.match(/(?:add player|player)?\s*([a-zA-Z]+)/i);
  if (nameMatch && nameMatch[1] && !["add", "player", "to", "as", "with", "scored", "for"].includes(nameMatch[1].toLowerCase())) {
    playerName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
  }

  const box = document.getElementById('playerAiChatBox');
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
    reply = `👤 Registered new player ${playerName} for ${assignedTeam} (${runs} runs, ${wickets} wickets).`;
  }

  saveState();
  box.innerHTML += `<div class="chat-msg chat-ai">${reply}</div>`;
  box.scrollTop = box.scrollHeight;
}

// PART 3: MANUAL ICC NRR CALCULATOR
function submitMatchResult() {
  const t1 = document.getElementById("matchTeam1").value;
  const t2 = document.getElementById("matchTeam2").value;
  const r1 = parseInt(document.getElementById("team1Runs").value) || 0;
  const o1 = parseFloat(document.getElementById("team1Overs").value) || 20.0;
  const w1 = parseInt(document.getElementById("team1Wickets").value) || 0;
  
  const r2 = parseInt(document.getElementById("team2Runs").value) || 0;
  const o2 = parseFloat(document.getElementById("team2Overs").value) || 20.0;
  const w2 = parseInt(document.getElementById("team2Wickets").value) || 0;

  if (t1 === t2) {
    showErrorPopup("Invalid Selection: Select two different teams!");
    return;
  }

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

    winner.nrr = ((winner.runsScored / winner.oversFaced) - (winner.runsConceded / winner.oversBowled)).toFixed(3);
    loser.nrr = ((loser.runsScored / loser.oversFaced) - (loser.runsConceded / loser.oversBowled)).toFixed(3);

    state.fixtures.push({
      id: Date.now(),
      title: `Match ${state.fixtures.length + 1}`,
      team1: t1,
      team2: t2,
      result: `${t1} won by ${r1 - r2 > 0 ? (r1 - r2) + " runs" : (10 - w1) + " wickets"}`,
      status: "Completed"
    });

    saveState();
    alert(`Match Logged! ${t1} won & ICC NRR recalculated.`);
  }
}

// PART 4: MANUAL CONTROLS
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

// UI Navigation
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function switchTab(evt, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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

// Boot App
loadState();
