"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, LogOut, Home, LayoutGrid, Trophy, UserRound, LogIn } from "lucide-react";
import { api } from "./lib/api";
import type { Challenge, Session } from "./lib/contracts";
import { AppContext } from "./lib/context";
import { KeyholeMark } from "./components/keyhole-mark";
import { Dialog, ErrorNotice } from "./components/ui";

export function App({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [toast, setToast] = useState("");
  const [teamPath, setTeamPath] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
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
    let disposed = false;
    void Promise.all([api.session(), api.challenges()])
      .then(([s, c]) => {
        if (disposed) return;
        setSession(s);
        setChallenges(c);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Could not open the vault.");
      })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    document.body.dataset.page = pathname === "/" ? "home" : "interior";
    window.scrollTo(0, 0);
    document.title = `Codex Cryptum — ${pathname.startsWith("/arena") ? "Arena" : pathname === "/" ? "Home" : pathname.slice(1).replace(/^./, c => c.toUpperCase())}`;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  async function transact<T>(action: () => Promise<T>): Promise<T> {
    if (pending.current) throw new Error("Please wait for your current request to finish.");
    pending.current = true;
    setBusy(true);
    try { return await action(); }
    finally { pending.current = false; setBusy(false); }
  }
  return (
    <AppContext.Provider value={{ session, setSession, challenges, busy, transact, toast: setToast }}>
      <a href="#main" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className={`icon-header ${pathname === "/" ? "icon-header-home" : ""}`}>
        <Link href="/" className="brand-keyhole" aria-label="Codex Cryptum home"><KeyholeMark /></Link>
        <nav className="icon-nav" aria-label="Main navigation">
          {[
            { href: "/", label: "Home", Icon: Home },
            { href: "/arena", label: "Challenges", Icon: LayoutGrid },
            { href: "/leaderboard", label: "Leaderboard", Icon: Trophy },
          ].map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} aria-label={label} className={`nav-icon ${pathname === href ? "active" : ""}`}>
              <Icon size={22} strokeWidth={1.6} /><span className="nav-tooltip" aria-hidden="true">{label}</span>
            </Link>
          ))}
          {session ? <button className="nav-icon" aria-label="Account" onClick={() => setTeamPath(pathname)}><UserRound size={22} strokeWidth={1.6} /><span className="nav-tooltip" aria-hidden="true">Account</span></button>
            : <Link href="/join" className="nav-icon" aria-label="Sign in"><LogIn size={22} strokeWidth={1.6} /><span className="nav-tooltip" aria-hidden="true">Sign in</span></Link>}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {loading ? <div className="loading-page"><span className="loader" /><p>Opening the vault…</p></div>
          : error ? <div className="page"><h1>Connection interrupted</h1><ErrorNotice message={error} retry={load} /></div> : children}
      </main>
      <output className={`toast ${toast ? "visible" : ""}`} aria-live="polite">{toast && <><CheckCircle2 size={18} /><span>{toast}</span></>}</output>
      {teamPath === pathname && session && <Dialog title={session.teamName} onClose={() => setTeamPath(null)}>
        <div className="team-summary"><span>{session.solved.length} / 10 flags</span><span>{session.score.toLocaleString()} pts</span></div>
        <p>Your competition team.</p>
        <div className="dialog-actions"><Link href="/arena" className="button">Challenges <ArrowUpRight size={16} /></Link><button className="button button-outline" disabled={busy} onClick={() => { setTeamPath(null); setLeaving(true); }}><LogOut size={16} /> Leave team</button></div>
      </Dialog>}
      {leaving && <Dialog title="Leave this team?" onClose={() => setLeaving(false)}>
        <p>You will be signed out. Your team’s server progress will be preserved.</p>
        <div className="dialog-actions"><button className="button button-outline" onClick={() => setLeaving(false)}>Stay here</button><button className="button" disabled={busy} onClick={async () => {
          try { await transact(() => api.leave()); setSession(null); setLeaving(false); router.push("/join"); }
          catch (e) { setToast((e as Error).message); }
        }}>Leave team</button></div>
      </Dialog>}
    </AppContext.Provider>
  );
}
