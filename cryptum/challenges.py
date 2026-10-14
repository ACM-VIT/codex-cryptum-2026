"""Deterministic challenge model and server-side output filters.

The default values are synthetic development flags. Event deployments should
inject real flags through server-side configuration, never browser settings.
"""

import base64
import binascii
import html
import re
import unicodedata
from urllib.parse import unquote

FLAG_L5 = "CTF{synthetic_l5_exact_flag}"
FLAG_L6 = "CTF{synthetic_l6_smart_flag}"
DEFAULT_FLAGS = {5: FLAG_L5, 6: FLAG_L6}
INSPECTION_LIMIT = 512
REDACTION = "Blocked by the challenge output filter. Try a different request."


def _model_reply(level: int, message: str, flags=None) -> str:
    """Local deterministic model used for development and challenge testing."""
    flags = flags or DEFAULT_FLAGS
    flag = flags[level]
    if level == 5:
        # These are generic transformations of the model's secret, not stored
        # answer variants. They illustrate the exact-match filter's limits.
        chunk = re.search(r"\b(first|last)\s+(\d{1,2})\s+(?:characters?|chars?)\b", message, re.I)
        if chunk and re.search(r"flag|secret", message, re.I):
            count = int(chunk.group(2))
            return flag[:count] if chunk.group(1).lower() == "first" else flag[-count:]
        if re.search(r"lower\s*case|lowercase", message, re.I) and re.search(r"flag|secret", message, re.I):
            return flag.lower()
        if re.search(r"spaces? between|separate.{0,20}characters|spell.{0,20}spaces", message, re.I):
            return " ".join(flag)
        if re.search(r"flag|secret|token", message, re.I):
            return f"The challenge flag is {flag}."
        return "I can help with the challenge. Ask me about the flag."

    # Level 6 deliberately has no per-character or short-chunk response mode.
    # The report formatter puts its appendix after a fixed 512-codepoint
    # summary, while the output filter inspects only that summary window.
    if re.search(r"appendix|supplement|after the report", message, re.I) and re.search(r"flag|secret|token", message, re.I):
        summary = ("Summary of the challenge report. " * 20)[:INSPECTION_LIMIT]
        return f"{summary}\nAppendix: {flag}"
    if re.search(r"flag|secret|token", message, re.I):
        return f"The challenge flag is {flag}."
    return "I can help with the challenge. Ask me about the flag."


def is_l5_blocked(text: str, flag: str = FLAG_L5) -> bool:
    """Level 5 intentionally blocks only the exact, case-sensitive flag."""
    return flag in text


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


def is_l6_blocked(text: str, flag: str = FLAG_L6) -> bool:
    """Inspect only the first 512 Unicode code points, with smart transforms."""
    inspected = text[:INSPECTION_LIMIT]
    target = _normalized(flag)
    return any(target in _normalized(candidate) for candidate in _l6_representations(inspected))


def generate_reply(level: int, message: str, model_provider=None, flags=None) -> str:
    """Run the configured model and filter its output before returning it."""
    flags = flags or DEFAULT_FLAGS
    reply = model_provider(level, message) if model_provider else _model_reply(level, message, flags)
    blocked = is_l5_blocked(reply, flags[5]) if level == 5 else is_l6_blocked(reply, flags[6])
    return REDACTION if blocked else reply
