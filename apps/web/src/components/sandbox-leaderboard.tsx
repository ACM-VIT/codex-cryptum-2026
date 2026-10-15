"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import { Input } from "./ui/input";
import { ErrorNotice } from "./ui";
import { sandboxApi, type SandboxBoard } from "../lib/sandbox-api";
import { api } from "../lib/api";
import { useApp } from "../lib/context";

export function SandboxLeaderboard({ showOrganizerTools = true }: { showOrganizerTools?: boolean }) {
  const { setSession } = useApp();
  const [board, setBoard] = useState<SandboxBoard | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [name, setName] = useState("");
  const [score, setScore] = useState("0");
  // Credentials live only in component memory, never in local storage or public env.
  const [participantToken, setParticipantToken] = useState("");
  const [organizerToken, setOrganizerToken] = useState("");
  const load = useCallback(async () => { setBoard(await sandboxApi.leaderboard()); }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let disposed = false;
    sandboxApi.leaderboard().then(result => { if (!disposed) setBoard(result); })
      .catch(e => { if (!disposed) setError((e as Error).message); });
    return () => { disposed = true; };
  }, []);
  const edit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const value = Number(score);
      if (!Number.isInteger(value) || value < 0 || value > 1_000_000) throw new Error("Choose an integer score from 0 to 1,000,000.");
      await sandboxApi.update(teamId, { score: value, display_name: name }, participantToken);
      await load(); setStatus("Sandbox team updated. Authoritative event standings are unchanged.");
    });
  };
  return (
    <section className="sandbox-panel" aria-labelledby="sandbox-heading">
      <div className="page-heading"><div><span className="section-kicker">ISOLATED APPLICATION SECURITY CHALLENGE</span><h2 id="sandbox-heading"><Terminal size={24} /> Sandbox leaderboard</h2></div>
        <button className="button button-outline button-small" disabled={busy} onClick={() => void run(load)}><RefreshCw size={14} /> Refresh sandbox</button>
      </div>
      <p className="notice">Intentionally vulnerable sandbox only. These scores are separate from authoritative event standings. {board?.objective}</p>
      <p>Try changing another sandbox team’s score to move it into first place, then verify your exploit. Use only organizer-issued sandbox credentials.</p>
      {error && <ErrorNotice message={error} />}
      <div className="table-scroll"><table className="leaderboard-table"><caption className="sr-only">Sandbox scores — not competition standings</caption>
        <thead><tr><th scope="col">RANK</th><th scope="col">SANDBOX TEAM</th><th scope="col">SCORE</th><th scope="col">ACTION</th></tr></thead>
        <tbody>{board?.entries.map(entry => <tr key={entry.team_id}><td>{entry.rank}</td><td><b>{entry.display_name}</b><br /><small>{entry.team_id}</small></td><td>{entry.score.toLocaleString()}</td><td><button className="text-button" disabled={busy} onClick={() => { setTeamId(entry.team_id); setName(entry.display_name); setScore(String(entry.score)); }}>Edit sandbox team</button></td></tr>)}</tbody>
      </table></div>
      {!board && !error && <output className="block">Loading sandbox…</output>}
      <form className="sandbox-form" onSubmit={edit}>
        <label htmlFor="sandbox-token">Participant sandbox token (optional when the server supplies session authorization)</label>
        <Input id="sandbox-token" type="password" autoComplete="off" value={participantToken} onChange={event => setParticipantToken(event.target.value)} />
        <label htmlFor="sandbox-team">Target sandbox team ID</label>
        <Input id="sandbox-team" value={teamId} onChange={event => setTeamId(event.target.value)} pattern="[a-zA-Z0-9_-]{1,64}" required />
        <label htmlFor="sandbox-name">Sandbox display name</label>
        <Input id="sandbox-name" value={name} onChange={event => setName(event.target.value)} minLength={1} maxLength={40} required />
        <label htmlFor="sandbox-score">Sandbox score</label>
        <Input id="sandbox-score" type="number" value={score} onChange={event => setScore(event.target.value)} min={0} max={1_000_000} step={1} required />
        <div className="dialog-actions"><button className="button" disabled={busy || !teamId}>Apply sandbox PATCH</button>
          <button type="button" className="button button-outline" disabled={busy} onClick={() => void run(async () => {
            const result = await sandboxApi.complete(participantToken);
            await load();
            if (result.completed) setSession(await api.session());
            setStatus(result.completed ? `Exploit verified. ${result.points_awarded} points awarded (repeat completions award no extra points).` : "Not completed yet. Change another sandbox team’s score so it becomes first, then verify again.");
          })}>Verify completion</button></div>
      </form>
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
