/* CNT-League Tournament Engine
 * Single Semi-Final Bracket + Floating Card Table + Tier Controls (Premier, Gold, Silver, Normal, Eliminated Red)
 */
const SUPABASE_URL = "https://slgsxvwzcmogulsrzgqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_sQmZXNu5XfQ0m5hQ6v-Cog_HS9sLraa";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const generateId = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const TIERS = { Premier: "👑 Premier (Cyan)", Gold: "🥇 Golden", Silver: "🥈 Silver", Normal: "Normal", Red: "🔴 Eliminated (Red Barrier)" };
const BR = [["sf", "admSf"], ["final", "admFinal"]];
const DEFAULT_TEAMS = ["Team A", "Team B", "Team C", "Team D"];

const freshState = () => ({
  rev: 0,
  siteConfig: { eyebrow: "TOURNAMENT DASHBOARD" },
  teams: [...DEFAULT_TEAMS],
  seasons: [1, 2, 3, 4],
  fixtures: [],
  players: [],
  positions: { "Team A": "Premier", "Team B": "Gold", "Team C": "Silver", "Team D": "Red" },
  bracket: {
    sf: { team1: "Team B", team2: "Team C", winner: "" },
    final: { team1: "Team A", team2: "", winner: "" }
  }
});

let state = freshState();
let viewSeason = 1, loaded = false, serverRev = 0, isAdmin = false, adminEmail = "";
let undoStack = [], redoStack = [], feedback = [], S = {};
let pvpViewMode = 'table';
let pendingAiMatch = null;

/* ---------- Cricket Calculations & Points Table ---------- */
const validOvers = v => /^\d+(\.[0-5])?$/.test(String(v).trim());

function oversToBalls(v) {
  const n = parseFloat(v) || 0, o = Math.floor(n);
  return o * 6 + Math.round((n - o) * 10);
}

function computeTable(season) {
  const rows = Object.fromEntries(state.teams.map(n => [n, { name: n, p: 0, w: 0, l: 0, t: 0, rs: 0, bf: 0, rc: 0, bb: 0, pts: 0 }]));
  state.fixtures.filter(f => f.season === season).forEach(f => {
    const a = rows[f.team1], b = rows[f.team2];
    if (!a || !b) return;
    a.p++; b.p++;
    if (f.status !== "Completed") { a.pts++; b.pts++; a.t++; b.t++; return; }
    if (f.winner === f.team1) { a.w++; a.pts += 2; b.l++; }
    else if (f.winner === f.team2) { b.w++; b.pts += 2; a.l++; }
    else { a.t++; b.t++; a.pts++; b.pts++; }
    if (!f.noScore) {
      const lim = (f.oversLimit || 20) * 6;
      const b1 = f.team1Wickets >= 10 ? lim : oversToBalls(f.team1Overs);
      const b2 = f.team2Wickets >= 10 ? lim : oversToBalls(f.team2Overs);
      a.rs += f.team1Runs; a.bf += b1; a.rc += f.team2Runs; a.bb += b2;
      b.rs += f.team2Runs; b.bf += b2; b.rc += f.team1Runs; b.bb += b1;
    }
  });
  return Object.values(rows)
    .map(r => ({ ...r, nrr: r.bf && r.bb ? (r.rs / (r.bf / 6)) - (r.rc / (r.bb / 6)) : 0 }))
    .sort((x, y) => y.pts - x.pts || y.nrr - x.nrr || x.name.localeCompare(y.name));
}

function playerStats(p, seasonScope = 'overall') {
  const b = (seasonScope === 'overall' ? p.base : {}) || {};
  const s = { matches: b.matches || 0, runs: b.runs || 0, wickets: b.wickets || 0, hs: b.hs || 0, hsNo: !!b.hsNo, bw: b.bw || 0, bc: b.bc ?? null };
  
  state.fixtures.forEach(f => {
    if (seasonScope !== 'overall' && f.season !== parseInt(seasonScope)) return;
    (f.perfs || []).forEach(x => {
      if (x.pid !== p.id) return;
      s.matches++; s.runs += x.runs; s.wickets += x.wkts;
      if (x.runs > s.hs || (x.runs === s.hs && x.notOut && !s.hsNo)) { s.hs = x.runs; s.hsNo = x.notOut; }
      if (x.wkts > s.bw || (x.wkts === s.bw && x.wkts > 0 && (s.bc === null || x.conc < s.bc))) { s.bw = x.wkts; s.bc = x.conc; }
    });
  });
  s.hsText = s.hs + (s.hsNo ? "*" : "");
  s.bb = s.bw > 0 ? `${s.bw}/${s.bc ?? "?"}` : "–";
  return s;
}

/* ---------- AI Natural Match Parser ---------- */
function parseNaturalMatchSummary(text) {
  const raw = text.trim();
  if (!raw) return null;

  const seasonMatch = raw.match(/s(?:eason)?\s*(\d+)/i);
  const season = seasonMatch ? parseInt(seasonMatch[1]) : viewSeason;

  const matchedTeams = state.teams.filter(t => new RegExp(`\\b${t.toLowerCase()}\\b`, "i").test(raw));
  if (matchedTeams.length < 2) {
    throw new Error(`Could not identify 2 teams. Available: ${state.teams.join(", ")}`);
  }
  const team1 = matchedTeams[0];
  const team2 = matchedTeams[1];

  const scoreRegex = /(\d{1,3})[\/-](\d{1,2})(?:\s*\(([\d\.]+)\s*(?:ov|overs)?\))?/gi;
  const scores = [...raw.matchAll(scoreRegex)];

  let team1Runs = 0, team1Wickets = 0, team1Overs = "20.0";
  let team2Runs = 0, team2Wickets = 0, team2Overs = "20.0";

  if (scores.length >= 1) {
    team1Runs = parseInt(scores[0][1]);
    team1Wickets = parseInt(scores[0][2]);
    if (scores[0][3]) team1Overs = scores[0][3];
  }
  if (scores.length >= 2) {
    team2Runs = parseInt(scores[1][1]);
    team2Wickets = parseInt(scores[1][2]);
    if (scores[1][3]) team2Overs = scores[1][3];
  }

  let winner = "";
  let result = "Completed Match";
  if (team1Runs > team2Runs) {
    winner = team1;
    result = `${team1} won by ${team1Runs - team2Runs} runs`;
  } else if (team2Runs > team1Runs) {
    winner = team2;
    result = `${team2} won by ${10 - team2Wickets} wickets`;
  } else if (team1Runs > 0 && team1Runs === team2Runs) {
    result = "Match Tied";
  }

  const perfs = [];
  state.players.forEach(p => {
    const nameRegex = new RegExp(`\\b${p.name.toLowerCase()}\\b[\\s:-]*(\\d+)?\\*?\\s*(?:\\(?([0-9\\/]+)?\\)?)?`, "i");
    if (raw.toLowerCase().match(nameRegex)) {
      let runs = 0, wkts = 0, conc = 0, notOut = false;
      const rMatch = raw.match(new RegExp(`${p.name}\\s*(\\d+)(\\*)?`, "i"));
      if (rMatch) { runs = parseInt(rMatch[1]) || 0; notOut = !!rMatch[2]; }
      
      const wMatch = raw.match(new RegExp(`${p.name}\\s*(\\d+)[\\/-](\\d+)`, "i"));
      if (wMatch) { wkts = parseInt(wMatch[1]) || 0; conc = parseInt(wMatch[2]) || 0; }
      
      if (runs > 0 || wkts > 0) perfs.push({ pid: p.id, name: p.name, runs, notOut, wkts, conc });
    }
  });

  return {
    id: generateId(),
    season,
    title: `Match ${state.fixtures.length + 1}: ${team1} vs ${team2}`,
    team1, team2,
    status: "Completed",
    oversLimit: 20,
    team1Runs, team1Wickets, team1Overs,
    team2Runs, team2Wickets, team2Overs,
    winner, result, perfs,
    noScore: false
  };
}

function processAiMatchInput() {
  const text = $("aiMatchInput").value;
  try {
    const parsed = parseNaturalMatchSummary(text);
    if (!parsed) return showError("Please enter match details.");
    pendingAiMatch = parsed;

    $("aiPreviewContent").innerHTML = `
      <strong>Season:</strong> S${parsed.season}<br>
      <strong>Teams:</strong> ${parsed.team1} (${parsed.team1Runs}/${parsed.team1Wickets}, ${parsed.team1Overs} ov) vs ${parsed.team2} (${parsed.team2Runs}/${parsed.team2Wickets}, ${parsed.team2Overs} ov)<br>
      <strong>Winner / Outcome:</strong> ${parsed.result}<br>
      <strong>Extracted Player Perfs:</strong> ${parsed.perfs.length ? parsed.perfs.map(x => `${x.name} (${x.runs} runs, ${x.wkts}/${x.conc})`).join(", ") : "None detected"}
    `;
    $("aiPreviewBox").style.display = "block";
  } catch (err) {
    showError("AI Parser Note: " + err.message);
  }
}

async function confirmSaveAiMatch() {
  if (!pendingAiMatch) return;
  const ok = await commit(() => state.fixtures.push(pendingAiMatch), "🏏 AI Match successfully saved!");
  if (ok) {
    $("aiPreviewBox").style.display = "none";
    $("aiMatchInput").value = "";
    pendingAiMatch = null;
  }
}

/* ---------- UI Helpers & Modals ---------- */
function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg;
  $("toasts").appendChild(t); setTimeout(() => t.remove(), 3200);
}

function showError(msg) { $("errorMessageText").textContent = msg; openModal("errorModal"); return false; }

let lastFocus = null;
function openModal(id) {
  lastFocus = document.activeElement;
  const m = $(id); m.style.display = "flex";
  (m.querySelector("input:not([hidden]),button,select") || m).focus();
}

function closeModal(id) { $(id).style.display = "none"; lastFocus?.focus?.(); }
const adminOpen = () => $("adminModal").style.display === "flex";

function askDialog({ title = "Confirm", message = "", input = null, okText = "OK" }) {
  return new Promise(res => {
    $("dlgTitle").textContent = title; $("dlgMsg").textContent = message;
    const i = $("dlgInput"); i.hidden = input === null; i.value = input ?? "";
    $("dlgOk").textContent = okText;
    const done = v => { closeModal("dialogModal"); $("dlgOk").onclick = $("dlgCancel").onclick = null; res(v); };
    $("dlgOk").onclick = () => done(input === null ? true : i.value);
    $("dlgCancel").onclick = () => done(input === null ? false : null);
    openModal("dialogModal"); (input === null ? $("dlgOk") : i).focus();
  });
}

function setSync(status, isErr = false) {
  const el = $("serverLastSync"), st = $("serverStatus");
  if (el) el.textContent = `${status} (${new Date().toLocaleTimeString()})`;
  if (st) { st.textContent = isErr ? "🔴 Problem" : "🟢 Connected"; st.style.color = isErr ? "var(--red)" : "var(--teal)"; }
}

function toggleMobileMenu() {
  const links = $("navLinks");
  const toggle = $("mobileMenuToggle");
  const isOpen = links.classList.toggle("mobile-open");
  if (toggle) toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closeMobileMenu() {
  $("navLinks").classList.remove("mobile-open");
  const toggle = $("mobileMenuToggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function switchTab(btn, id) {
  document.querySelectorAll(".admin-sidebar .tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  btn.classList.add("active"); $(id).classList.add("active");
}

/* ---------- Persistence & Database Sync ---------- */
function migrate(raw) {
  const d = freshState(), s = { ...d, ...raw };
  s.siteConfig = { ...d.siteConfig, ...raw.siteConfig };
  s.bracket = { ...d.bracket, ...raw.bracket };
  s.positions = { ...raw.positions };
  if (!Array.isArray(s.seasons)) s.seasons = [1, 2, 3, 4];
  s.teams = Array.isArray(raw.teams) && raw.teams.length ? raw.teams : [...DEFAULT_TEAMS];
  s.teams.forEach(t => { if (!s.positions[t]) s.positions[t] = "Normal"; });
  s.fixtures = (raw.fixtures || []).map(f => ({ season: 1, status: "Completed", oversLimit: 20, ...f }));
  s.players = (raw.players || []).map(p => p.base ? p : {
    ...p,
    base: { matches: p.matches || 0, runs: p.runs || 0, wickets: p.wickets || 0, hs: p.highestScore || 0, hsNo: false, bw: p.bestWickets || 0, bc: null }
  });
  return s;
}

async function loadState() {
  setSync("Fetching…");
  try {
    const { data, error } = await db.from("cnt_league").select("state").eq("id", 1).maybeSingle();
    if (error) throw error;
    state = migrate(data?.state || {}); serverRev = Number(state.rev || 0); loaded = true;
    setSync("Synced");
  } catch (e) {
    console.error("Cloud load error:", e); setSync("Load failed", true);
    toast("Could not load cloud data.", true);
  }
  if (!state.seasons.includes(viewSeason)) viewSeason = state.seasons[0];
  renderAll();
}

async function saveState() {
  if (!loaded) return showError("Data has not loaded from cloud yet.");
  if (!isAdmin) return showError("Please log in as admin to save.");
  setSync("Saving…");
  try {
    const { data: r, error: e1 } = await db.from("cnt_league").select("rev:state->>rev").eq("id", 1).maybeSingle();
    if (e1) throw e1;
    if (r && Number(r.rev || 0) !== serverRev) {
      showError("Conflict detected: Reloading latest server version.");
      await loadState(); return "conflict";
    }
    state.rev = serverRev + 1;
    const { error } = await db.from("cnt_league").upsert({ id: 1, state });
    if (error) throw error;
    serverRev = state.rev; setSync("Saved"); return true;
  } catch (e) {
    console.error("Cloud save error:", e); setSync("Save failed", true);
    showError("Failed to save changes."); return false;
  }
}

async function commit(fn, okMsg) {
  if (!isAdmin) return showError("Please log in as admin.");
  const snap = JSON.stringify(state);
  fn();
  undoStack.push(snap); if (undoStack.length > 25) undoStack.shift(); redoStack = [];
  renderAll();
  const ok = await saveState();
  if (ok === false) { state = JSON.parse(snap); undoStack.pop(); renderAll(); }
  else if (ok === true && okMsg) toast(okMsg);
  updateHistoryButtons();
  return ok === true;
}

async function stepHistory(from, to) {
  if (!from.length || !isAdmin) return;
  const cur = JSON.stringify(state), snap = from.pop();
  to.push(cur); state = JSON.parse(snap); renderAll();
  if ((await saveState()) === false) { state = JSON.parse(cur); to.pop(); from.push(snap); renderAll(); }
  updateHistoryButtons();
}
const undoAction = () => stepHistory(undoStack, redoStack);
const redoAction = () => stepHistory(redoStack, undoStack);
function updateHistoryButtons() { $("btnUndo").disabled = !undoStack.length; $("btnRedo").disabled = !redoStack.length; }

/* ---------- Auth ---------- */
function setAdmin(session) {
  isAdmin = !!session; adminEmail = session?.user?.email || "";
  $("adminNavBtn").textContent = isAdmin ? "ADMIN PANEL" : "ADMIN LOG-IN";
  if (!isAdmin) closeModal("adminModal"); else setTimeout(loadFeedback, 0);
}

async function initAuth() {
  const { data } = await db.auth.getSession(); setAdmin(data.session);
  db.auth.onAuthStateChange((_e, s) => setAdmin(s));
}

const adminNavClick = () => isAdmin ? openAdmin() : openModal("loginModal");
function openAdmin() { openModal("adminModal"); $("editEyebrow").value = state.siteConfig.eyebrow; renderAdmin(); loadFeedback(); }

async function login(e) {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({ email: $("adminEmail").value.trim(), password: $("adminPassword").value });
  $("adminPassword").value = "";
  if (error) return showError("Login failed: " + error.message);
  closeModal("loginModal"); openAdmin();
}
async function logout() { await db.auth.signOut(); toast("Signed out"); }

/* ---------- Public Feedback ---------- */
async function submitFeedback(e) {
  e.preventDefault();
  const name = clean($("feedbackName").value, 60), message = String($("feedbackMessage").value).trim().slice(0, 1000);
  if (!name || !message) return showError("Please fill in name and message.");
  const { error } = await db.from("cnt_feedback").insert({ name, message });
  if (error) return showError("Could not send feedback.");
  $("feedbackName").value = ""; $("feedbackMessage").value = ""; toast("📨 Message sent to admin");
}

async function loadFeedback() {
  if (!isAdmin) return;
  const { data } = await db.from("cnt_feedback").select("*").order("created_at", { ascending: false }).limit(200);
  feedback = data || []; renderNotifications();
}
async function markRead(id) { await db.from("cnt_feedback").update({ read: true }).eq("id", id); loadFeedback(); }
async function deleteFeedback(id) { await db.from("cnt_feedback").delete().eq("id", id); loadFeedback(); }

/* ---------- Public Rendering ---------- */
function renderAll() { renderPublic(); if (adminOpen()) renderAdmin(); }

function fillSelect(id, pairs) {
  const el = $(id); if (!el) return;
  const prev = el.value;
  el.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (pairs.some(([v]) => String(v) === prev)) el.value = prev;
}

function renderPublic() {
  const scope = $("statScopeSelect") ? $("statScopeSelect").value : "overall";
  S = Object.fromEntries(state.players.map(p => [p.id, playerStats(p, scope)]));
  $("siteEyebrow").textContent = state.siteConfig.eyebrow;

  if ($("statScopeSelect")) {
    const prevScope = $("statScopeSelect").value;
    $("statScopeSelect").innerHTML = `<option value="overall">All Seasons (Overall)</option>` +
      state.seasons.map(s => `<option value="${s}">Season ${s} Only</option>`).join("");
    if (prevScope) $("statScopeSelect").value = prevScope;
  }

  const recentMatch = state.fixtures[state.fixtures.length - 1];
  if (recentMatch) {
    $("tickerText").textContent = `LATEST RESULT: ${recentMatch.title} — ${recentMatch.result}`;
  }

  $("seasonsGrid").innerHTML = state.seasons.map(i => `
    <button class="season-card ${viewSeason === i ? "active" : ""}" data-act="season" data-id="${i}" aria-pressed="${viewSeason === i}">
      <div class="kicker">SEASON 0${i}</div><h3>Season ${i}</h3>
      <span class="status">${viewSeason === i ? "● ACTIVE VIEW" : "◷ SELECT"}</span>
    </button>`).join("");

  $("standingsTitle").textContent = `Points Table — Season ${viewSeason}`;
  const rows = computeTable(viewSeason);
  
  // Render exact image-style floating rows with assigned Tiers
  $("pointsBody").innerHTML = rows.length ? rows.map((t, i) => {
    const userTier = state.positions[t.name] || (i === 0 ? "Premier" : i === 1 ? "Gold" : i === 2 ? "Silver" : "Normal");
    let rowClass = "row-normal";
    if (userTier === "Premier") rowClass = "row-premier";
    else if (userTier === "Gold") rowClass = "row-gold";
    else if (userTier === "Silver") rowClass = "row-silver";
    else if (userTier === "Red") rowClass = "row-red"; // Full Red Barrier Tier

    return `
    <tr class="${rowClass}">
      <td class="sticky-col"><strong>${i + 1}</strong></td>
      <td class="sticky-col-2"><strong>${esc(t.name)}</strong></td>
      <td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${t.t}</td>
      <td class="nrr">${(t.nrr > 0 ? "+" : "") + t.nrr.toFixed(3)}</td><td class="pts">${t.pts}</td>
    </tr>`;
  }).join("")
  : `<tr><td colspan="8" class="empty">No teams added yet.</td></tr>`;

  renderBracketPublic(); renderFixtures(); renderPvP(); renderPlayers();
  fillSelect("teamFilter", [["All", "All Teams"], ...state.teams.map(t => [t, t])]);
}

/* Single Semi-Final Visual Playoff Bracket */
function renderBracketPublic() {
  const b = state.bracket;
  const card = (t, m) => `
    <div class="bracket-card">
      <div class="bracket-title">${t}</div>
      ${[m.team1, m.team2].map(x => `
        <div class="bracket-team ${m.winner && m.winner === x ? "win" : ""}">
          <span>${esc(x || "TBD")}</span>
          <span>${m.winner && m.winner === x ? "🏆 WINNER" : ""}</span>
        </div>`).join("")}
    </div>`;

  $("bracketGrid").innerHTML = `
    <div class="bracket-round">
      ${card("Semi-Final", b.sf)}
    </div>
    <div class="bracket-round">
      ${card("Grand Final", b.final)}
    </div>`;
  $("championBanner").innerHTML = b.final.winner ? `<div class="champion">🏆 CHAMPIONS: ${esc(b.final.winner)}</div>` : "";
}

function renderFixtures() {
  const list = [...state.fixtures].reverse();
  $("fixturesBody").innerHTML = list.length ? list.map(f => `
    <tr><td>${esc(f.title)}</td><td>S${f.season}</td>
    <td><strong>${esc(f.team1)}</strong> vs <strong>${esc(f.team2)}</strong></td><td>${esc(f.result)}</td>
    <td><button class="btn secondary mini" data-act="match" data-id="${f.id}">🔍 Details</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No match records logged.</td></tr>`;
}

function showMatchDetails(id) {
  const m = state.fixtures.find(x => x.id === id); if (!m) return;
  $("detailMatchTitle").textContent = `${m.title}: ${m.team1} vs ${m.team2}`;
  $("detailMatchStatus").textContent = `Season ${m.season} · ${m.status}`;
  $("detailTeam1Name").textContent = m.team1; $("detailTeam2Name").textContent = m.team2;
  const sc = n => m.noScore ? "Score not recorded" : `${m[`team${n}Runs`]}/${m[`team${n}Wickets`]} (${m[`team${n}Overs`]} ov)`;
  $("detailTeam1Score").textContent = sc(1); $("detailTeam2Score").textContent = sc(2);
  $("detailMatchSummaryText").textContent = m.result;
  const perfs = m.perfs || [];
  $("detailPerfBox").hidden = !perfs.length;
  $("detailPerfs").innerHTML = perfs.map(x => {
    const p = state.players.find(q => q.id === x.pid);
    return `<div>${esc(p ? p.name : "Unknown")}: ${x.runs}${x.notOut ? "*" : ""} runs · ${x.wkts}/${x.conc} bowling</div>`;
  }).join("");
  openModal("matchDetailModal");
}

function togglePvpView(mode) {
  pvpViewMode = mode;
  $("btnPvpTable").classList.toggle("active", mode === "table");
  $("btnPvpGraph").classList.toggle("active", mode === "graph");
  updatePvP();
}

function renderPvP() {
  const p1 = $("pvpPlayer1Select"), p2 = $("pvpPlayer2Select");
  if (!state.players.length) return;
  const opts = state.players.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.team)})</option>`).join("");
  p1.innerHTML = p2.innerHTML = opts;
  if (state.players.length > 1) p2.selectedIndex = 1;
  updatePvP();
}

function updatePvP() {
  const a = state.players.find(p => String(p.id) === $("pvpPlayer1Select").value);
  const b = state.players.find(p => String(p.id) === $("pvpPlayer2Select").value);
  const box = $("pvpComparisonBox");
  if (!a || !b) { box.innerHTML = '<div class="empty">Select 2 players to compare.</div>'; return; }
  const x = S[a.id] || {}, y = S[b.id] || {};

  if (pvpViewMode === 'graph') {
    const renderGraphBar = (label, valA, valB) => {
      const total = (valA + valB) || 1;
      const pctA = Math.round((valA / total) * 100);
      const pctB = 100 - pctA;
      return `
        <div class="graph-row">
          <div class="graph-label"><span>${valA}</span><span>${label}</span><span>${valB}</span></div>
          <div class="graph-bar-container">
            <div class="graph-bar-left" style="width: ${pctA}%"></div>
            <div class="graph-bar-right" style="width: ${pctB}%"></div>
          </div>
        </div>`;
    };
    box.innerHTML = `
      <div class="pvp-stat-row mb10"><strong class="gold">${esc(a.name)}</strong><span class="sub">VS</span><strong class="teal">${esc(b.name)}</strong></div>
      ${renderGraphBar("MATCHES", x.matches || 0, y.matches || 0)}
      ${renderGraphBar("RUNS", x.runs || 0, y.runs || 0)}
      ${renderGraphBar("HIGHEST SCORE", x.hs || 0, y.hs || 0)}
      ${renderGraphBar("WICKETS", x.wickets || 0, y.wickets || 0)}
    `;
  } else {
    const cmp = (lab, va = 0, vb = 0, color, fa = va, fb = vb) => `<div class="pvp-stat-row">
      <strong style="color:${va >= vb ? color : "var(--text-main)"}">${esc(fa)}</strong><span class="sub">${lab}</span>
      <strong style="color:${vb >= va ? color : "var(--text-main)"}">${esc(fb)}</strong></div>`;
    box.innerHTML = `
      <div class="pvp-stat-row"><strong class="gold">${esc(a.name)}</strong><span class="sub">NAME</span><strong class="gold">${esc(b.name)}</strong></div>
      <div class="pvp-stat-row"><span>${esc(a.team)}</span><span class="sub">TEAM</span><span>${esc(b.team)}</span></div>
      ${cmp("MATCHES", x.matches, y.matches, "var(--teal)")}
      ${cmp("TOTAL RUNS", x.runs, y.runs, "var(--orange)")}
      ${cmp("HIGHEST SCORE", x.hs, y.hs, "var(--gold)", x.hsText, y.hsText)}
      ${cmp("TOTAL WICKETS", x.wickets, y.wickets, "var(--purple)")}
      ${cmp("BEST BOWLING", x.bw, y.bw, "var(--purple)", x.bb, y.bb)}`;
  }
}

function renderPlayers() {
  const q = clean($("playerSearch").value).toLowerCase(), team = $("teamFilter").value, role = $("roleFilter").value;
  const list = state.players.filter(p => (p.name + " " + p.team).toLowerCase().includes(q) && (team === "All" || p.team === team) && (role === "All" || p.role === role));
  $("playerGrid").innerHTML = list.length ? list.map(p => {
    const s = S[p.id] || {};
    return `<article class="player-card">
      <div class="name">${esc(p.name)}</div>
      <div class="sub">${esc(p.team)} · ${esc(p.role)}</div>
      <div class="stat-grid">
        <div class="stat-cell"><span class="sub">Matches</span><br><strong>${s.matches || 0}</strong></div>
        <div class="stat-cell"><span class="sub">Runs</span><br><strong style="color:var(--orange)">${s.runs || 0}</strong></div>
        <div class="stat-cell"><span class="sub">Highest Score</span><br><strong class="gold">${esc(s.hsText || "0")}</strong></div>
        <div class="stat-cell"><span class="sub">Wickets</span><br><strong style="color:var(--purple)">${s.wickets || 0}</strong></div>
      </div></article>`;
  }).join("") : '<div class="sub">No player records found.</div>';
}

/* ---------- Admin Workspace Rendering ---------- */
function renderAdmin() {
  const teamPairs = state.teams.map(t => [t, t]);
  fillSelect("manualPlayerTeam", teamPairs);
  renderBracketAdmin();

  // Tier Assignment Dropdowns for Teams
  $("adminPositionsContainer").innerHTML = state.teams.map(t => `
    <div class="list-item mt6 row-between">
      <strong>${esc(t)}</strong>
      <select onchange="setTier('${esc(t)}', this.value)" aria-label="Tier for ${esc(t)}" style="max-width:220px;">
        ${Object.entries(TIERS).map(([k, l]) => `<option value="${k}" ${(state.positions[t] || "Normal") === k ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>`).join("");

  $("teamsListContainer").innerHTML = state.teams.map(t => `<span class="chip">${esc(t)}
    <button data-act="renameTeam" data-name="${esc(t)}">✏️</button>
    <button data-act="deleteTeam" data-name="${esc(t)}">➖</button></span>`).join("");

  $("playersListContainer").innerHTML = state.players.length ? state.players.map(p => `<span class="chip">${esc(p.name)} (${esc(p.team)})
    <button class="red" data-act="deletePlayer" data-id="${p.id}">×</button></span>`).join("")
    : '<span class="sub">No players yet.</span>';

  $("matchesManageList").innerHTML = state.fixtures.length ? [...state.fixtures].reverse().map(f => `
    <div class="list-item mt6"><span>S${f.season} · <strong>${esc(f.title)}</strong> — ${esc(f.result)}</span>
    <button class="btn danger mini" data-act="deleteMatch" data-id="${f.id}">Delete</button></div>`).join("")
    : '<div class="sub">No matches saved.</div>';

  $("serverRawJson").value = JSON.stringify(state, null, 2);
  renderNotifications(); updateHistoryButtons();
}

function renderNotifications() {
  const unread = feedback.filter(n => !n.read).length;
  $("notifBadge").textContent = unread;
  $("adminNotificationsList").innerHTML = feedback.length ? feedback.map(n => `
    <div class="notif mt10 inset">
      <div class="row-between"><strong class="gold small">From: ${esc(n.name)}</strong><span class="sub">${esc(new Date(n.created_at).toLocaleString())}</span></div>
      <p class="mt6">${esc(n.message)}</p>
      <div class="row-between mt6"><span></span><span>
        ${n.read ? '<span class="sub">✓ Read</span>' : `<button class="btn secondary mini" data-act="readNotif" data-id="${n.id}">Mark read</button>`}
        <button class="btn danger mini" data-act="delNotif" data-id="${n.id}">Delete</button></span></div>
    </div>`).join("") : '<div class="sub">No feedback.</div>';
}

function renderBracketAdmin() {
  const opts = cur => `<option value="">— TBD —</option>` + state.teams.map(t => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
  BR.forEach(([k, p]) => {
    const m = state.bracket[k] || {};
    $(p + "Team1").innerHTML = opts(m.team1); $(p + "Team2").innerHTML = opts(m.team2);
    fillWinner(p, m.winner);
  });
}

function fillWinner(p, cur) {
  const teams = [...new Set([$(p + "Team1").value, $(p + "Team2").value].filter(Boolean))];
  $(p + "Winner").innerHTML = `<option value="">No winner yet</option>` + teams.map(t => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
}

function saveBracket() {
  const nb = {
    sf: { team1: $("admSfTeam1").value, team2: $("admSfTeam2").value, winner: $("admSfWinner").value },
    final: { team1: $("admFinalTeam1").value, team2: $("admFinalTeam2").value, winner: $("admFinalWinner").value }
  };
  if (nb.sf.winner && !nb.final.team2) nb.final.team2 = nb.sf.winner;
  commit(() => state.bracket = nb, "🏆 Bracket updated");
}

/* ---------- Data Management Actions ---------- */
const dup = n => state.teams.some(t => t.toLowerCase() === n.toLowerCase());

function addTeam() {
  const n = clean($("newTeamName").value, 40);
  if (!n) return showError("Team name cannot be empty.");
  if (dup(n)) return showError(`Team '${n}' already exists.`);
  $("newTeamName").value = "";
  commit(() => { state.teams.push(n); state.positions[n] = "Normal"; }, "Team added");
}

async function deleteTeam(name) {
  if (state.fixtures.some(f => f.team1 === name || f.team2 === name)) return showError(`'${name}' has saved matches.`);
  if (!await askDialog({ title: "Delete team", message: `Delete ${name}?`, okText: "Delete" })) return;
  commit(() => {
    state.teams = state.teams.filter(t => t !== name); delete state.positions[name];
    Object.values(state.bracket).forEach(m => ["team1", "team2", "winner"].forEach(k => { if (m[k] === name) m[k] = ""; }));
  }, "Team deleted");
}

async function renameTeam(old) {
  const v = await askDialog({ title: "Rename team", message: `New name for '${old}':`, input: old, okText: "Rename" });
  const n = clean(v, 40);
  if (!n || n === old || dup(n)) return;
  commit(() => {
    state.teams[state.teams.indexOf(old)] = n;
    state.positions[n] = state.positions[old]; delete state.positions[old];
    state.players.forEach(p => { if (p.team === old) p.team = n; });
    state.fixtures.forEach(f => ["team1", "team2", "winner"].forEach(k => { if (f[k] === old) f[k] = n; }));
  }, `Renamed to ${n}`);
}

const setTier = (team, tier) => commit(() => state.positions[team] = tier, "Tier updated");
const addSeason = () => commit(() => state.seasons.push(Math.max(...state.seasons) + 1), "Season added");
const saveSiteText = () => { const v = clean($("editEyebrow").value, 60); if (v) commit(() => state.siteConfig.eyebrow = v, "Tagline saved"); };

function addPlayer() {
  const name = clean($("manualPlayerName").value, 40);
  if (!name) return showError("Enter player name.");
  const num = id => Math.max(0, parseInt($(id).value) || 0);
  const team = $("manualPlayerTeam").value, role = $("manualPlayerRole").value;
  const matches = num("manualPlayerMatches"), runs = num("manualPlayerRuns"), wickets = num("manualPlayerWickets");

  commit(() => {
    state.players.push({
      id: generateId(), name, team, role,
      base: { matches, runs, wickets, hs: runs, hsNo: false, bw: wickets, bc: null }
    });
  }, "Player saved");
}

async function deletePlayer(id) {
  if (await askDialog({ title: "Remove player", message: "Remove player?", okText: "Remove" }))
    commit(() => state.players = state.players.filter(p => p.id !== id), "Player removed");
}

async function deleteMatch(id) {
  if (await askDialog({ title: "Delete match", message: "Delete this match?", okText: "Delete" }))
    commit(() => state.fixtures = state.fixtures.filter(f => f.id !== id), "Match deleted");
}

async function resetDefaultData() {
  const v = await askDialog({ title: "Wipe tournament", message: "Type RESET to confirm.", input: "", okText: "Wipe" });
  if (v === "RESET") { await commit(() => state = freshState()); undoStack = []; redoStack = []; }
}

/* Event Routing */
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act, id = btn.dataset.id, name = btn.dataset.name;

  switch (act) {
    case "season": viewSeason = +id; renderAll(); break;
    case "match": showMatchDetails(id); break;
    case "deleteMatch": deleteMatch(id); break;
    case "deleteTeam": deleteTeam(name); break;
    case "renameTeam": renameTeam(name); break;
    case "deletePlayer": deletePlayer(id); break;
    case "readNotif": markRead(id); break;
    case "delNotif": deleteFeedback(id); break;
  }
});

window.addEventListener("DOMContentLoaded", () => {
  initAuth();
  loadState();
});
