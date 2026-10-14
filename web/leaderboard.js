async function refreshLeaderboard() {
  const status = document.getElementById("status");
  const body = document.getElementById("entries");
  try {
    const response = await fetch("/api/challenge/leaderboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Leaderboard unavailable");
    const data = await response.json();
    body.replaceChildren();
    for (const entry of data.entries) {
      const row = document.createElement("tr");
      for (const value of [entry.rank, entry.display_name, entry.score]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
    status.textContent = `${data.entries.length} teams · challenge sandbox`;
    status.className = "";
  } catch {
    status.textContent = "Leaderboard unavailable. Retry shortly.";
    status.className = "error";
  }
}

refreshLeaderboard();
setInterval(refreshLeaderboard, 10000);
