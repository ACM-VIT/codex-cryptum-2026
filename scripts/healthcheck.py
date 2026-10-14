import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
EXPECTED_ENV = {
    "OLLAMA_NUM_PARALLEL": "4",
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


def tagged(name):
    return name if ":" in name.rsplit("/", 1)[-1] else f"{name}:latest"


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
    if any(tagged(n) == tagged(model) for n in names):
        out.append((PASS, "model installed", model))
    else:
        out.append((FAIL, "model installed", f"{model} missing; run: ollama create {model} -f infra/ollama/Modelfile"))

    try:
        loaded = get(f"{OLLAMA}/api/ps")["models"]
    except (OSError, ValueError, KeyError):
        loaded = []
    mine = [m for m in loaded if tagged(m["name"]) == tagged(model)]
    others = [m["name"] for m in loaded if tagged(m["name"]) != tagged(model)]
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


def runner_args():
    out = sh("ps", "-A", "-o", "args=")
    return [line for line in out.splitlines() if "llama-server" in line or "ollama runner" in line]


def check_env():
    runners = runner_args()
    if not runners:
        return [(WARN, "settings", "no model runner running; load the model, then re-check")]
    args = " ".join(runners)
    parallel = re.search(r"(?:-np|--parallel) (\d+)", args)
    kv = re.search(r"--cache-type-k (\S+)", args)
    problems = []
    if not parallel or parallel.group(1) != EXPECTED_ENV["OLLAMA_NUM_PARALLEL"]:
        problems.append(f"parallel {parallel.group(1) if parallel else 'unknown'} (want {EXPECTED_ENV['OLLAMA_NUM_PARALLEL']})")
    if kv and kv.group(1) != EXPECTED_ENV["OLLAMA_KV_CACHE_TYPE"]:
        problems.append(f"KV cache {kv.group(1)} (want {EXPECTED_ENV['OLLAMA_KV_CACHE_TYPE']})")
    if problems:
        return [(FAIL, "settings", "; ".join(problems) + ". run: ./scripts/ollama_env.sh apply")]
    return [(PASS, "settings", f"parallel {parallel.group(1)}" + (f", {kv.group(1)} KV" if kv else ""))]


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))
            return sock.getsockname()[0]
    except OSError:
        return None


def check_listen():
    ip = lan_ip()
    if not ip or ip.startswith("127."):
        return [(WARN, "ollama exposure", "no network address found; could not check")]
    try:
        with socket.create_connection((ip, 11434), timeout=2):
            exposed = True
    except OSError:
        exposed = False
    if exposed:
        return [(FAIL, "ollama exposure", f"reachable on {ip}:11434; unset OLLAMA_HOST and restart Ollama")]
    return [(PASS, "ollama exposure", f"not reachable on {ip}:11434 (localhost only)")]


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


def read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def power_status():
    system = platform.system()
    if system == "Darwin":
        batt = sh("pmset", "-g", "batt")
        pct = re.search(r"(\d+)%", batt)
        return "AC Power" in batt, pct.group(1) if pct else None
    if system == "Linux":
        base = "/sys/class/power_supply"
        names = os.listdir(base) if os.path.isdir(base) else []
        mains = [n for n in names if read(f"{base}/{n}/type") == "Mains"]
        batteries = [n for n in names if read(f"{base}/{n}/type") == "Battery"]
        if not batteries:
            return True, None
        on_ac = any(read(f"{base}/{n}/online") == "1" for n in mains)
        return on_ac, read(f"{base}/{batteries[0]}/capacity") or None
    return None, None


def sleep_inhibited():
    if platform.system() == "Darwin":
        return bool(sh("pgrep", "-x", "caffeinate").strip()), "caffeinate -dimsu &"
    if shutil.which("systemd-inhibit"):
        listing = sh("systemd-inhibit", "--list", "--no-pager")
        return bool(re.search(r"\bsleep\b", listing)), "systemd-inhibit --what=sleep:idle sleep infinity &"
    return None, ""


def memory_status():
    if platform.system() == "Darwin":
        free = re.search(r"free percentage: (\d+)%", sh("memory_pressure"))
        swap = re.search(r"used = ([\d.]+)M", sh("sysctl", "vm.swapusage"))
        if not free:
            return None, None
        return int(free.group(1)), float(swap.group(1)) / 1024 if swap else 0.0
    info = {}
    for line in read("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        if rest.split():
            info[key] = int(rest.split()[0])
    if "MemTotal" not in info or "MemAvailable" not in info:
        return None, None
    swap = (info.get("SwapTotal", 0) - info.get("SwapFree", 0)) / 2**20
    return round(100 * info["MemAvailable"] / info["MemTotal"]), swap


def check_host():
    out = []
    on_ac, pct = power_status()
    if on_ac is None:
        out.append((WARN, "power", "could not read power state on this OS"))
    elif on_ac:
        out.append((PASS, "power", "on AC" if pct else "on AC (no battery)"))
    else:
        out.append((FAIL, "power", f"on battery{f' ({pct}%)' if pct else ''}; plug in the charger"))

    inhibited, hint = sleep_inhibited()
    if inhibited is None:
        out.append((WARN, "sleep", "could not check; make sure the machine cannot sleep"))
    elif inhibited:
        out.append((PASS, "sleep", "sleep inhibited"))
    else:
        out.append((WARN, "sleep", f"nothing preventing sleep; run: {hint}"))

    pct_free, swap_gb = memory_status()
    if pct_free is not None:
        status = PASS if pct_free >= 20 and swap_gb < 2 else WARN if pct_free >= 10 else FAIL
        out.append((status, "memory", f"{pct_free}% free, {swap_gb:.1f} GB swap" + ("" if status == PASS else "; quit other apps")))

    avail = shutil.disk_usage(os.path.expanduser("~")).free / 2**30
    out.append((PASS if avail >= 5 else WARN, "disk", f"{avail:.0f} GB free"))
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
    ap.add_argument("--model", default="qwen3:8b")
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
