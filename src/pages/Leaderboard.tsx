import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Info,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import { AnimatedPage, ErrorNotice } from "../components/ui";
import { useApp } from "../lib/context";
import { Input } from "@/components/ui/input";
import { api, isDemo } from "../lib/api";
import type { Leaderboard } from "../lib/contracts";

export function LeaderboardPage() {
  const { session } = useApp(),
    [data, setData] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const generation = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.leaderboard();
      if (requestId.current === generation) setData(result);
    } catch (e) {
      if (requestId.current === generation) setError((e as Error).message);
    } finally {
      if (requestId.current === generation) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load, session?.score]);
  const me = data?.teams.find((t) => t.id === session?.id);
  const teams =
    data?.teams.filter((t) =>
      t.teamName.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <AnimatedPage className="page leaderboard-page">
      <div className="page-heading">
        <div>
          <h1>Leaderboard</h1>
        </div>
      </div>
      <div className="leaderboard-stats">
        <div>
          <span>Your position</span>
          <b>{me ? `#${me.rank}` : "—"}</b>
        </div>
        <div>
          <span>Your score</span>
          <b>
            {session?.score.toLocaleString() ?? "—"}
            <small>PTS</small>
          </b>
        </div>
        <div>
          <span>Your flags</span>
          <b>
            {session ? String(session.solved.length).padStart(2, "0") : "—"}
            <small>/ 10</small>
          </b>
        </div>
      </div>
      <div className="leaderboard-toolbar">
        <div className="leaderboard-search">
          <Input
            type="search"
            size="lg"
            aria-label="Search teams"
            placeholder="Find a team…"
            leftIcon={<Search />}
            clearable
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
          />
        </div>
        <button
          className="button button-outline button-small"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          {loading ? "Refreshing…" : "Refresh standings"}
        </button>
      </div>
      {isDemo && (
        <div className="notice">
          <Info size={15} />
          Sample teams and local demo progress. These are not live event
          standings.
        </div>
      )}
      {error && <ErrorNotice message={error} retry={load} />}
      <div className="table-scroll">
        <table className="leaderboard-table">
          <caption className="sr-only">
            {isDemo ? "Demo" : "Event"} leaderboard
          </caption>
          <thead>
            <tr>
              <th scope="col">RANK</th>
              <th scope="col">TEAM</th>
              <th scope="col">FLAGS CAPTURED</th>
              <th scope="col">SCORE</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr
                key={team.id}
                className={team.id === session?.id ? "your-team" : ""}
              >
                <td>
                  <span className={`rank rank-${team.rank}`}>
                    {String(team.rank).padStart(2, "0")}
                  </span>
                </td>
                <td>
                  <b>{team.teamName}</b>
                  {team.id === session?.id && (
                    <span className="you-badge">YOU</span>
                  )}
                </td>
                <td>
                  <span className="table-flags">
                    {team.solved}
                    <span className="muted"> / 10</span>
                  </span>
                </td>
                <td>
                  {team.score.toLocaleString()}
                  <span className="muted"> pts</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !teams.length && !error && (
          <div className="empty-state">
            <Search size={24} />
            <h2>{query ? "No matching teams." : "The board is open."}</h2>
            <p>
              {query
                ? "Try another team name."
                : "Standings will appear when teams join the event."}
            </p>
          </div>
        )}
        {loading && !data && (
          <div className="empty-state" role="status">
            Loading standings…
          </div>
        )}
      </div>
      <div className="table-foot">
        <span>
          {data ? `${data.teams.length} ${isDemo ? "DEMO " : ""}TEAMS` : "—"}
        </span>
        <span>
          {data
            ? `UPDATED ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "AWAITING DATA"}
        </span>
      </div>
      <Link className="bonus-card" to="/leaderboard-challenge">
        <div className="bonus-icon">
          <Terminal size={25} />
        </div>
        <div>
          <span className="section-kicker">BONUS CHALLENGE</span>
          <h2>Leaderboard challenge</h2>
        </div>
        <ArrowUpRight size={25} />
      </Link>
    </AnimatedPage>
  );
}

export function LeaderboardChallenge() {
  return (
    <AnimatedPage className="page bonus-page">
      <Link to="/leaderboard" className="quiet-link">
        <ArrowLeft size={14} /> Back to leaderboard
      </Link>
      <div className="bonus-page-heading">
        <div className="bonus-icon">
          <Terminal size={32} />
        </div>
        <span className="eyebrow">BONUS CHALLENGE / APPLICATION SECURITY</span>
        <h1>Who’s keeping score?</h1>
        <p className="serif">
          The model isn’t the only thing that can be persuaded.
        </p>
      </div>
      <div className="brief-grid">
        <section className="brief-card">
          <span className="section-kicker">THE OBJECTIVE</span>
          <h2>Question the scoreboard.</h2>
          <p>
            The event includes an intentionally vulnerable leaderboard.
            Investigate how it handles score changes and whether it verifies who
            is allowed to make them.
          </p>
          <p>
            Your goal is to demonstrate score manipulation inside the designated
            competition sandbox: raise your team’s displayed score or reduce
            another sandbox team’s score.
          </p>
        </section>
        <section className="brief-card">
          <span className="section-kicker">THE BOUNDARY</span>
          <h2>Stay inside the arena.</h2>
          <p>
            Only the organizer-designated leaderboard sandbox is in scope. Event
            infrastructure, model hosting, authentication services, and
            unrelated websites are outside this challenge.
          </p>
          <p>
            Keep your steps reproducible. Follow the organizer’s rules for
            evidence, resets, and scoring.
          </p>
        </section>
      </div>
      <div className="notice">
        <Info size={18} />
        <span>
          {isDemo
            ? "The vulnerability service is not connected in this frontend demo. The sample leaderboard supports UI testing only."
            : "Get the dedicated sandbox URL and exploit rules from the event organizers before starting."}
        </span>
      </div>
      <Link to="/leaderboard" className="button">
        View the leaderboard <ArrowUpRight size={18} />
      </Link>
    </AnimatedPage>
  );
}
