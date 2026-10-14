import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LogOut } from "lucide-react";
import { AnimatedPage, Dialog, ErrorNotice } from "../components/ui";
import { useApp } from "../lib/context";
import { api, ApiError } from "../lib/api";
import type { TeamDetails } from "../lib/contracts";

export function TeamPage() {
  const { session, setSession, challenges, busy, transact, toast } = useApp();
  const router = useRouter();
  const [details, setDetails] = useState<TeamDetails | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState<"member" | "last" | null>(null);
  const teamId = session?.id;
  useEffect(() => {
    if (!teamId) return;
    let disposed = false;
    void api.team()
      .then((result) => { if (!disposed) setDetails(result); })
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load your team."); });
    return () => { disposed = true; };
  }, [teamId]);
  if (!session) {
    return (
      <AnimatedPage className="page team-page">
        <div className="page-heading"><div><h1>No team yet</h1><p>Join or create a team to compete.</p></div></div>
        <Link href="/join" className="button">Join or create a team <ArrowUpRight size={16} /></Link>
      </AnimatedPage>
    );
  }
  const solved = challenges.filter((challenge) => session.solved.includes(challenge.id));
  const startLeaving = async () => {
    try {
      const latest = await api.team();
      setDetails(latest);
      setLeaving(latest.members.filter((member) => !member.you).length ? "member" : "last");
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const confirmLeaving = async () => {
    try {
      const { deleted } = await transact(() => api.leave(leaving === "last"));
      setSession(null);
      setLeaving(null);
      toast(deleted ? "Team deleted." : "You left the team.");
      router.push("/join");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setLeaving("last");
      else toast((e as Error).message);
    }
  };
  return (
    <AnimatedPage className="page team-page">
      <div className="page-heading">
        <div>
          <h1>{session.teamName}</h1>
          <p>Your competition team.</p>
        </div>
      </div>
      <div className="leaderboard-stats">
        <div>
          <span>Score</span>
          <b>{session.score.toLocaleString()}<small>PTS</small></b>
        </div>
        <div>
          <span>Flags</span>
          <b>{String(session.solved.length).padStart(2, "0")}<small>/ 10</small></b>
        </div>
        <div>
          <span>Members</span>
          <b>{details ? String(details.members.length).padStart(2, "0") : "—"}</b>
        </div>
      </div>
      <section className="team-section">
        <h2>Members</h2>
        {error ? <ErrorNotice message={error} /> : (
          <ul className="team-members">
            {details?.members.map((member, index) => (
              <li key={`${member.name}-${index}`}>
                <span className="team-member-initial" aria-hidden="true">{member.name.charAt(0).toUpperCase()}</span>
                <span>{member.name}</span>
                {member.you && <span className="team-badge">You</span>}
                {member.creator && <span className="team-badge">Creator</span>}
              </li>
            )) ?? <li>Loading members…</li>}
          </ul>
        )}
      </section>
      <section className="team-section">
        <h2>Solved challenges</h2>
        {solved.length ? (
          <ul className="team-solves">
            {solved.map((challenge) => (
              <li key={challenge.id}>
                <span>{String(challenge.id).padStart(2, "0")} · {challenge.title}</span>
                <span>{challenge.points} pts</span>
              </li>
            ))}
          </ul>
        ) : <p className="field-help">No flags captured yet.</p>}
      </section>
      <div className="dialog-actions team-actions">
        <Link href="/arena" className="button">Challenges <ArrowUpRight size={16} /></Link>
        <button className="button button-outline" disabled={busy} onClick={startLeaving}><LogOut size={16} /> Leave team</button>
      </div>
      {leaving && <Dialog title={leaving === "last" ? "Delete this team?" : "Leave this team?"} onClose={() => setLeaving(null)}>
        {leaving === "last"
          ? <p>You are the last member of {session.teamName}. Leaving will permanently delete the team, its score and its progress. Are you sure you want to do this?</p>
          : <p>You will be removed from this team. Your team’s server progress will be preserved.</p>}
        <div className="dialog-actions"><button className="button button-outline" onClick={() => setLeaving(null)}>Stay here</button><button className="button" disabled={busy} onClick={confirmLeaving}>
          {leaving === "last" ? "Delete team and leave" : "Leave team"}
        </button></div>
      </Dialog>}
    </AnimatedPage>
  );
}
