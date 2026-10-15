// Refresh after each request settles, so slow connections never stack requests.
export function startLiveRefresh(refresh: () => Promise<void>, interval = 3000) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stopped || running) return;
    clearTimeout(timer);
    running = true;
    try { await refresh(); }
    finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(), interval);
    }
  };
  const wake = () => { void tick(); };
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
