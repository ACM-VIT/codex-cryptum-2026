import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
EXPECTED_ENV = {
    "OLLAMA_NUM_PARALLEL": "4",
    "OLLAMA_MAX_QUEUE": "32",
    "OLLAMA_KEEP_ALIVE": "-1",
    "OLLAMA_MAX_LOADED_MODELS": "1",
    "OLLAMA_FLASH_ATTENTION": "1",
    "OLLAMA_KV_CACHE_TYPE": "q8_0",
}

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"


def get(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.load(resp)


def post(url, payload, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def sh(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def check_ollama(model):
    try:
        version = get(f"{OLLAMA}/api/version")["version"]
    except (OSError, ValueError, KeyError):
        return [(FAIL, "ollama", "not responding on 127.0.0.1:11434; open the Ollama app")]
    out = [(PASS, "ollama", f"up, version {version}")]

    try:
        names = [m["name"] for m in get(f"{OLLAMA}/api/tags")["models"]]
    except (OSError, ValueError, KeyError):
        names = []
    if any(n.split(":")[0] == model for n in names):
        out.append((PASS, "model installed", model))
    else:
        out.append((FAIL, "model installed", f"{model} missing; run: ollama create {model} -f infra/ollama/Modelfile"))

    try:
        loaded = get(f"{OLLAMA}/api/ps")["models"]
    except (OSError, ValueError, KeyError):
        loaded = []
    mine = [m for m in loaded if m["name"].split(":")[0] == model]
    others = [m["name"] for m in loaded if m["name"].split(":")[0] != model]
    if not mine:
        out.append((WARN, "model loaded", "not in memory; first request will be slow. run: ./scripts/ollama_env.sh warm"))
    else:
        m = mine[0]
        size = m.get("size_vram") or m.get("size") or 0
        year = m.get("expires_at", "")[:4]
        forever = year.isdigit() and int(year) > 2100
        status = PASS if forever else WARN
        note = "" if forever else f"; unloads at {m.get('expires_at')}, keep-alive not -1"
        out.append((status, "model loaded", f"{size / 2**30:.1f} GB in GPU memory{note}"))
    if others:
        out.append((WARN, "other models", f"also loaded: {', '.join(others)}"))
    return out


def check_env():
    bad = []
    for key, want in EXPECTED_ENV.items():
        have = sh("launchctl", "getenv", key).strip()
        if have != want:
            bad.append(f"{key}={have or 'unset'} (want {want})")
    pid = sh("pgrep", "-f", "Ollama.app/Contents/Resources/ollama serve").split()
    live = sh("ps", "eww", "-p", pid[0]) if pid else ""
    stale = [k for k, v in EXPECTED_ENV.items() if f"{k}={v}" not in live]
    if bad:
        return [(FAIL, "settings", "; ".join(bad) + ". run: ./scripts/ollama_env.sh apply")]
    if pid and stale:
        return [(FAIL, "settings", "set but the running server predates them. run: ./scripts/ollama_env.sh apply")]
    return [(PASS, "settings", "parallel 4, queue 32, keep-alive forever, q8_0 KV")]


def check_listen():
    out = sh("lsof", "-nP", "-iTCP:11434", "-sTCP:LISTEN")
    addrs = set(re.findall(r"TCP (\S+):11434", out))
    if not addrs:
        return [(FAIL, "ollama exposure", "nothing listening on 11434")]
    if addrs <= {"127.0.0.1", "[::1]", "localhost"}:
        return [(PASS, "ollama exposure", "localhost only")]
    return [(FAIL, "ollama exposure", f"listening on {', '.join(sorted(addrs))}; unset OLLAMA_HOST and restart Ollama")]


def check_gate(gate, model, timeout):
    out = []
    try:
        names = [m["name"] for m in get(f"{gate}/api/tags")["models"]]
        out.append((PASS, "gate", f"{gate} reachable, sees {len(names)} model(s)"))
    except urllib.error.HTTPError as exc:
        hint = "add --allow 127.0.0.1 to the gate to test from this Mac" if exc.code == 403 else ""
        return [(FAIL, "gate", f"HTTP {exc.code} {hint}".strip())]
    except (OSError, ValueError, KeyError):
        return [(FAIL, "gate", f"{gate} not reachable; run: python3 infra/proxy/gate.py --allow <backend-ip>")]

    payload = {
        "model": model,
        "max_tokens": 32,
        "messages": [
            {"role": "system", "content": "Answer with just the number. /no_think"},
            {"role": "user", "content": "What is 17 * 23? /no_think"},
        ],
    }
    started = time.time()
    try:
        reply = post(f"{gate}/v1/chat/completions", payload, timeout)
    except urllib.error.HTTPError as exc:
        return out + [(FAIL, "chat", f"HTTP {exc.code}")]
    except OSError as exc:
        return out + [(FAIL, "chat", f"{exc}")]
    dt = time.time() - started
    raw = reply["choices"][0]["message"].get("content") or ""
    reasoning = reply["choices"][0]["message"].get("reasoning")
    clean = raw.rsplit("</think>", 1)[1].strip() if "</think>" in raw else ("" if "<think>" in raw else raw.strip())
    if reasoning or ("<think>" in raw and "</think>" not in raw):
        out.append((FAIL, "chat", "model produced reasoning; check Modelfile and /no_think"))
    elif "391" not in clean:
        out.append((WARN, "chat", f"unexpected answer {clean[:40]!r} in {dt:.1f}s"))
    else:
        status = PASS if dt < 10 else WARN
        out.append((status, "chat", f"answered in {dt:.1f}s" + ("" if status == PASS else " (slow: busy or swapping)")))
    return out


def check_host():
    out = []
    batt = sh("pmset", "-g", "batt")
    if "AC Power" in batt:
        out.append((PASS, "power", "on AC"))
    else:
        pct = re.search(r"(\d+)%", batt)
        out.append((FAIL, "power", f"on battery{f' ({pct.group(1)}%)' if pct else ''}; plug in the charger"))

    if sh("pgrep", "-x", "caffeinate").strip():
        out.append((PASS, "sleep", "caffeinate running"))
    else:
        out.append((WARN, "sleep", "no caffeinate; run: caffeinate -dimsu &"))

    free = re.search(r"free percentage: (\d+)%", sh("memory_pressure"))
    swap = re.search(r"used = ([\d.]+)M", sh("sysctl", "vm.swapusage"))
    if free:
        pct = int(free.group(1))
        used = float(swap.group(1)) / 1024 if swap else 0
        status = PASS if pct >= 20 and used < 2 else WARN if pct >= 10 else FAIL
        out.append((status, "memory", f"{pct}% free, {used:.1f} GB swap" + ("" if status == PASS else "; quit other apps")))

    disk = sh("df", "-g", "/").splitlines()
    if len(disk) > 1:
        avail = int(disk[1].split()[3])
        out.append((PASS if avail >= 5 else WARN, "disk", f"{avail} GB free"))
    return out


def run(args):
    results = check_ollama(args.model) + check_env() + check_listen() + check_host()
    if not args.no_gate:
        results += check_gate(args.gate, args.model, args.timeout)
    width = max(len(name) for _, name, _ in results)
    stamp = time.strftime("%H:%M:%S")
    for status, name, detail in results:
        print(f"{stamp} [{status}] {name:<{width}}  {detail}")
    worst = FAIL if any(s == FAIL for s, _, _ in results) else WARN if any(s == WARN for s, _, _ in results) else PASS
    print(f"{stamp} overall: {worst}", flush=True)
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", default="http://127.0.0.1:8080")
    ap.add_argument("--model", default="codex-qwen")
    ap.add_argument("--timeout", type=float, default=60)
    ap.add_argument("--no-gate", action="store_true")
    ap.add_argument("--watch", type=float, default=0, help="repeat every N seconds")
    args = ap.parse_args()

    if not args.watch:
        sys.exit({PASS: 0, WARN: 1, FAIL: 2}[run(args)])
    while True:
        run(args)
        print()
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
