import base64
import binascii
import codecs
import re
import unicodedata

LEET = str.maketrans({"4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "7": "t", "5": "s", "$": "s", "8": "b", "9": "g"})

BLOCKED_INPUT = [
    "flag",
    "cdx",
    "secret",
    "password",
    "passphrase",
    "systemprompt",
    "yourinstructions",
    "previousinstructions",
    "ignoreall",
    "ignoreprevious",
    "developermode",
    "base64",
    "rot13",
]


def fold(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower().translate(LEET)


def squash(text):
    return re.sub(r"[^a-z0-9]", "", fold(text))


def input_blocked(message):
    flat = squash(message)
    return any(word in flat for word in BLOCKED_INPUT)


def flag_core(flag):
    inner = flag[flag.index("{") + 1 : flag.rindex("}")] if "{" in flag else flag
    return squash(inner)


def decoded_views(text):
    views = [text]
    for token in re.findall(r"[A-Za-z0-9+/=_-]{8,}", text):
        padded = token + "=" * (-len(token) % 4)
        for decoder in (base64.b64decode, base64.urlsafe_b64decode):
            try:
                views.append(decoder(padded).decode("utf-8", "ignore"))
            except (binascii.Error, ValueError):
                pass
    for token in re.findall(r"(?:[0-9a-fA-F]{2}[\s:,-]?){4,}", text):
        try:
            views.append(bytes.fromhex(re.sub(r"[^0-9a-fA-F]", "", token)).decode("utf-8", "ignore"))
        except ValueError:
            pass
    codes = re.findall(r"\b(\d{2,3})\b", text)
    if len(codes) >= 4:
        views.append("".join(chr(int(c)) for c in codes if 32 <= int(c) < 127))
    bits = re.findall(r"\b[01]{8}\b", text)
    if len(bits) >= 4:
        views.append("".join(chr(int(b, 2)) for b in bits))
    views.append(codecs.decode(text, "rot13"))
    return views


def output_leaks(text, flag):
    core = flag_core(flag)
    if not core:
        return False
    if flag.lower() in text.lower():
        return True
    for view in decoded_views(text):
        flat = squash(view)
        if core in flat or core[::-1] in flat:
            return True
        initials = squash("".join(word[:1] for word in re.findall(r"\S+", view)))
        if core in initials:
            return True
        line_initials = squash("".join(line.strip()[:1] for line in view.splitlines() if line.strip()))
        if core in line_initials:
            return True
    return False
