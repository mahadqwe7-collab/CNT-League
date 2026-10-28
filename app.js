"use strict";

// Local storage keys
const STORAGE_KEY = "cntLeague.phase1.v1";

const $ = (selector) => document.querySelector(selector);

const elements = {
  teamForm: $("#teamForm"),
  teamName: $("#teamName"),
  teamList: $("#teamList"),

  matchForm: $("#matchForm"),
  teamA: $("#teamA"),
  teamB: $("#teamB"),
  runsA: $("#runsA"),
  runsB: $("#runsB"),
  matchStatus: $("#matchStatus"),
  matchList: $("#matchList"),

  standingsBody: $("#standingsBody"),
  teamCount: $("#teamCount"),
  matchCount: $("#matchCount"),
  completedCount: $("#completedCount"),
  remainingCount: $("#remainingCount"),

  exportBtn: $("#exportBtn"),
  importFile: $("#importFile"),
  message: $("#message"),
};

let state = loadState();

function emptyState() {
  return {
    version: 1,
    teams: [],
    matches: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return emptyState();

    const parsed = JSON.parse(raw);

    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.teams) ||
      !Array.isArray(parsed.matches)
    ) {
      throw new Error("Invalid saved data format.");
    }

    return parsed;
  } catch (error) {
    console.error("Could not load saved data:", error);
    alert(
      "Saved data could not be loaded. Your original data has not been overwritten."
    );
    return emptyState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save data:", error);

    showMessage(
      "Could not save. Export your data and check browser storage."
    );

    return false;
  }
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return replacements[character];
  });
}

function showMessage(message) {
  elements.message.textContent = message;
}

function getTeam(teamId) {
  return state.teams.find((team) => team.id === teamId);
}

function getMatchWinner(match) {
  if (match.status !== "completed") return null;

  if (match.runsA > match.runsB) return match.teamA;
  if (match.runsB > match.runsA) return match.teamB;

  return null;
}

function renderTeamOptions() {
  const previousA = elements.teamA.value;
  const previousB = elements.teamB.value;

  const options = state.teams
    .map(
      (team) =>
        `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`
    )
    .join("");

  elements.teamA.innerHTML =
    '<option value="">Select team</option>' + options;

  elements.teamB.innerHTML =
    '<option value="">Select team</option>' + options;

  if (getTeam(previousA)) elements.teamA.value = previousA;
  if (getTeam(previousB)) elements.teamB.value = previousB;
}

function renderTeams() {
  elements.teamList.innerHTML = "";

  if (state.teams.length === 0) {
    elements.teamList.innerHTML =
      '<p class="muted">No teams yet. Add your first team above.</p>';
    return;
  }

  elements.teamList.innerHTML = state.teams
    .map(
      (team) => `
        <div class="team-item">
          <strong>${escapeHTML(team.name)}</strong>
          <button
            class="danger"
            data-delete-team="${escapeHTML(team.id)}"
            type="button"
          >Delete</button>
        </div>
      `
    )
    .join("");
}

function renderMatches() {
  elements.matchList.innerHTML = "";

  if (state.matches.length === 0) {
    elements.matchList.innerHTML =
      '<p class="muted">No matches recorded yet.</p>';
    return;
  }

  elements.matchList.innerHTML = [...state.matches]
    .reverse()
    .map((match) => {
      const teamA = getTeam(match.teamA);
      const teamB = getTeam(match.teamB);

      if (!teamA || !teamB) return "";

      const completed = match.status === "completed";

      const score = completed
        ? `${match.runsA} - ${match.runsB}`
        : "VS";

      const winner = getMatchWinner(match);
      const resultText = winner
        ? `${escapeHTML(getTeam(winner)?.name || "Winner")} won`
        : completed
          ? "Match tied"
          : "Fixture pending";

      return `
        <article class="match-card">
          <div>
            <h3>
              ${escapeHTML(teamA.name)}
              vs
              ${escapeHTML(teamB.name)}
            </h3>
            <div class="score">${score}</div>
            <span class="status ${completed ? "completed" : ""}">
              ${completed ? resultText : "UPCOMING"}
            </span>
          </div>

          <div class="match-actions">
            ${
              !completed
                ? `<button type="button" data-complete="${escapeHTML(match.id)}">
                     Enter result
                   </button>`
                : ""
            }

            <button
              type="button"
              class="danger"
              data-delete-match="${escapeHTML(match.id)}"
            >Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function calculateStandings() {
  const table = state.teams.map((team) => ({
    id: team.id,
    name: team.name,
    played: 0,
    won: 0,
    lost: 0,
    points: 0,
    runsFor: 0,
    runsAgainst: 0,
  }));

  const byId = new Map(table.map((team) => [team.id, team]));

  for (const match of state.matches) {
    if (match.status !== "completed") continue;

    const a = byId.get(match.teamA);
    const b = byId.get(match.teamB);

    if (!a || !b) continue;

    a.played++;
    b.played++;

    a.runsFor += match.runsA;
    a.runsAgainst += match.runsB;

    b.runsFor += match.runsB;
    b.runsAgainst += match.runsA;

    if (match.runsA > match.runsB) {
      a.won++;
      b.lost++;
      a.points += 2;
    } else if (match.runsB > match.runsA) {
      b.won++;
      a.lost++;
      b.points += 2;
    }
  }

  return table.sort(
    (a, b) =>
      b.points - a.points ||
      b.won - a.won ||
      (b.runsFor - b.runsAgainst) -
        (a.runsFor - a.runsAgainst) ||
      a.name.localeCompare(b.name)
  );
}

function renderStandings() {
  const standings = calculateStandings();

  if (standings.length === 0) {
    elements.standingsBody.innerHTML = `
      <tr><td colspan="6" class="muted">Add teams to start your league.</td></tr>
    `;
    return;
  }

  elements.standingsBody.innerHTML = standings
    .map(
      (team, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHTML(team.name)}</strong></td>
          <td>${team.played}</td>
          <td>${team.won}</td>
          <td>${team.lost}</td>
          <td><strong>${team.points}</strong></td>
        </tr>
      `
    )
    .join("");
}

function renderDashboard() {
  const completed = state.matches.filter(
    (match) => match.status === "completed"
  ).length;

  elements.teamCount.textContent = state.teams.length;
  elements.matchCount.textContent = state.matches.length;
  elements.completedCount.textContent = completed;
  elements.remainingCount.textContent =
    state.matches.length - completed;
}

function render() {
  renderTeamOptions();
  renderTeams();
  renderMatches();
  renderStandings();
  renderDashboard();
}

elements.teamForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = elements.teamName.value.trim();

  if (!name) return;

  const duplicate = state.teams.some(
    (team) => team.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    showMessage("A team with that name already exists.");
    return;
  }

  const team = { id: createId(), name };

  state.teams.push(team);

  if (!saveState()) {
    state.teams.pop();
    return;
  }

  elements.teamForm.reset();
  showMessage("Team added successfully.");
  render();
});

elements.teamList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-team]");
  if (!button) return;

  const id = button.dataset.deleteTeam;

  const hasMatches = state.matches.some(
    (match) => match.teamA === id || match.teamB === id
  );

  if (hasMatches) {
    showMessage(
      "This team has matches. Delete those matches first."
    );
    return;
  }

  if (!confirm("Delete this team?")) return;

  const previousTeams = state.teams;
  state.teams = state.teams.filter((team) => team.id !== id);

  if (!saveState()) {
    state.teams = previousTeams;
    return;
  }

  showMessage("Team deleted.");
  render();
});

elements.matchForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const teamA = elements.teamA.value;
  const teamB = elements.teamB.value;
  const status = elements.matchStatus.value;

  if (!teamA || !teamB || teamA === teamB) {
    showMessage("Select two different teams.");
    return;
  }

  if (!getTeam(teamA) || !getTeam(teamB)) {
    showMessage("Select valid teams.");
    return;
  }

  const completed = status === "completed";

  let runsA = null;
  let runsB = null;

  if (completed) {
    runsA = Number(elements.runsA.value);
    runsB = Number(elements.runsB.value);

    if (
      elements.runsA.value === "" ||
      elements.runsB.value === "" ||
      !Number.isSafeInteger(runsA) ||
      !Number.isSafeInteger(runsB) ||
      runsA < 0 ||
      runsB < 0 ||
      runsA > 999 ||
      runsB > 999
    ) {
      showMessage("Enter valid scores between 0 and 999.");
      return;
    }
  }

  const match = {
    id: createId(),
    teamA,
    teamB,
    status,
    runsA,
    runsB,
    createdAt: new Date().toISOString(),
  };

  state.matches.push(match);

  if (!saveState()) {
    state.matches.pop();
    return;
  }

  elements.matchForm.reset();
  showMessage("Match saved.");
  render();
});

elements.matchList.addEventListener("click", (event) => {
  const completeButton = event.target.closest("[data-complete]");
  const deleteButton = event.target.closest("[data-delete-match]");

  if (completeButton) {
    const match = state.matches.find(
      (item) => item.id === completeButton.dataset.complete
    );

    if (!match) return;

    const runsA = prompt("Enter runs for Team A:");
    if (runsA === null) return;

    const runsB = prompt("Enter runs for Team B:");
    if (runsB === null) return;

    const a = Number(runsA);
    const b = Number(runsB);

    if (
      runsA.trim() === "" ||
      runsB.trim() === "" ||
      !Number.isSafeInteger(a) ||
      !Number.isSafeInteger(b) ||
      a < 0 ||
      b < 0 ||
      a > 999 ||
      b > 999
    ) {
      showMessage("Invalid scores. Enter whole numbers from 0 to 999.");
      return;
    }

    const previous = { ...match };

    match.runsA = a;
    match.runsB = b;
    match.status = "completed";

    if (!saveState()) {
      Object.assign(match, previous);
      return;
    }

    showMessage("Result saved and standings updated.");
    render();
    return;
  }

  if (deleteButton) {
    if (!confirm("Permanently delete this match?")) return;

    const id = deleteButton.dataset.deleteMatch;
    const previousMatches = state.matches;

    state.matches = state.matches.filter(
      (match) => match.id !== id
    );

    if (!saveState()) {
      state.matches = previousMatches;
      return;
    }

    showMessage("Match deleted.");
    render();
  }
});

elements.exportBtn.addEventListener("click", () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "cnt-league-backup.json";
  link.click();

  URL.revokeObjectURL(url);
  showMessage("Backup exported.");
});

elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());

    if (
      imported.version !== 1 ||
      !Array.isArray(imported.teams) ||
      !Array.isArray(imported.matches)
    ) {
      throw new Error("Unsupported backup format.");
    }

    const teamIds = new Set();
    const matchIds = new Set();

    for (const team of imported.teams) {
      if (
        typeof team.id !== "string" ||
        typeof team.name !== "string" ||
        !team.name.trim() ||
        teamIds.has(team.id)
      ) {
        throw new Error("Invalid or duplicate team.");
      }

      teamIds.add(team.id);
    }

    for (const match of imported.matches) {
      if (
        typeof match.id !== "string" ||
        matchIds.has(match.id) ||
        !teamIds.has(match.teamA) ||
        !teamIds.has(match.teamB) ||
        match.teamA === match.teamB ||
        !["upcoming", "completed"].includes(match.status)
      ) {
        throw new Error("Invalid match record.");
      }

      if (
        match.status === "completed" &&
        (
          !Number.isSafeInteger(match.runsA) ||
          !Number.isSafeInteger(match.runsB) ||
          match.runsA < 0 ||
          match.runsB < 0 ||
          match.runsA > 999 ||
          match.runsB > 999
        )
      ) {
        throw new Error("Invalid match scores.");
      }

      matchIds.add(match.id);
    }

    if (!confirm("Restore backup? This replaces your current data.")) {
      return;
    }

    const previous = state;

    state = {
      version: 1,
      teams: imported.teams,
      matches: imported.matches,
    };

    if (!saveState()) {
      state = previous;
      return;
    }

    showMessage("Backup restored successfully.");
    render();
  } catch (error) {
    console.error("Backup restore failed:", error);
    showMessage("Could not restore backup: " + error.message);
  } finally {
    elements.importFile.value = "";
  }
});

// Initial page rendering
render();
