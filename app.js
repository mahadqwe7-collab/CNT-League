// Supabase Database Initialization
const SUPABASE_URL = "https://slgsxvwzcmogulsrzgqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_sQmZXNu5XfQ0m5hQ6v-Cog_HS9sLraa";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Default Tournament Constants
const DEFAULT_TEAMS = ["Team A", "Team B", "Team C", "Team D"];

// State Management Container
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

// Initialize Season Data Structure
function initSeasons(teamList) {
  const data = {};
  for (let i = 1; i <= 4; i++) {
    data[i] = teamList.map(name => ({
      name, played: 0, won: 0, lost: 0, nrr: "0.000", points: 0
    }));
  }
  return data;
}
state.seasons = initSeasons(state.teams);

// Cloud Database Synchronization (Supabase)
async function loadState() {
  try {
    const { data, error } = await db.from('cnt_league').select('state').eq('id', 1).single();
    if (data && data.state && Object.keys(data.state).length > 0) {
      state = data.state;
    }
  } catch (e) {
    console.error("Cloud DB fetch error:", e);
  }
  renderAll();
}

async function saveState() {
  renderAll(); // Immediate UI feedback
  try {
    await db.from('cnt_league').upsert({ id: 1, state: state });
  } catch (e) {
    console.error("Cloud DB save error:", e);
  }
}

// Master Rendering Function
function renderAll() {
  document.getElementById("siteEyebrow").innerText = state.siteConfig.eyebrow;
  document.getElementById("heroTitle").innerHTML = state.siteConfig.heroHeading;

  renderSeasonsGrid();
  renderStandings();
  renderFixtures();
  renderPlayers();
  populateDropdowns();
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
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No teams registered.</td></tr>`;
}

function renderFixtures() {
  const tbody = document.getElementById("fixturesBody");
  tbody.innerHTML = state.fixtures.length ? state.fixtures.map(f => `
    <tr>
      <td>${f.title}</td><td>${f.team1} vs ${f.team2}</td>
      <td>${f.result}</td><td><span class="eyebrow" style="padding:2px 8px">${f.status}</span></td>
    </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:var(--muted)">No matches scheduled.</td></tr>`;
}

function renderPlayers() {
  const q = document.getElementById("playerSearch").value.toLowerCase();
  const team = document.getElementById("teamFilter").value;
  const role = document.getElementById("roleFilter").value;

  // Identify Leader Cap Winners
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
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">Runs</span><br><strong>${p.runs}</strong></div>
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">SR</span><br><strong>${p.strikeRate}</strong></div>
        <div style="background:#060d17;padding:6px;border-radius:6px"><span class="sub">Wickets</span><br><strong>${p.wickets}</strong></div>
      </div>
    </article>`;
  }).join("") : '<div class="sub">No player records found.</div>';
}

function populateDropdowns() {
  const filter = document.getElementById("teamFilter");
  filter.innerHTML = `<option value="All">All Teams</option>` + state.teams.map(t => `<option value="${t}">${t}</option>`).join("");
}

// Engine-Automated Functions
function autoGenerateFixtures() {
  if (state.teams.length < 2) return alert("Need at least 2 teams!");
  state.fixtures = [];
  let matchNo = 1;
  for (let i = 0; i < state.teams.length; i++) {
    for (let j = i + 1; j < state.teams.length; j++) {
      state.fixtures.push({
        id: Date.now() + matchNo,
        title: `Match ${matchNo++}`,
        team1: state.teams[i],
        team2: state.teams[j],
        result: "TBD",
        status: "Upcoming"
      });
    }
  }
  saveState();
  alert("Round Robin Fixtures Generated!");
}

function recalculateStats() {
  saveState();
  alert("Leaderboard & Caps recalculations finished!");
}

// AI Command Processor
function sendAIChatCommand() {
  const input = document.getElementById('aiUserPrompt');
  const text = input.value.trim();
  if (!text) return;

  const box = document.getElementById('aiChatBox');
  box.innerHTML += `<div class="chat-msg chat-user">${text}</div>`;
  input.value = "";

  let reply = "🤖 Command not recognized.";
  const lower = text.toLowerCase();

  if (lower.startsWith("add team")) {
    const name = text.substring(8).trim();
    if (name && !state.teams.includes(name)) {
      state.teams.push(name);
      for (let s in state.seasons) state.seasons[s].push({ name, played: 0, won: 0, lost: 0, nrr: "0.000", points: 0 });
      saveState();
      reply = `✅ Team '${name}' added!`;
    }
  } else if (lower.includes("beat")) {
    state.teams.forEach(t1 => {
      state.teams.forEach(t2 => {
        if (t1 !== t2 && lower.includes(t1.toLowerCase()) && lower.includes(t2.toLowerCase())) {
          const cur = state.seasons[state.activeSeason];
          const w = cur.find(x => x.name.toLowerCase() === t1.toLowerCase());
          const l = cur.find(x => x.name.toLowerCase() === t2.toLowerCase());
          if (w && l) {
            w.played++; w.won++; w.points += 2;
            l.played++; l.lost++;
            state.fixtures.push({ id: Date.now(), title: "Match", team1: w.name, team2: l.name, result: `${w.name} won`, status: "Completed" });
            saveState();
            reply = `🏆 Match logged: ${w.name} defeated ${l.name}!`;
          }
        }
      });
    });
  } else if (lower.startsWith("add player")) {
    const nameMatch = text.match(/add player\s+([a-zA-Z0-9\s]+?)\s+to/i);
    const pName = nameMatch ? nameMatch[1].trim() : "Player";
    const runMatch = text.match(/(\d+)\s*runs/i);
    const runs = runMatch ? parseInt(runMatch[1]) : 0;

    state.players.push({ id: Date.now(), name: pName, team: state.teams[0], role: "Batter", matches: 1, runs: runs, strikeRate: "120.0", wickets: 0 });
    saveState();
    reply = `👤 Player '${pName}' registered with ${runs} runs.`;
  }

  box.innerHTML += `<div class="chat-msg chat-ai">${reply}</div>`;
  box.scrollTop = box.scrollHeight;
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

// UI Navigation & Auth Handlers
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

// Boot Engine
loadState();
