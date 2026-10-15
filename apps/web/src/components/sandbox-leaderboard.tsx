"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import { Input } from "./ui/input";
import { ErrorNotice } from "./ui";
import { sandboxApi, type SandboxBoard } from "../lib/sandbox-api";
import { startLiveRefresh } from "../lib/live-refresh";
import { api } from "../lib/api";
import { useApp } from "../lib/context";

export function SandboxLeaderboard({ showOrganizerTools = true }: { showOrganizerTools?: boolean }) {
  const { setSession } = useApp();
  const [board, setBoard] = useState<SandboxBoard | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [organizerToken, setOrganizerToken] = useState("");
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const generation = ++requestId.current;
    try {
      const result = await sandboxApi.leaderboard();
      if (generation === requestId.current) { setBoard(result); setError(""); }
    } catch (cause) {
      if (generation === requestId.current) setError((cause as Error).message);
    }
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const stop = startLiveRefresh(load);
    const invalidate = () => { requestId.current++; };
    return () => { stop(); invalidate(); };
  }, [load]);
  return (
    <section className="sandbox-panel" aria-labelledby="sandbox-heading">
      <div className="page-heading"><div><span className="section-kicker">ISOLATED APPLICATION SECURITY CHALLENGE</span><h2 id="sandbox-heading"><Terminal size={24} /> Sandbox leaderboard</h2></div>
        <button className="button button-outline button-small" disabled={busy} onClick={() => void run(load)}><RefreshCw size={14} /> Refresh sandbox</button>
      </div>
      <p className="notice">Intentionally vulnerable sandbox only. These scores are separate from authoritative event standings. {board?.objective}</p>
      <p>Explore the application and sandbox board. Your goal is to move your own team to first place, then check your result.</p>
      {error && <ErrorNotice message={error} />}
      <div className="table-scroll"><table className="leaderboard-table"><caption className="sr-only">Sandbox scores — not competition standings</caption>
        <thead><tr><th scope="col">RANK</th><th scope="col">SANDBOX TEAM</th><th scope="col">SCORE</th></tr></thead>
        <tbody>{board?.entries.map(entry => <tr key={entry.team_id}><td>{entry.rank}</td><td><b>{entry.display_name}</b><br /><small>{entry.team_id}</small></td><td>{entry.score.toLocaleString()}</td></tr>)}</tbody>
      </table></div>
      {board && board.entries.length < 2 && <p className="notice">This challenge needs at least two registered teams. Teams appear here automatically when they join.</p>}
      <p className="field-help">Updates every 3 seconds. Sandbox scores start from real standings; your practice edits stay here.</p>
      {!board && !error && <output className="block">Loading sandbox…</output>}
      <div className="sandbox-form"><button type="button" className="button" disabled={busy || !board || board.entries.length < 2} onClick={() => void run(async () => {
            const result = await sandboxApi.complete();
            await load();
            if (result.completed) setSession(await api.session());
            setStatus(result.completed ? `Completion verified. ${result.points_awarded} points awarded (repeat completions award no extra points).` : "Not completed yet. Your team must be first on the sandbox board.");
          })}>Verify completion</button></div>
      {showOrganizerTools && <details className="sandbox-organizer"><summary>Organizer-only sandbox reset</summary><p>Resets sandbox scores and exploit evidence for all sandbox teams. It does not reset official solve awards or event standings.</p>
        <label htmlFor="sandbox-organizer-token">Organizer token</label><Input id="sandbox-organizer-token" type="password" autoComplete="off" value={organizerToken} onChange={event => setOrganizerToken(event.target.value)} />
        <button className="button button-outline" disabled={busy || !organizerToken} onClick={() => {
          if (!window.confirm("Reset all sandbox scores and exploit evidence?")) return;
          void run(async () => { await sandboxApi.reset(organizerToken); setOrganizerToken(""); await load(); setStatus("Sandbox reset. Event standings are unchanged."); });
        }}>Reset sandbox</button>
      </details>}
      {status && <output className="notice">{status}</output>}
    </section>
  );
}
