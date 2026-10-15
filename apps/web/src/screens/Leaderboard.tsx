import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import { AnimatedPage, ErrorNotice } from "../components/ui";
import { useApp } from "../lib/context";
import { Input } from "@/components/ui/input";
import { api } from "../lib/api";
import type { Leaderboard } from "../lib/contracts";

export function LeaderboardPage() {
  const { session, challenges } = useApp(),
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
    let disposed = false;
    const generation = ++requestId.current;
    void api.leaderboard()
      .then((result) => {
        if (!disposed && requestId.current === generation) {
          setData(result);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!disposed && requestId.current === generation) {
          setError(cause instanceof Error ? cause.message : "Could not load standings.");
        }
      })
      .finally(() => {
        if (!disposed && requestId.current === generation) setLoading(false);
      });
    return () => { disposed = true; };
  }, [session?.score]);
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
          <p>Authoritative event standings — sandbox changes do not affect this board.</p>
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
      {error && <ErrorNotice message={error} retry={load} />}
      <div className="table-scroll">
        <table className="leaderboard-table">
          <caption className="sr-only">
            Event leaderboard
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
          <output className="empty-state">
            Loading standings…
          </output>
        )}
      </div>
      <div className="table-foot">
        <span>
          {data ? `${data.teams.length} TEAMS` : "—"}
        </span>
        <span>
          {data
            ? `UPDATED ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "AWAITING DATA"}
        </span>
      </div>
      {challenges.filter((challenge) => challenge.interaction === "sandbox").map((challenge) => (
      <Link key={challenge.id} className="sandbox-link" href={`/arena/${challenge.id}`}>
        <div className="sandbox-link-icon">
          <Terminal size={25} />
        </div>
        <div>
          <span className="section-kicker">SANDBOX CHALLENGE</span>
          <h2>{challenge.title}</h2>
        </div>
        <ArrowUpRight size={25} />
      </Link>
      ))}
    </AnimatedPage>
  );
}
