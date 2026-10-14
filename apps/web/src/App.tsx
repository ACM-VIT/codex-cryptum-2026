"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, LogOut, Home, LayoutGrid, Trophy, UserRound, LogIn, Users } from "lucide-react";
import { api } from "./lib/api";
import { authClient } from "./lib/auth-client";
import type { Challenge, Session } from "./lib/contracts";
import { AppContext } from "./lib/context";
import { KeyholeMark } from "./components/keyhole-mark";
import { ErrorNotice } from "./components/ui";

export function App({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [toast, setToast] = useState("");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const account = authClient.useSession();
  const pathname = usePathname();
  const router = useRouter();
  const menuOpen = menuPath === pathname;
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuPath(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [menuOpen]);
  const logOut = async () => {
    try {
      await transact(async () => {
        if (session) await api.logout();
        await authClient.signOut();
      });
      setSession(null);
      setMenuOpen(false);
      router.push("/");
    } catch (e) {
      setToast((e as Error).message);
    }
  };
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
            ...(session ? [{ href: "/team", label: "My team", Icon: Users }] : []),
          ].map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} aria-label={label} className={`nav-icon ${pathname === href ? "active" : ""}`}>
              <Icon size={22} strokeWidth={1.6} /><span className="nav-tooltip" aria-hidden="true">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="header-account" ref={menuRef}>
          {account.data ? <>
            <button className="nav-icon" aria-label="Account" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><UserRound size={22} strokeWidth={1.6} /></button>
            {menuOpen && <div className="account-menu" role="menu">
              <div className="account-identity">
                <b>{account.data.user.name}</b>
                <span>{account.data.user.email}</span>
              </div>
              {session ? <Link role="menuitem" href="/team" onClick={() => setMenuOpen(false)}><Users size={16} /> My team</Link>
                : <Link role="menuitem" href="/join" onClick={() => setMenuOpen(false)}><Users size={16} /> Join or create a team</Link>}
              <button role="menuitem" disabled={busy} onClick={logOut}><LogOut size={16} /> Log out</button>
            </div>}
          </> : !account.isPending && <Link href="/join" className="nav-icon" aria-label="Sign in"><LogIn size={22} strokeWidth={1.6} /><span className="nav-tooltip" aria-hidden="true">Sign in</span></Link>}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {loading ? <div className="loading-page"><span className="loader" /><p>Opening the vault…</p></div>
          : error ? <div className="page"><h1>Connection interrupted</h1><ErrorNotice message={error} retry={load} /></div> : children}
      </main>
      <output className={`toast ${toast ? "visible" : ""}`} aria-live="polite">{toast && <><CheckCircle2 size={18} /><span>{toast}</span></>}</output>
    </AppContext.Provider>
  );
}
