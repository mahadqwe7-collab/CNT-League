/* CNT-League engine
 * Security model: the browser only HIDES admin UI. Real protection is Supabase Auth + Row Level Security
 * (see the SQL I gave you). Never rely on client-side checks alone.
 */
const SUPABASE_URL = "https://slgsxvwzcmogulsrzgqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_sQmZXNu5XfQ0m5hQ6v-Cog_HS9sLraa";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const TIERS = { Premier: "👑 Premier", Gold: "🥇 Golden", Silver: "🥈 Silver", Normal: "Normal", Red: "🔴 Eliminated" };
const BR = [["sf1", "admSf1"], ["sf2", "admSf2"], ["final", "admFinal"]];
const DEFAULT_TEAMS = ["Team A", "Team B", "Team C", "Team D"];

const freshState = () => ({
  rev: 0,
  siteConfig: { eyebrow: "TOURNAMENT DASHBOARD" },
  teams: [...DEFAULT_TEAMS],
  seasons: [1, 2, 3, 4],
  fixtures: [],
  players: [],
  positions: { "Team A": "Premier", "Team B": "Gold", "Team C": "Silver", "Team D": "Normal" },
  bracket: {
    sf1: { team1: "Team A", team2: "Team D", winner: "" },
    sf2: { team1: "Team B", team2: "Team C", winner: "" },
    final: { team1: "", team2: "", winner: "" }
  }
});

let state = freshState();
let viewSeason = 1, loaded = false, serverRev = 0, isAdmin = false, adminEmail = "";
let undoStack = [], redoStack = [], feedback = [], S = {};

/* ---------- Cricket maths ---------- */
const validOvers = v => /^\d+(\.[0-5])?$/.test(String(v).trim());
function oversToBalls(v) {
  const n = parseFloat(v) || 0, o = Math.floor(n);
  return o * 6 + Math.round((n - o) * 10);
}
const ballsToOvers = b => `${Math.floor(b / 6)}.${b % 6}`;

/* Standings are DERIVED from fixtures, so deleting a match cleanly reverses everything. */
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
    .map(r => ({ ...r, nrr: r.bf && r.bb ? r.rs / (r.bf / 6) - r.rc / (r.bb / 6) : 0 }))
    .sort((x, y) => y.pts - x.pts || y.nrr - x.nrr || x.name.localeCompare(y.name));
}

/* Player careers = manual base + every performance in saved matches. */
function playerStats(p) {
  const b = p.base || {};
  const s = { matches: b.matches || 0, runs: b.runs || 0, wickets: b.wickets || 0, hs: b.hs || 0, hsNo: !!b.hsNo, bw: b.bw || 0, bc: b.bc ?? null };
  state.fixtures.forEach(f => (f.perfs || []).forEach(x => {
    if (x.pid !== p.id) return;
    s.matches++; s.runs += x.runs; s.wickets += x.wkts;
    if (x.runs > s.hs || (x.runs === s.hs && x.notOut && !s.hsNo)) { s.hs = x.runs; s.hsNo = x.notOut; }
    if (x.wkts > s.bw || (x.wkts === s.bw && x.wkts > 0 && (s.bc === null || x.conc < s.bc))) { s.bw = x.wkts; s.bc = x.conc; }
  }));
  s.hsText = s.hs + (s.hsNo ? "*" : "");
  s.bb = s.bw > 0 ? `${s.bw}/${s.bc ?? "?"}` : "–";
  return s;
}

/* ---------- UI helpers ---------- */
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

document.addEventListener("keydown", e => {
  const open = [...document.querySelectorAll(".modal-overlay")].filter(m => m.style.display === "flex").pop();
  if (!open) return;
  if (e.key === "Escape") { open.id === "dialogModal" ? $("dlgCancel").click() : closeModal(open.id); return; }
  if (e.key === "Tab") {
    const f = [...open.querySelectorAll("button:not([disabled]),input:not([hidden]),select,textarea,a[href]")].filter(x => x.offsetParent);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});

function setSync(status, isErr = false) {
  const el = $("serverLastSync"), st = $("serverStatus");
  if (el) el.textContent = `${status} (${new Date().toLocaleTimeString()})`;
  if (st) { st.textContent = isErr ? "🔴 Problem" : "🟢 Connected"; st.style.color = isErr ? "var(--red)" : "var(--teal)"; }
}
function toggleMobileMenu() { $("navLinks").classList.toggle("mobile-open"); }
function closeMobileMenu() { $("navLinks").classList.remove("mobile-open"); }
function switchTab(btn, id) {
  document.querySelectorAll(".admin-sidebar .tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  btn.classList.add("active"); $(id).classList.add("active");
}

/* ---------- Persistence ---------- */
function migrate(raw) {
  const d = freshState(), s = { ...d, ...raw };
  s.siteConfig = { ...d.siteConfig, ...raw.siteConfig };
  s.bracket = { ...d.bracket, ...raw.bracket };
  s.positions = { ...raw.positions };
  if (!Array.isArray(s.seasons)) s.seasons = [1, 2, 3, 4];
  s.teams = Array.isArray(raw.teams) && raw.teams.length ? raw.teams : [...DEFAULT_TEAMS];
  s.teams.forEach(t => { if (!s.positions[t]) s.positions[t] = "Normal"; });
  s.fixtures = (raw.fixtures || []).map(f => {
    f = { season: 1, status: "Completed", oversLimit: 20, ...f };
    if (!("winner" in f)) { f.winner = f.team1; f.noScore = true; }
    return f;
  });
  s.players = (raw.players || []).map(p => p.base ? p : {
    ...p,
    base: { matches: p.matches || 0, runs: p.runs || 0, wickets: p.wickets || 0, hs: p.highestScore || 0, hsNo: false, bw: p.bestWickets || 0, bc: null }
  });
  delete s.notifications; delete s.activeSeason;
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
    toast("Could not load data from the cloud. Editing is disabled until it loads.", true);
  }
  if (!state.seasons.includes(viewSeason)) viewSeason = state.seasons[0];
  renderAll();
}

/* returns true | false | "conflict" */
async function saveState() {
  if (!loaded) return showError("Data has not loaded from the cloud yet. Reload the page.");
  if (!isAdmin) return showError("Please log in as admin to save changes.");
  setSync("Saving…");
  try {
    const { data: r, error: e1 } = await db.from("cnt_league").select("rev:state->>rev").eq("id", 1).maybeSingle();
    if (e1) throw e1;
    if (r && Number(r.rev || 0) !== serverRev) {
      showError("Someone else changed the data while you were editing. The latest version has been loaded; please redo your change.");
      await loadState(); return "conflict";
    }
    state.rev = serverRev + 1;
    const { error } = await db.from("cnt_league").upsert({ id: 1, state });
    if (error) throw error;
    serverRev = state.rev; setSync("Saved"); return true;
  } catch (e) {
    console.error("Cloud save error:", e); setSync("Save failed", true);
    showError("Failed to save. Your change was NOT stored and has been rolled back. Check your connection and that you are logged in."); return false;
  }
}

/* Every admin edit goes through commit(): snapshot -> mutate -> save -> rollback on failure. */
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

/* ---------- Feedback (separate table, insert-only for the public) ---------- */
async function submitFeedback(e) {
  e.preventDefault();
  const last = Number(localStorage.getItem("cnt-fb") || 0);
  if (Date.now() - last < 30000) return showError("Please wait a little before sending another message.");
  const name = clean($("feedbackName").value, 60), message = String($("feedbackMessage").value).trim().slice(0, 1000);
  if (!name || !message) return showError("Please fill in both name and message.");
  const { error } = await db.from("cnt_feedback").insert({ name, message });
  if (error) return showError("Could not send your message. Please try again later.");
  try { localStorage.setItem("cnt-fb", Date.now()); } catch {}
  $("feedbackName").value = ""; $("feedbackMessage").value = ""; toast("📨 Message sent to admin");
}
async function loadFeedback() {
  if (!isAdmin) return;
  const { data, error } = await db.from("cnt_feedback").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return console.error(error);
  feedback = data || []; renderNotifications();
}
async function markRead(id) { await db.from("cnt_feedback").update({ read: true }).eq("id", id); loadFeedback(); }
async function deleteFeedback(id) { await db.from("cnt_feedback").delete().eq("id", id); loadFeedback(); }

/* ---------- Rendering: public ---------- */
function renderAll() { renderPublic(); if (adminOpen()) renderAdmin(); }

function fillSelect(id, pairs) {
  const el = $(id); if (!el) return;
  const prev = el.value;
  el.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (pairs.some(([v]) => String(v) === prev)) el.value = prev;
}

function renderPublic() {
  S = Object.fromEntries(state.players.map(p => [p.id, playerStats(p)]));
  $("siteEyebrow").textContent = state.siteConfig.eyebrow;
  $("seasonsGrid").innerHTML = state.seasons.map(i => `
    <button class="season-card ${viewSeason === i ? "active" : ""}" data-act="season" data-id="${i}" aria-pressed="${viewSeason === i}">
      <div class="kicker">SEASON 0${i}</div><h3>Season ${i}</h3>
      <span class="status">${viewSeason === i ? "● ACTIVE VIEW" : "◷ SELECT"}</span>
    </button>`).join("");

  $("standingsTitle").textContent = `Points Table — Season ${viewSeason}`;
  const rows = computeTable(viewSeason);
  $("pointsBody").innerHTML = rows.length ? rows.map((t, i) => `
    <tr><td>${i + 1}</td>
    <td><strong>${esc(t.name)}</strong> <span class="badge-tier tier-${esc((state.positions[t.name] || "Normal").toLowerCase())}">${esc(TIERS[state.positions[t.name]] || "Normal")}</span></td>
    <td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${t.t}</td>
    <td class="nrr">${(t.nrr > 0 ? "+" : "") + t.nrr.toFixed(3)}</td><td class="pts">${t.pts}</td></tr>`).join("")
    : `<tr><td colspan="8" class="empty">No teams added.</td></tr>`;

  renderBracketPublic(); renderFixtures(); renderPvP(); renderPlayers();
  fillSelect("teamFilter", [["All", "All Teams"], ...state.teams.map(t => [t, t])]);
}

function renderBracketPublic() {
  const b = state.bracket;
  const card = (t, m) => `<div class="bm-card"><div class="kicker">${t}</div>${[m.team1, m.team2].map(x =>
    `<div class="bm-team ${m.winner && m.winner === x ? "win" : ""}">${esc(x || "TBD")}${m.winner && m.winner === x ? " 🏆" : ""}</div>`).join("")}</div>`;
  $("bracketGrid").innerHTML = card("Semi-Final 1", b.sf1) + card("Semi-Final 2", b.sf2) + card("Grand Final", b.final);
  $("championBanner").innerHTML = b.final.winner ? `<div class="champion">🏆 CHAMPIONS: ${esc(b.final.winner)}</div>` : "";
  $("tierList").innerHTML = state.teams.map(t => {
    const tier = state.positions[t] || "Normal";
    return `<span class="badge-tier tier-${esc(tier.toLowerCase())}">${esc(t)} · ${esc(TIERS[tier] || tier)}</span>`;
  }).join("");
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

function renderPvP() {
  const p1 = $("pvpPlayer1Select"), p2 = $("pvpPlayer2Select"), box = $("pvpComparisonBox");
  const keep = [p1.value, p2.value];
  if (!state.players.length) {
    p1.innerHTML = p2.innerHTML = '<option value="">No players</option>';
    box.innerHTML = '<div class="empty">Add players to compare careers.</div>'; return;
  }
  const opts = state.players.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.team)})</option>`).join("");
  p1.innerHTML = p2.innerHTML = opts;
  if (state.players.some(p => String(p.id) === keep[0])) p1.value = keep[0];
  if (state.players.some(p => String(p.id) === keep[1])) p2.value = keep[1]; else if (state.players.length > 1) p2.selectedIndex = 1;
  updatePvP();
}
function updatePvP() {
  const a = state.players.find(p => String(p.id) === $("pvpPlayer1Select").value);
  const b = state.players.find(p => String(p.id) === $("pvpPlayer2Select").value);
  const box = $("pvpComparisonBox");
  if (!a || !b) { box.innerHTML = '<div class="empty">Select 2 players to compare.</div>'; return; }
  const x = S[a.id], y = S[b.id];
  const cmp = (lab, va, vb, color, fa = va, fb = vb) => `<div class="pvp-stat-row">
    <strong style="color:${va >= vb ? color : "var(--text-main)"}">${esc(fa)}</strong><span class="sub">${lab}</span>
    <strong style="color:${vb >= va ? color : "var(--text-main)"}">${esc(fb)}</strong></div>`;
  box.innerHTML = `
    <div class="pvp-stat-row"><strong class="gold">${esc(a.name)}</strong><span class="sub">NAME</span><strong class="gold">${esc(b.name)}</strong></div>
    <div class="pvp-stat-row"><span>${esc(a.team)}</span><span class="sub">TEAM</span><span>${esc(b.team)}</span></div>
    <div class="pvp-stat-row"><span>${esc(a.role)}</span><span class="sub">ROLE</span><span>${esc(b.role)}</span></div>
    ${cmp("MATCHES", x.matches, y.matches, "var(--teal)")}
    ${cmp("TOTAL RUNS", x.runs, y.runs, "var(--orange)")}
    ${cmp("HIGHEST SCORE", x.hs, y.hs, "var(--gold)", x.hsText, y.hsText)}
    ${cmp("TOTAL WICKETS", x.wickets, y.wickets, "var(--purple)")}
    ${cmp("BEST BOWLING", x.bw, y.bw, "var(--purple)", x.bb, y.bb)}`;
}

function renderPlayers() {
  const q = clean($("playerSearch").value).toLowerCase(), team = $("teamFilter").value, role = $("roleFilter").value;
  const topRuns = Math.max(0, ...state.players.map(p => S[p.id].runs));
  const topWk = Math.max(0, ...state.players.map(p => S[p.id].wickets));
  const list = state.players.filter(p => (p.name + " " + p.team).toLowerCase().includes(q) && (team === "All" || p.team === team) && (role === "All" || p.role === role));
  $("playerGrid").innerHTML = list.length ? list.map(p => {
    const s = S[p.id];
    return `<article class="player-card">
      <div class="name">${esc(p.name)}${s.runs > 0 && s.runs === topRuns ? '<span class="badge-cap cap-orange">Orange Cap</span>' : ""}${s.wickets > 0 && s.wickets === topWk ? '<span class="badge-cap cap-purple">Purple Cap</span>' : ""}</div>
      <div class="sub">${esc(p.team)} · ${esc(p.role)}</div>
      <div class="stat-grid">
        <div class="stat-cell"><span class="sub">Matches</span><br><strong>${s.matches}</strong></div>
        <div class="stat-cell"><span class="sub">Runs</span><br><strong style="color:var(--orange)">${s.runs}</strong></div>
        <div class="stat-cell"><span class="sub">Highest score</span><br><strong class="gold">${esc(s.hsText)}</strong></div>
        <div class="stat-cell"><span class="sub">Wickets</span><br><strong style="color:var(--purple)">${s.wickets}</strong></div>
        <div class="stat-cell span2"><span class="sub">Best bowling</span><br><strong class="teal">${esc(s.bb)}</strong></div>
      </div></article>`;
  }).join("") : '<div class="sub">No player career records found.</div>';
}

/* ---------- Rendering: admin ---------- */
function renderAdmin() {
  const teamPairs = state.teams.map(t => [t, t]);
  fillSelect("matchSeason", state.seasons.map(s => [s, `Season ${s}`]));
  if (!$("matchSeason").dataset.set) { $("matchSeason").value = viewSeason; $("matchSeason").dataset.set = 1; }
  fillSelect("matchTeam1", teamPairs); fillSelect("matchTeam2", teamPairs);
  if ($("matchTeam1").value === $("matchTeam2").value && state.teams.length > 1) $("matchTeam2").selectedIndex = 1;
  fillSelect("manualPlayerTeam", teamPairs);
  renderBracketAdmin();

  $("adminPositionsContainer").innerHTML = state.teams.map(t => `
    <div class="list-item"><strong>${esc(t)}</strong>
    <select data-tier="${esc(t)}" aria-label="Tier for ${esc(t)}">${Object.entries(TIERS).map(([k, l]) =>
      `<option value="${k}" ${(state.positions[t] || "Normal") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("");

  $("teamsListContainer").innerHTML = state.teams.map(t => `<span class="chip">${esc(t)}
    <button data-act="renameTeam" data-name="${esc(t)}" title="Rename" aria-label="Rename ${esc(t)}">✏️</button>
    <button data-act="deleteTeam" data-name="${esc(t)}" title="Delete" aria-label="Delete ${esc(t)}">➖</button></span>`).join("");

  $("playersListContainer").innerHTML = state.players.length ? state.players.map(p => `<span class="chip">${esc(p.name)} (${esc(p.team)})
    <button class="red" data-act="deletePlayer" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join("")
    : '<span class="sub">No players yet.</span>';

  $("matchesManageList").innerHTML = state.fixtures.length ? [...state.fixtures].reverse().map(f => `
    <div class="list-item"><span>S${f.season} · <strong>${esc(f.title)}</strong> — ${esc(f.result)}</span>
    <button class="btn danger mini" data-act="deleteMatch" data-id="${f.id}">Delete</button></div>`).join("")
    : '<div class="sub">No matches saved.</div>';

  $("serverTeamsCount").textContent = state.teams.length;
  $("serverMatchesCount").textContent = state.fixtures.length;
  $("serverPlayersCount").textContent = state.players.length;
  $("serverAdmin").textContent = adminEmail;
  $("serverRawJson").value = JSON.stringify(state, null, 2);
  renderNotifications(); updateHistoryButtons();
}

function renderNotifications() {
  const unread = feedback.filter(n => !n.read).length;
  $("notifBadge").textContent = unread;
  $("adminNotificationsList").innerHTML = feedback.length ? feedback.map(n => `
    <div class="notif ${n.read ? "" : "unread"}">
      <div class="row-between"><strong class="gold small">From: ${esc(n.name)}</strong><span class="sub">${esc(new Date(n.created_at).toLocaleString())}</span></div>
      <p>${esc(n.message)}</p>
      <div class="row-between mt6"><span></span><span>
        ${n.read ? '<span class="sub">✓ Read</span>' : `<button class="btn secondary mini" data-act="readNotif" data-id="${n.id}">Mark as read</button>`}
        <button class="btn danger mini" data-act="delNotif" data-id="${n.id}">Delete</button></span></div>
    </div>`).join("") : '<div class="sub">No feedback received yet.</div>';
}

/* Bracket admin: winner can only be one of the two chosen teams. */
function renderBracketAdmin() {
  const opts = cur => `<option value="">— TBD —</option>` + state.teams.map(t => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
  BR.forEach(([k, p]) => {
    const m = state.bracket[k];
    $(p + "Team1").innerHTML = opts(m.team1); $(p + "Team2").innerHTML = opts(m.team2);
    fillWinner(p, m.winner);
  });
}
function fillWinner(p, cur) {
  const teams = [...new Set([$(p + "Team1").value, $(p + "Team2").value].filter(Boolean))];
  $(p + "Winner").innerHTML = `<option value="">No winner yet</option>` + teams.map(t => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
}
BR.forEach(([, p]) => ["Team1", "Team2"].forEach(s => $(p + s).addEventListener("change", () => fillWinner(p, $(p + "Winner").value))));

function saveBracket() {
  const nb = {};
  BR.forEach(([k, p]) => nb[k] = { team1: $(p + "Team1").value, team2: $(p + "Team2").value, winner: $(p + "Winner").value });
  for (const [k, m] of Object.entries(nb)) if (m.team1 && m.team1 === m.team2) return showError(`${k.toUpperCase()}: pick two different teams.`);
  if (nb.sf1.winner) nb.final.team1 = nb.sf1.winner;
  if (nb.sf2.winner) nb.final.team2 = nb.sf2.winner;
  if (![nb.final.team1, nb.final.team2].includes(nb.final.winner)) nb.final.winner = "";
  commit(() => state.bracket = nb, "🏆 Bracket updated");
}

/* ---------- Admin actions ---------- */
const dup = n => state.teams.some(t => t.toLowerCase() === n.toLowerCase());

function addTeam() {
  const n = clean($("newTeamName").value, 40);
  if (!n) return showError("Team name cannot be empty.");
  if (dup(n)) return showError(`Team '${n}' already exists.`);
  $("newTeamName").value = "";
  commit(() => { state.teams.push(n); state.positions[n] = "Normal"; }, "Team added");
}
async function deleteTeam(name) {
  if (state.fixtures.some(f => f.team1 === name || f.team2 === name)) return showError(`'${name}' has saved matches. Delete those matches first.`);
  if (state.players.some(p => p.team === name)) return showError(`'${name}' still has players. Remove or move them first.`);
  if (!await askDialog({ title: "Delete team", message: `Delete ${name}?`, okText: "Delete" })) return;
  commit(() => {
    state.teams = state.teams.filter(t => t !== name); delete state.positions[name];
    Object.values(state.bracket).forEach(m => ["team1", "team2", "winner"].forEach(k => { if (m[k] === name) m[k] = ""; }));
  }, "Team deleted");
}
async function renameTeam(old) {
  const v = await askDialog({ title: "Rename team", message: `New name for '${old}':`, input: old, okText: "Rename" });
  const n = clean(v, 40);
  if (!n || n === old) return;
  if (dup(n)) return showError(`Team name '${n}' already exists.`);
  commit(() => {
    state.teams[state.teams.indexOf(old)] = n;
    state.positions[n] = state.positions[old]; delete state.positions[old];
    state.players.forEach(p => { if (p.team === old) p.team = n; });
    state.fixtures.forEach(f => ["team1", "team2", "winner"].forEach(k => { if (f[k] === old) f[k] = n; }));
    Object.values(state.bracket).forEach(m => ["team1", "team2", "winner"].forEach(k => { if (m[k] === old) m[k] = n; }));
  }, `Renamed to ${n}`);
}
const setTier = (team, tier) => commit(() => state.positions[team] = tier);
const addSeason = () => commit(() => state.seasons.push(Math.max(...state.seasons) + 1), "Season added");
const saveSiteText = () => { const v = clean($("editEyebrow").value, 60); if (v) commit(() => state.siteConfig.eyebrow = v, "Tagline saved"); };

function addPlayer() {
  const name = clean($("manualPlayerName").value, 40);
  if (!name) return showError("Enter a player name.");
  const num = id => Math.max(0, parseInt($(id).value) || 0);
  const team = $("manualPlayerTeam").value, role = $("manualPlayerRole").value;
  const matches = num("manualPlayerMatches"), runs = num("manualPlayerRuns"), wickets = num("manualPlayerWickets");
  if (!team) return showError("Add a team first.");
  commit(() => {
    const ex = state.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (ex) {
      ex.team = team; ex.role = role;
      ex.base.matches += matches; ex.base.runs += runs; ex.base.wickets += wickets;
    } else {
      state.players.push({ id: Date.now(), name, team, role,
        base: { matches, runs, wickets, hs: matches <= 1 ? runs : 0, hsNo: false, bw: matches <= 1 ? wickets : 0, bc: null } });
    }
  }, "Player saved");
  ["manualPlayerName", "manualPlayerMatches", "manualPlayerRuns", "manualPlayerWickets"].forEach(id => $(id).value = "");
}
async function deletePlayer(id) {
  if (state.fixtures.some(f => (f.perfs || []).some(x => x.pid === id))) return showError("This player has match performances. Delete those matches first.");
  if (await askDialog({ title: "Remove player", message: "Remove this player from the roster?", okText: "Remove" }))
    commit(() => state.players = state.players.filter(p => p.id !== id), "Player removed");
}
async function deleteMatch(id) {
  if (await askDialog({ title: "Delete match", message: "Delete this match? Points, NRR and player stats will be recalculated.", okText: "Delete" }))
    commit(() => state.fixtures = state.fixtures.filter(f => f.id !== id), "Match deleted");
}
async function resetDefaultData() {
  const v = await askDialog({ title: "Wipe tournament", message: "This permanently deletes ALL tournament data.\nType RESET to confirm.", input: "", okText: "Wipe" });
  if (v === "RESET") { await commit(() => state = freshState()); undoStack = []; redoStack = []; updateHistoryButtons(); }
}

/* ---------- Match entry ---------- */
function addPerfRow() {
  const t1 = $("matchTeam1").value, t2 = $("matchTeam2").value;
  const pl = state.players.filter(p => p.team === t1 || p.team === t2);
  if (!pl.length) return showError("No players on these two teams yet. Add players in Manage first.");
  const row = document.createElement("div"); row.className = "perf-row";
  row.innerHTML = `<div class="perf-grid">
    <label>Player<select class="perfPlayer">${pl.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.team)})</option>`).join("")}</select></label>
    <label>Runs<input class="perfRuns" type="number" min="0" value="0"></label>
    <label>Not out<select class="perfNotOut"><option value="0">No</option><option value="1">Yes</option></select></label>
    <label>Wickets<input class="perfWkts" type="number" min="0" max="10" value="0"></label>
    <label>Runs conceded<input class="perfConc" type="number" min="0" value="0"></label></div>
    <button type="button" class="btn danger mini mt6" data-act="rmPerf">Remove</button>`;
  $("matchPerformanceRows").appendChild(row);
}
function resetMatchForm() {
  ["matchTitle", "matchTeam1Runs", "matchTeam1Wickets", "matchTeam2Runs", "matchTeam2Wickets"].forEach(id => $(id).value = "");
  $("matchTeam1Overs").value = $("matchTeam2Overs").value = "20.0"; $("matchPerformanceRows").innerHTML = "";
}

async function saveMatch() {
  const v = id => $(id).value;
  const t1 = v("matchTeam1"), t2 = v("matchTeam2"), status = v("matchStatus"), season = +v("matchSeason");
  const limit = Math.min(100, Math.max(1, parseInt(v("matchOversLimit")) || 20));
  if (!t1 || !t2 || t1 === t2) return showError("Pick two different teams.");
  const sc = n => ({ runs: parseInt(v(`matchTeam${n}Runs`)), wkts: parseInt(v(`matchTeam${n}Wickets`)), overs: v(`matchTeam${n}Overs`).trim() });
  const s1 = sc(1), s2 = sc(2), done = status === "Completed";
  if (done) for (const [n, s] of [[t1, s1], [t2, s2]]) {
    if (!(s.runs >= 0)) return showError(`${n}: enter valid runs.`);
    if (!(s.wkts >= 0 && s.wkts <= 10)) return showError(`${n}: wickets must be 0–10.`);
    if (!validOvers(s.overs)) return showError(`${n}: invalid overs. Balls must be 0–5 (e.g. 19.5, not 19.7).`);
    const b = oversToBalls(s.overs);
    if (b <= 0 || b > limit * 6) return showError(`${n}: overs must be above 0 and within ${limit}.`);
  }
  const perfs = [], seen = new Set();
  for (const row of document.querySelectorAll("#matchPerformanceRows .perf-row")) {
    const pid = +row.querySelector(".perfPlayer").value, p = state.players.find(x => x.id === pid);
    if (!p) continue;
    if (seen.has(pid)) return showError(`${p.name} is listed twice.`);
    seen.add(pid);
    if (p.team !== t1 && p.team !== t2) return showError(`${p.name} does not play for ${t1} or ${t2}.`);
    const num = c => Math.max(0, parseInt(row.querySelector(c).value) || 0);
    perfs.push({ pid, runs: num(".perfRuns"), wkts: Math.min(10, num(".perfWkts")), conc: num(".perfConc"), notOut: row.querySelector(".perfNotOut").value === "1" });
  }
  let winner = "", result = status;
  if (done) {
    if (s1.runs > s2.runs) { winner = t1; result = `${t1} won by ${s1.runs - s2.runs} runs`; }
    else if (s2.runs > s1.runs) { winner = t2; result = `${t2} won by ${10 - s2.wkts} wickets`; }
    else result = "Match tied";
  }
  const z = n => done ? { runs: n.runs, wkts: n.wkts, overs: n.overs } : { runs: 0, wkts: 0, overs: "0.0" };
  const a = z(s1), b = z(s2);
  const fx = {
    id: Date.now(), season, team1: t1, team2: t2, status, oversLimit: limit, winner, result, perfs,
    title: clean($("matchTitle").value) || `Match ${state.fixtures.filter(f => f.season === season).length + 1}`,
    team1Runs: a.runs, team1Wickets: a.wkts, team1Overs: a.overs,
    team2Runs: b.runs, team2Wickets: b.wkts, team2Overs: b.overs
  };
  if (await commit(() => state.fixtures.push(fx), "✅ Match saved. Table, NRR and careers updated.")) resetMatchForm();
}

/* ---------- Quick result (no scores) ---------- */
function findTeams(text) {
  let work = text.toLowerCase(); const found = [];
  [...state.teams].sort((a, b) => b.length - a.length).forEach(t => {
    const i = work.indexOf(t.toLowerCase());
    if (i >= 0) { found.push({ t, i }); work = work.slice(0, i) + " ".repeat(t.length) + work.slice(i + t.length); }
  });
  return found.sort((a, b) => a.i - b.i).map(x => x.t);
}
async function quickResult() {
  const input = $("pointsAiUserPrompt"), text = clean(input.value, 120); if (!text) return;
  const box = $("pointsAiChatBox");
  const say = (c, m) => { box.insertAdjacentHTML("beforeend", `<div class="chat-msg ${c}">${esc(m)}</div>`); box.scrollTop = box.scrollHeight; };
  say("chat-user", text); input.value = "";
  const teams = findTeams(text);
  if (teams.length < 2) return say("chat-ai", "I couldn't find two registered team names. Try: Team A beat Team B");
  const [a, b] = teams, low = text.toLowerCase();
  const tie = /\b(tie|tied|draw|drew)\b/.test(low), rev = /\b(lost to|lose to|loses to|defeated by)\b/.test(low);
  const winner = tie ? "" : rev ? b : a, loser = winner === a ? b : a;
  const result = tie ? `${a} tied with ${b}` : `${winner} defeated ${loser}`;
  const ok = await commit(() => state.fixtures.push({
    id: Date.now(), title: `Match ${state.fixtures.filter(f => f.season === viewSeason).length + 1}`, season: viewSeason,
    team1: a, team2: b, status: "Completed", oversLimit: 20, winner, result, noScore: true, perfs: [],
    team1Runs: 0, team1Wickets: 0, team1Overs: "0.0", team2Runs: 0, team2Wickets: 0, team2Overs: "0.0"
  }));
  say("chat-ai", ok ? `✅ ${result} (Season ${viewSeason}). NRR unaffected; use Match Entry to include scores.` : "Could not save that result.");
}

/* ---------- Consent ---------- */
function setConsent(v) {
  try { localStorage.setItem("cnt-consent", v); } catch {}
  if (v === "granted") gtag("consent", "update", { analytics_storage: "granted" });
  $("consentBar").hidden = true;
}
function initConsent() {
  let c = null; try { c = localStorage.getItem("cnt-consent"); } catch {}
  if (c === "granted") gtag("consent", "update", { analytics_storage: "granted" });
  else if (!c) $("consentBar").hidden = false;
}

/* ---------- Events (delegated: no inline handlers carrying user data) ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const { act, id, name } = t.dataset;
  ({
    season: () => { viewSeason = +id; renderPublic(); },
    match: () => showMatchDetails(+id),
    renameTeam: () => renameTeam(name),
    deleteTeam: () => deleteTeam(name),
    deletePlayer: () => deletePlayer(+id),
    deleteMatch: () => deleteMatch(+id),
    readNotif: () => markRead(+id),
    delNotif: () => deleteFeedback(+id),
    rmPerf: () => t.closest(".perf-row").remove()
  }[act] || (() => {}))();
});
document.addEventListener("change", e => { if (e.target.dataset?.tier) setTier(e.target.dataset.tier, e.target.value); });
$("pvpPlayer1Select").addEventListener("change", updatePvP);
$("pvpPlayer2Select").addEventListener("change", updatePvP);
$("teamFilter").addEventListener("change", renderPlayers);
$("roleFilter").addEventListener("change", renderPlayers);
let searchTimer; $("playerSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderPlayers, 150); });
$("pointsAiUserPrompt").addEventListener("keydown", e => { if (e.key === "Enter") quickResult(); });
$("newTeamName").addEventListener("keydown", e => { if (e.key === "Enter") addTeam(); });

/* ---------- Boot ---------- */
initConsent();
initAuth();
loadState();
