import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Flag } from "lucide-react";
import { AnimatedPage, ErrorNotice } from "@/components/ui";
import { Input } from "@/components/ui/input";
import {
  createPreviewTeam,
  joinPreviewTeam,
  previewProfile,
  setPreviewProfile,
} from "@/lib/team-preview";
import { KeyholeMark } from "@/components/keyhole-mark";
import { ParallaxComponent } from "@/components/ui/parallax-scrolling";
import { ChallengeBento } from "@/components/challenge-bento";
import { useApp } from "@/lib/context";
import { api, isDemo } from "@/lib/api";

export function Landing() {
  const { session } = useApp();
  return (
    <ParallaxComponent>
      <Link className="google-entry" to={session ? "/challenges" : "/join"}>
        {!session && (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22ZM6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59ZM12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
            />
          </svg>
        )}
        {session ? "Enter challenges" : "Continue with Google"}
        <ArrowUpRight size={18} />
      </Link>
    </ParallaxComponent>
  );
}

export function Join() {
  const [profile, setProfile] = useState(() =>
    isDemo ? previewProfile() : "",
  );
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [teamName, setTeamName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const { setSession, busy, transact } = useApp();
  const navigate = useNavigate(),
    location = useLocation();
  const enter = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const session = await transact(() =>
        isDemo
          ? mode === "create"
            ? createPreviewTeam(teamName, profile)
            : joinPreviewTeam(code, profile)
          : api.join(teamName.trim(), code),
      );
      setSession(session);
      navigate(location.state?.from ?? "/challenges", { replace: true });
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <AnimatedPage className="join-page">
      <div className="join-illustration">
        <KeyholeMark className="join-keyhole" />
      </div>
      <section className="join-form">
        <h1>{isDemo && !profile ? "Preview the arena." : "Find your team."}</h1>
        {isDemo && !profile ? (
          <>
            <p className="preview-explanation">
              Start with your individual profile, then create or join a team.
              Google sign-in isn’t connected in this frontend preview.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  setPreviewProfile(name);
                  setProfile(name.trim());
                  setError("");
                } catch {
                  setError("Enable browser storage to use the team preview.");
                }
              }}
            >
              <label htmlFor="participant-name">Your name</label>
              <Input
                id="participant-name"
                size="lg"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                placeholder="Your display name"
                minLength={2}
                maxLength={64}
                required
              />
              <button
                className="button full-width"
                disabled={name.trim().length < 2}
              >
                Continue to teams <ArrowRight size={18} />
              </button>
            </form>
          </>
        ) : (
          <>
            {isDemo && (
              <>
                <p className="preview-explanation">
                  Continuing as {profile}.{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setPreviewProfile("");
                      setProfile("");
                      setError("");
                    }}
                  >
                    Change profile
                  </button>
                </p>
                <div className="segmented team-choice" aria-label="Team action">
                  {(["create", "join"] as const).map((item) => (
                    <button
                      key={item}
                      aria-pressed={mode === item}
                      onClick={() => {
                        setMode(item);
                        setError("");
                      }}
                    >
                      {item === "create" ? "Create a team" : "Join a team"}
                    </button>
                  ))}
                </div>
              </>
            )}
            <form onSubmit={enter}>
              {(!isDemo || mode === "create") && (
                <>
                  <label htmlFor="team-name">Team name</label>
                  <Input
                    id="team-name"
                    size="lg"
                    value={teamName}
                    onChange={(event) => setTeamName(event.target.value)}
                    placeholder="e.g. The Unprompted"
                    minLength={2}
                    maxLength={32}
                    autoComplete="organization"
                    required
                  />
                  <span className="field-help">
                    This name appears on the leaderboard.
                  </span>
                </>
              )}
              {(!isDemo || mode === "join") && (
                <>
                  <label htmlFor="team-code">Team code</label>
                  <Input
                    id="team-code"
                    size="lg"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="e.g. CC-1234ABCD"
                    maxLength={128}
                    autoComplete="off"
                    required
                  />
                  <span className="field-help">
                    Ask your team creator for the code.
                  </span>
                </>
              )}
              <button className="button full-width" disabled={busy}>
                {busy
                  ? "Entering…"
                  : isDemo && mode === "create"
                    ? "Create team"
                    : "Join team"}
                <ArrowRight size={18} />
              </button>
            </form>
          </>
        )}
        {error && <ErrorNotice message={error} />}
      </section>
    </AnimatedPage>
  );
}

export function Dashboard() {
  const { challenges, session } = useApp();
  const [filter, setFilter] = useState("All");
  const solved = session?.solved ?? [];
  const items = challenges.filter(
    (c) =>
      filter === "All" ||
      (filter === "Solved" ? solved.includes(c.id) : !solved.includes(c.id)),
  );
  return (
    <AnimatedPage className="page dashboard cryptum-dashboard">
      <div className="page-heading">
        <h1>Challenges</h1>
        <div className="compact-progress">
          <Flag size={15} />
          <span>{solved.length} / 10</span>
          <span>{session?.score ?? 0} pts</span>
        </div>
      </div>
      <div className="challenge-toolbar">
        <div className="segmented" aria-label="Filter challenges">
          {["All", "Unsolved", "Solved"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <ChallengeBento items={items} bonus={filter === "All"} />
      {!items.length && (
        <div className="empty-state">
          <Flag size={26} />
          <p>
            {filter === "Solved"
              ? "No flags captured yet."
              : "All challenges captured."}
          </p>
          <button
            className="button button-outline"
            onClick={() => setFilter("All")}
          >
            View all
          </button>
        </div>
      )}
    </AnimatedPage>
  );
}
