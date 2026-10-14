#!/bin/zsh
set -euo pipefail

OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
MODEL=${MODEL:-codex-qwen}

typeset -A SETTINGS
SETTINGS=(
  OLLAMA_NUM_PARALLEL ${NUM_PARALLEL:-4}
  OLLAMA_MAX_QUEUE ${MAX_QUEUE:-32}
  OLLAMA_KEEP_ALIVE -1
  OLLAMA_MAX_LOADED_MODELS 1
  OLLAMA_FLASH_ATTENTION 1
  OLLAMA_KV_CACHE_TYPE q8_0
)

restart_app() {
  osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
  pkill -TERM -f "Ollama.app/Contents/MacOS/Ollama" || true
  pkill -TERM -f "Ollama.app/Contents/Resources/ollama serve" || true
  for _ in {1..30}; do
    pgrep -fq "Ollama.app/Contents/Resources/ollama serve" || break
    sleep 0.5
  done
  if pgrep -fq "Ollama.app/Contents/Resources/ollama serve"; then
    echo "Ollama did not quit; quit it from the menu bar and rerun" >&2
    return 1
  fi
  open -a Ollama
  for _ in {1..40}; do
    curl -sf localhost:11434/api/version >/dev/null && return 0
    sleep 0.5
  done
  echo "Ollama did not come back on :11434" >&2
  return 1
}

warm() {
  echo "loading $MODEL ..."
  curl -sf localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"keep_alive\":-1}" >/dev/null
  $OLLAMA ps
}

show() {
  for k in ${(ko)SETTINGS}; do
    echo "$k=$(launchctl getenv $k)"
  done
  grep -h 'msg="server config"' ~/.ollama/logs/server.log 2>/dev/null | tail -1 \
    | grep -oE 'OLLAMA_(NUM_PARALLEL|MAX_QUEUE|KEEP_ALIVE|MAX_LOADED_MODELS|FLASH_ATTENTION|KV_CACHE_TYPE):[^ ]*' || true
  $OLLAMA ps
}

case ${1:-show} in
  apply)
    for k in ${(ko)SETTINGS}; do
      launchctl setenv $k ${SETTINGS[$k]}
    done
    restart_app
    warm
    show
    ;;
  reset)
    for k in ${(ko)SETTINGS}; do
      launchctl unsetenv $k
    done
    restart_app
    show
    ;;
  warm)
    warm
    ;;
  show)
    show
    ;;
  *)
    echo "usage: $0 [apply|reset|warm|show]   env: NUM_PARALLEL, MAX_QUEUE, MODEL" >&2
    exit 2
    ;;
esac
