#!/bin/sh
set -eu

MAC_APP_BIN=/Applications/Ollama.app/Contents/Resources/ollama
if [ -n "${OLLAMA_BIN:-}" ]; then
  :
elif command -v ollama >/dev/null 2>&1; then
  OLLAMA_BIN=$(command -v ollama)
elif [ -x "$MAC_APP_BIN" ]; then
  OLLAMA_BIN=$MAC_APP_BIN
else
  echo "ollama not found; install it or set OLLAMA_BIN" >&2
  exit 1
fi

MODEL=${MODEL:-codex-qwen}
API=${OLLAMA_API:-http://127.0.0.1:11434}
STATE_DIR=${STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/codex-ollama}
DROPIN=/etc/systemd/system/ollama.service.d/codex.conf

SETTINGS="OLLAMA_NUM_PARALLEL=${NUM_PARALLEL:-4}
OLLAMA_MAX_QUEUE=${MAX_QUEUE:-32}
OLLAMA_KEEP_ALIVE=-1
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0"

detect_mode() {
  if [ -n "${MODE:-}" ]; then
    echo "$MODE"
  elif [ "$(uname -s)" = Darwin ] && [ -d /Applications/Ollama.app ]; then
    echo macapp
  elif command -v systemctl >/dev/null 2>&1 && systemctl cat ollama.service >/dev/null 2>&1; then
    echo systemd
  else
    echo standalone
  fi
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

wait_up() {
  i=0
  while [ $i -lt 60 ]; do
    curl -sf "$API/api/version" >/dev/null 2>&1 && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "Ollama did not come up on $API" >&2
  return 1
}

wait_down() {
  i=0
  while [ $i -lt 30 ]; do
    pgrep -f "$1" >/dev/null 2>&1 || return 0
    sleep 1
    i=$((i + 1))
  done
  echo "Ollama did not stop; stop it manually and rerun" >&2
  return 1
}

stop_standalone() {
  if [ -f "$STATE_DIR/serve.pid" ]; then
    kill "$(cat "$STATE_DIR/serve.pid")" 2>/dev/null || true
    rm -f "$STATE_DIR/serve.pid"
  fi
  pkill -TERM -f "ollama serve" 2>/dev/null || true
  wait_down "ollama serve"
}

apply_macapp() {
  echo "$SETTINGS" | while IFS='=' read -r key value; do
    launchctl setenv "$key" "$value"
  done
  osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
  pkill -TERM -f "Ollama.app/Contents/MacOS/Ollama" 2>/dev/null || true
  pkill -TERM -f "Ollama.app/Contents/Resources/ollama serve" 2>/dev/null || true
  wait_down "Ollama.app/Contents/Resources/ollama serve"
  open -a Ollama
}

reset_macapp() {
  echo "$SETTINGS" | while IFS='=' read -r key value; do
    launchctl unsetenv "$key"
  done
  pkill -TERM -f "Ollama.app/Contents/MacOS/Ollama" 2>/dev/null || true
  pkill -TERM -f "Ollama.app/Contents/Resources/ollama serve" 2>/dev/null || true
  wait_down "Ollama.app/Contents/Resources/ollama serve"
  open -a Ollama
}

apply_systemd() {
  tmp=$(mktemp)
  {
    echo "[Service]"
    echo "$SETTINGS" | while IFS= read -r line; do
      echo "Environment=\"$line\""
    done
  } > "$tmp"
  as_root mkdir -p "$(dirname "$DROPIN")"
  as_root cp "$tmp" "$DROPIN"
  as_root chmod 644 "$DROPIN"
  rm -f "$tmp"
  as_root systemctl daemon-reload
  as_root systemctl restart ollama
}

reset_systemd() {
  as_root rm -f "$DROPIN"
  as_root systemctl daemon-reload
  as_root systemctl restart ollama
}

apply_standalone() {
  stop_standalone
  mkdir -p "$STATE_DIR"
  (
    for pair in $SETTINGS; do
      export "${pair?}"
    done
    unset OLLAMA_HOST
    nohup "$OLLAMA_BIN" serve > "$STATE_DIR/serve.log" 2>&1 &
    echo $! > "$STATE_DIR/serve.pid"
  )
  echo "ollama serve started, log: $STATE_DIR/serve.log"
}

reset_standalone() {
  stop_standalone
  mkdir -p "$STATE_DIR"
  nohup "$OLLAMA_BIN" serve > "$STATE_DIR/serve.log" 2>&1 &
  echo $! > "$STATE_DIR/serve.pid"
}

warm() {
  echo "loading $MODEL ..."
  curl -sf "$API/api/generate" -d "{\"model\":\"$MODEL\",\"keep_alive\":-1}" >/dev/null
  "$OLLAMA_BIN" ps
}

show() {
  mode=$(detect_mode)
  echo "mode: $mode  binary: $OLLAMA_BIN"
  case $mode in
    macapp)
      echo "$SETTINGS" | while IFS='=' read -r key value; do
        echo "$key=$(launchctl getenv "$key")"
      done
      ;;
    systemd)
      systemctl show ollama -p Environment
      ;;
    standalone)
      if [ -f "$STATE_DIR/serve.pid" ] && [ -r "/proc/$(cat "$STATE_DIR/serve.pid")/environ" ]; then
        tr '\0' '\n' < "/proc/$(cat "$STATE_DIR/serve.pid")/environ" | grep '^OLLAMA_' || true
      else
        echo "$SETTINGS"
      fi
      ;;
  esac
  ps -A -o args= | grep -E '(llama-server|ollama runner)' | grep -v grep \
    | grep -oE '(-np|--parallel) [0-9]+|--cache-type-k [a-z0-9_]+|-c [0-9]+|--ctx-size [0-9]+' | tr '\n' ' ' || true
  echo
  "$OLLAMA_BIN" ps
}

mode=$(detect_mode)
case ${1:-show} in
  apply)
    "apply_$mode"
    wait_up
    warm
    show
    ;;
  reset)
    "reset_$mode"
    wait_up
    show
    ;;
  warm)
    warm
    ;;
  show)
    show
    ;;
  *)
    echo "usage: $0 [apply|reset|warm|show]" >&2
    echo "env: NUM_PARALLEL, MAX_QUEUE, MODEL, OLLAMA_BIN, MODE=macapp|systemd|standalone" >&2
    exit 2
    ;;
esac
