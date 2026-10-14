import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowUpRight,
  CheckCircle2,
  Flag,
  LogOut,
  Home,
  LayoutGrid,
  Trophy,
  UserRound,
  LogIn,
} from "lucide-react";
import {
  previewTeam,
  previewProfile,
  savePreviewProgress,
} from "./lib/team-preview";
import { api, isDemo } from "./lib/api";
import type { Challenge, Session } from "./lib/contracts";
import { AppContext } from "./lib/context";
import { KeyholeMark } from "./components/keyhole-mark";
import { Dialog, ErrorNotice } from "./components/ui";
import { Landing, Join, Dashboard } from "./pages/Overview";
import { Arena } from "./pages/Arena";
import { LeaderboardPage, LeaderboardChallenge } from "./pages/Leaderboard";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    pending = useRef(false);
  const [toast, setToast] = useState(""),
    [teamOpen, setTeamOpen] = useState(false),
    [leaving, setLeaving] = useState(false);
  const location = useLocation(),
    navigate = useNavigate();
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [s, c] = await Promise.all([api.session(), api.challenges()]);
      setSession(s);
      setChallenges(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setTeamOpen(false);
    document.body.dataset.page =
      location.pathname === "/" ? "home" : "interior";
    window.scrollTo(0, 0);
    document.title = `Codex Cryptum — ${location.pathname.startsWith("/arena") ? "Arena" : location.pathname === "/" ? "Home" : location.pathname.slice(1).replace(/^./, (c) => c.toUpperCase())}`;
    const main = document.getElementById("main");
    main?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  async function transact<T>(action: () => Promise<T>): Promise<T> {
    if (pending.current)
      throw new Error("Please wait for your current request to finish.");
    pending.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (isDemo && session) {
      try {
        savePreviewProgress(session);
      } catch {
        setToast("Team progress could not be saved to browser storage.");
      }
    }
  }, [session]);
  let teamDetails: ReturnType<typeof previewTeam>;
  let memberName = "";
  if (isDemo && session) {
    try {
      teamDetails = previewTeam(session.id);
      memberName = previewProfile();
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const isLanding = location.pathname === "/";
  return (
    <AppContext.Provider
      value={{
        session,
        setSession,
        challenges,
        busy,
        transact,
        toast: setToast,
      }}
    >
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className={`icon-header ${isLanding ? "icon-header-home" : ""}`}>
        <Link to="/" className="brand-keyhole" aria-label="Codex Cryptum home">
          <KeyholeMark />
        </Link>
        <nav className="icon-nav" aria-label="Main navigation">
          {[
            { to: "/", label: "Home", Icon: Home },
            { to: "/challenges", label: "Challenges", Icon: LayoutGrid },
            { to: "/leaderboard", label: "Leaderboard", Icon: Trophy },
          ].map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              className="nav-icon"
            >
              <Icon size={22} strokeWidth={1.6} />
              <span className="nav-tooltip" aria-hidden="true">
                {label}
              </span>
            </NavLink>
          ))}
          {session ? (
            <button
              className="nav-icon"
              aria-label="Account"
              onClick={() => setTeamOpen(true)}
            >
              <UserRound size={22} strokeWidth={1.6} />
              <span className="nav-tooltip" aria-hidden="true">
                Account
              </span>
            </button>
          ) : (
            <NavLink to="/join" className="nav-icon" aria-label="Sign in">
              <LogIn size={22} strokeWidth={1.6} />
              <span className="nav-tooltip" aria-hidden="true">
                Sign in
              </span>
            </NavLink>
          )}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {loading ? (
          <div className="loading-page">
            <span className="loader" />
            <p>Opening the vault…</p>
          </div>
        ) : error ? (
          <div className="page">
            <h1>Connection interrupted</h1>
            <ErrorNotice message={error} retry={load} />
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/join"
              element={
                session ? <Navigate to="/challenges" replace /> : <Join />
              }
            />
            <Route path="/challenges" element={<Dashboard />} />
            <Route
              path="/arena/:id"
              element={
                session ? (
                  <Arena />
                ) : (
                  <Navigate
                    to="/join"
                    state={{ from: location.pathname }}
                    replace
                  />
                )
              }
            />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route
              path="/leaderboard-challenge"
              element={
                session ? (
                  <LeaderboardChallenge />
                ) : (
                  <Navigate
                    to="/join"
                    state={{ from: location.pathname }}
                    replace
                  />
                )
              }
            />
            <Route
              path="/briefing"
              element={<Navigate to="/challenges" replace />}
            />
            <Route
              path="*"
              element={
                <div className="page empty-page">
                  <Flag size={32} />
                  <h1>Uncharted territory.</h1>
                  <p>This route doesn’t lead to a challenge.</p>
                  <Link to="/challenges" className="button">
                    Back to challenges <ArrowUpRight size={18} />
                  </Link>
                </div>
              }
            />
          </Routes>
        )}
      </main>
      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <CheckCircle2 size={18} />
            <span>{toast}</span>
          </>
        )}
      </div>
      {teamOpen && session && (
        <Dialog title={session.teamName} onClose={() => setTeamOpen(false)}>
          {memberName && <p>Profile: {memberName}</p>}
          {teamDetails && (
            <div className="account-team-code">
              <span>Team code</span>
              <strong>{teamDetails.code}</strong>
              <p>{teamDetails.members.join(", ")}</p>
            </div>
          )}
          <div className="team-summary">
            <span>{session.solved.length} / 10 flags</span>
            <span>{session.score.toLocaleString()} pts</span>
          </div>
          <p>
            {isDemo
              ? "Local demo session. Progress is saved in this browser."
              : "Your competition team."}
          </p>
          <div className="dialog-actions">
            <Link to="/challenges" className="button">
              Challenges <ArrowUpRight size={16} />
            </Link>
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => {
                setTeamOpen(false);
                setLeaving(true);
              }}
            >
              <LogOut size={16} /> Leave team
            </button>
          </div>
        </Dialog>
      )}
      {leaving && (
        <Dialog title="Leave this team?" onClose={() => setLeaving(false)}>
          <p>
            {isDemo
              ? "This leaves the active preview team. Teams created through this browser’s team flow retain their progress; use their team code to rejoin."
              : "You will be signed out. Your team’s server progress will be preserved."}
          </p>
          <div className="dialog-actions">
            <button
              className="button button-outline"
              onClick={() => setLeaving(false)}
            >
              Stay here
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await transact(() => api.leave());
                  setSession(null);
                  setLeaving(false);
                  navigate("/join");
                } catch (e) {
                  setToast((e as Error).message);
                }
              }}
            >
              Leave team
            </button>
          </div>
        </Dialog>
      )}
    </AppContext.Provider>
  );
}
