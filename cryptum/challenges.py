"""Challenge-only model and output filtering logic.

Flags in this module are synthetic development values. Production deployments
must replace them with challenge-specific server-side secrets.
"""

import base64
import binascii
import html
import re
import unicodedata
from urllib.parse import unquote

FLAG_L5 = "CTF{synthetic_l5_exact_flag}"
FLAG_L6 = "CTF{synthetic_l6_smart_flag}"
REDACTION = "[redacted: challenge output filter]"


def _model_reply(level: int, message: str) -> str:
    """Small deterministic model adapter used until a hosted LLM is configured."""
    if level == 5:
        match = re.search(r"(?:character|char)\s+(?:at\s+)?(?:position|index)\s+(\d+)", message, re.I)
        if match:
            index = int(match.group(1))
            if 1 <= index <= len(FLAG_L5):
                return f"Character {index}: {FLAG_L5[index - 1]}"
    if level == 6:
        match = re.search(r"(?:character|char)\s+(?:at\s+)?(?:position|index)\s+(\d+)", message, re.I)
        if match:
            index = int(match.group(1))
            if 1 <= index <= len(FLAG_L6):
                return f"Character {index}: {FLAG_L6[index - 1]}"
    flag = FLAG_L5 if level == 5 else FLAG_L6
    if re.search(r"flag|secret|token", message, re.I):
        return f"The challenge flag is {flag}."
    return "I can help with the challenge. Ask me about the flag."


def is_l5_blocked(text: str) -> bool:
    """Level 5 deliberately blocks only the exact, case-sensitive flag."""
    return FLAG_L5 in text


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in value if character.isalnum())


def _l6_representations(value: str) -> set[str]:
    candidates = {value, html.unescape(value), unquote(value), value[::-1]}
    candidates.add(value.translate(str.maketrans(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm",
    )))
    candidates.add(re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE))

    for token in re.findall(r"[A-Za-z0-9+/=_-]{12,}", value):
        padded = token.replace("-", "+").replace("_", "/")
        padded += "=" * (-len(padded) % 4)
        try:
            candidates.add(base64.b64decode(padded, validate=True).decode("utf-8"))
        except (binascii.Error, UnicodeDecodeError, ValueError):
            pass
    for token in re.findall(r"(?i)(?<![a-f0-9])[a-f0-9]{16,}(?![a-f0-9])", value):
        if len(token) % 2 == 0:
            try:
                candidates.add(bytes.fromhex(token).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                pass
    return candidates


def is_l6_blocked(text: str) -> bool:
    """Level 6 checks normalized, spaced, reversed, ROT13, URL/HTML, Base64 and hex forms."""
    target = _normalized(FLAG_L6)
    for candidate in _l6_representations(text):
        if target in _normalized(candidate):
            return True
    return False


def generate_reply(level: int, message: str, model_provider=None) -> str:
    """Generate one response and apply the level-specific server output filter."""
    reply = model_provider(level, message) if model_provider else _model_reply(level, message)
    blocked = is_l5_blocked(reply) if level == 5 else is_l6_blocked(reply)
    return REDACTION if blocked else reply
