import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Copy, Flag } from "lucide-react";
import { AnimatedPage, ErrorNotice } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { GoogleSignIn } from "@/components/google-sign-in";
import { KeyholeMark } from "@/components/keyhole-mark";
import { ParallaxComponent } from "@/components/ui/parallax-scrolling";
import { ChallengeBento } from "@/components/challenge-bento";
import { useApp } from "@/lib/context";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { CreatedTeam, Session } from "@/lib/contracts";

export function Landing() {
  const { session } = useApp();
  const account = authClient.useSession();
  return (
    <ParallaxComponent>
      <Link className="google-entry" href={session ? "/arena" : "/join"}>
        {!session && !account.data && (
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22ZM6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59ZM12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z" />
          </svg>
        )}
        {session ? "Enter challenges" : account.data ? "Join or create a team" : "Continue with Google"}
        <ArrowUpRight size={18} />
      </Link>
    </ParallaxComponent>
  );
}

export function Join() {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [teamName, setTeamName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedTeam | null>(null);
  const { setSession, busy, transact, toast } = useApp();
  const account = authClient.useSession();
  const router = useRouter();
  const proceed = (session: Session) => {
    setSession(session);
    const from = new URLSearchParams(window.location.search).get("from");
    router.replace(from?.startsWith("/arena/") ? from : "/arena");
  };
  const switchMode = (next: "join" | "create") => {
    setMode(next);
    setError("");
  };
  const enter = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      if (mode === "create") setCreated(await transact(() => api.createTeam(teamName.trim())));
      else proceed(await transact(() => api.join(code.trim())));
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Team code copied.");
    } catch {
      toast("Copy failed. Select the code and copy it manually.");
    }
  };
  if (created) {
    return (
      <AnimatedPage className="join-page">
        <div className="join-illustration"><KeyholeMark className="join-keyhole" /></div>
        <section className="join-form">
          <h1>Team created.</h1>
          <div className="team-code-card">
            <span className="field-help">Team code for {created.session.teamName}</span>
            <code className="team-code">{created.accessCode}</code>
            <span className="field-help">Share this code with your teammates. You can find it again on My team.</span>
          </div>
          <button type="button" className="button button-outline full-width" onClick={() => copy(created.accessCode)}>
            Copy code<Copy size={16} />
          </button>
          <button type="button" className="button full-width" onClick={() => proceed(created.session)}>
            Continue to challenges<ArrowRight size={18} />
          </button>
        </section>
      </AnimatedPage>
    );
  }
  return (
    <AnimatedPage className="join-page">
      <div className="join-illustration"><KeyholeMark className="join-keyhole" /></div>
      <section className="join-form">
        <h1>{mode === "create" ? "Start a team." : "Find your team."}</h1>
        {account.isPending ? <output className="join-auth">Checking your sign-in…</output> : !account.data ? (
          <GoogleSignIn className="join-auth" callbackURL="/join" />
        ) : <>
        <p className="signed-in-as">Signed in as <b>{account.data.user.email}</b></p>
        <div className="segmented join-mode" aria-label="Team access">
          <button type="button" onClick={() => switchMode("join")} aria-pressed={mode === "join"}>Join a team</button>
          <button type="button" onClick={() => switchMode("create")} aria-pressed={mode === "create"}>Create a team</button>
        </div>
        <form onSubmit={enter}>
          {mode === "create" ? (
            <>
              <label htmlFor="team-name">Team name</label>
              <Input id="team-name" size="lg" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. The Unprompted" minLength={2} maxLength={32} autoComplete="organization" required />
              <span className="field-help">This name appears on the leaderboard. You can rename it later from My team.</span>
            </>
          ) : (
            <>
              <label htmlFor="team-code">Team code</label>
              <Input id="team-code" size="lg" value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. CC-1234ABCD" maxLength={128} autoComplete="off" required />
              <span className="field-help">Ask a teammate for your team's code.</span>
            </>
          )}
          <button className="button full-width" disabled={busy}>
            {mode === "create" ? (busy ? "Creating…" : "Create team") : (busy ? "Entering…" : "Join team")}<ArrowRight size={18} />
          </button>
        </form>
        {error && <ErrorNotice message={error} />}
        </>}
      </section>
    </AnimatedPage>
  );
}

export function Dashboard() {
  const { challenges, session } = useApp();
  const [filter, setFilter] = useState("All");
  const solved = session?.solved ?? [];
  const items = challenges.filter((c) => filter === "All" || (filter === "Solved" ? solved.includes(c.id) : !solved.includes(c.id)));
  return (
    <AnimatedPage className="page dashboard cryptum-dashboard">
      <div className="page-heading">
        <h1>Challenges</h1>
        <div className="compact-progress"><Flag size={15} /><span>{solved.length} / 10</span><span>{session?.score ?? 0} pts</span></div>
      </div>
      <div className="challenge-toolbar">
        <div className="segmented" aria-label="Filter challenges">
          {["All", "Unsolved", "Solved"].map((f) => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}>{f}</button>)}
        </div>
      </div>
      <ChallengeBento items={items} />
      {!items.length && (
        <div className="empty-state">
          <Flag size={26} /><p>{filter === "Solved" ? "No flags captured yet." : "All challenges captured."}</p>
          <button className="button button-outline" onClick={() => setFilter("All")}>View all</button>
        </div>
      )}
    </AnimatedPage>
  );
}
