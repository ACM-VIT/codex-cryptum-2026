import json
import os
import re
import urllib.error
import urllib.request

BASE_URL = os.environ.get("CDX_MODEL_URL", "http://127.0.0.1:8080/v1").rstrip("/")
MODEL = os.environ.get("CDX_MODEL", "qwen3:8b")
API_KEY = os.environ.get("CDX_API_KEY", "ollama")
QWEN = MODEL.startswith("qwen3")
NO_THINK = " /no_think"
FLAG_RE = re.compile(r"cdx\{[A-Za-z0-9_-]{1,128}\}")


class ModelError(Exception):
    pass


def load_flag(env_name):
    flag = os.environ.get(env_name, "")
    if not FLAG_RE.fullmatch(flag):
        raise SystemExit(f"set {env_name} to a cdx{{...}} flag")
    return flag


def clean(text):
    if "</think>" in text:
        return text.rsplit("</think>", 1)[1].strip()
    if "<think>" in text:
        return ""
    return text.strip()


def guard(messages):
    out = []
    for m in messages:
        content = m["content"]
        if m["role"] in ("system", "user"):
            content = content + NO_THINK
        out.append({"role": m["role"], "content": content})
    return out


def chat(messages, max_tokens=None, temperature=None, timeout=120):
    if QWEN:
        payload = {"model": MODEL, "messages": guard(messages)}
        if max_tokens:
            payload["max_tokens"] = max_tokens
    else:
        payload = {"model": MODEL, "messages": messages, "reasoning_effort": "none"}
        if max_tokens:
            payload["max_completion_tokens"] = max_tokens
    if temperature is not None:
        payload["temperature"] = temperature
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.load(resp)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ModelError(str(exc)) from None
    try:
        return clean(data["choices"][0]["message"].get("content") or "")
    except (KeyError, IndexError, TypeError):
        raise ModelError("malformed response") from None
