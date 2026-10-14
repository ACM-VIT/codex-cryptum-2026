"""HTTP API for isolated Codex Cryptum challenge state."""

import hmac
import json
import os
import re
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .challenges import DEFAULT_FLAGS, generate_reply, is_l5_blocked, is_l6_blocked

SEED_TEAMS = (
    ("team-aurora", "Aurora Labs", 4200),
    ("team-borealis", "Borealis Security", 3300),
    ("team-cipher", "Cipher Collective", 2700),
    ("team-ember", "Ember Research", 1900),
)

# Integration seam: production should supply this data from the authoritative
# competition scoring service. Challenge writes never call this provider.
DEFAULT_COMPETITION_ENTRIES = (
    {"team_id": "competition-aurora", "display_name": "Aurora Labs", "score": 8100},
    {"team_id": "competition-borealis", "display_name": "Borealis Security", "score": 7350},
    {"team_id": "competition-cipher", "display_name": "Cipher Collective", "score": 6200},
)


@contextmanager
def closing_connection(path):
    connection = sqlite3.connect(path)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _initialize_database(path: str) -> None:
    with closing_connection(path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("""CREATE TABLE IF NOT EXISTS challenge_teams (
            team_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, score INTEGER NOT NULL
        )""")
        connection.execute("""CREATE TABLE IF NOT EXISTS challenge_awards (
            team_id TEXT NOT NULL, challenge_id TEXT NOT NULL, points INTEGER NOT NULL,
            PRIMARY KEY (team_id, challenge_id)
        )""")
        connection.execute("""CREATE TABLE IF NOT EXISTS leaderboard_exploit_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_team_id TEXT NOT NULL,
            target_team_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        connection.execute("""CREATE TABLE IF NOT EXISTS leaderboard_completions (
            team_id TEXT PRIMARY KEY, points INTEGER NOT NULL
        )""")
        count = connection.execute("SELECT COUNT(*) FROM challenge_teams").fetchone()[0]
        if count == 0:
            connection.executemany("INSERT INTO challenge_teams VALUES (?, ?, ?)", SEED_TEAMS)


def _public_text(value: str, flags: dict) -> str:
    inspected = value[:512]
    if is_l6_blocked(inspected, flags[5]) or is_l6_blocked(inspected, flags[6]):
        return "Sensitive value hidden"
    return value[:80]


def create_server(host="127.0.0.1", port=8000, database_path=None, *, tokens=None,
                  organizer_token=None, competition_entries=None, model_provider=None, flags=None):
    database_path = database_path or os.environ.get("CRYPTUM_CHALLENGE_DB", "challenge.sqlite3")
    tokens = tokens if tokens is not None else json.loads(os.environ.get("CRYPTUM_PARTICIPANT_TOKENS", "{}"))
    organizer_token = organizer_token if organizer_token is not None else os.environ.get("CRYPTUM_ORGANIZER_TOKEN")
    competition_entries = DEFAULT_COMPETITION_ENTRIES if competition_entries is None else competition_entries
    flags = DEFAULT_FLAGS if flags is None else flags
    if not isinstance(flags, dict) or any(
        level not in flags or not isinstance(flags[level], str) or not flags[level] or not flags[level].isascii()
        for level in (5, 6)
    ):
        raise ValueError("challenge flag configuration is invalid")
    _initialize_database(database_path)
    if not isinstance(tokens, dict) or any(
        not isinstance(token, str) or len(token) < 16 or not token.isascii() or not isinstance(team_id, str)
        for token, team_id in tokens.items()
    ):
        raise ValueError("participant token configuration is invalid")
    if organizer_token is not None and (
        not isinstance(organizer_token, str) or len(organizer_token) < 16 or not organizer_token.isascii()
    ):
        raise ValueError("organizer token must contain at least 16 characters")
    if organizer_token is not None and organizer_token in tokens:
        raise ValueError("organizer and participant tokens must be different")
    with closing_connection(database_path) as connection:
        known_teams = {row[0] for row in connection.execute("SELECT team_id FROM challenge_teams")}
    if any(team_id not in known_teams for team_id in tokens.values()):
        raise ValueError("participant tokens must map to configured sandbox teams")

    class Handler(BaseHTTPRequestHandler):
        server_version = "CodexCryptum/1.0"

        def log_message(self, format, *args):
            # Request targets can contain user-supplied secrets; suppress access logs.
            return

        def _send(self, status, payload):
            encoded = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(encoded)

        def send_error(self, code, message=None, explain=None):
            self._send(code, {"error": "http_error"})

        def _body(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return None
            if length <= 0 or length > 4096:
                return None
            try:
                data = json.loads(self.rfile.read(length))
                return data if isinstance(data, dict) else None
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None

        def _auth(self):
            header = self.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return None
            token = header[7:]
            if not token.isascii():
                return None
            for known, team_id in tokens.items():
                if hmac.compare_digest(token, known):
                    return team_id
            return None

        @contextmanager
        def _database(self):
            connection = sqlite3.connect(database_path, timeout=5)
            connection.row_factory = sqlite3.Row
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

        def _entries(self, rows):
            return [dict(row) for row in rows]

        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/leaderboard.js"):
                asset = Path(__file__).parent.parent / "web" / ("index.html" if path == "/" else "leaderboard.js")
                if not asset.is_file():
                    self._send(404, {"error": "not_found"})
                    return
                content_type = "text/html; charset=utf-8" if path == "/" else "text/javascript; charset=utf-8"
                body = asset.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
                )
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/challenge/leaderboard":
                with self._database() as connection:
                    rows = connection.execute(
                        "SELECT team_id, display_name, score FROM challenge_teams ORDER BY score DESC, team_id ASC"
                    ).fetchall()
                entries = self._entries(rows)
                for rank, entry in enumerate(entries, 1):
                    entry["rank"] = rank
                    entry["display_name"] = _public_text(entry["display_name"], flags)
                self._send(200, {
                    "entries": entries,
                    "scope": "challenge-sandbox",
                    "objective": "Reach first place in the sandbox, then verify completion.",
                })
                return
            if path == "/api/competition/leaderboard":
                try:
                    provider_entries = competition_entries() if callable(competition_entries) else competition_entries
                    safe_entries = [
                        {"team_id": row["team_id"], "display_name": row["display_name"], "score": row["score"]}
                        for row in provider_entries
                    ]
                    if any(
                        not isinstance(row["team_id"], str)
                        or not isinstance(row["display_name"], str)
                        or not isinstance(row["score"], int)
                        or isinstance(row["score"], bool)
                        for row in safe_entries
                    ):
                        raise TypeError("invalid competition entry")
                    for row in safe_entries:
                        row["team_id"] = _public_text(row["team_id"], flags)
                        row["display_name"] = _public_text(row["display_name"], flags)
                    entries = sorted(safe_entries, key=lambda row: (-row["score"], row["team_id"]))
                except Exception:
                    self._send(503, {"error": "competition_scores_unavailable"})
                    return
                self._send(200, {"entries": [dict(row, rank=rank) for rank, row in enumerate(entries, 1)], "scope": "authoritative-read-only"})
                return
            self._send(404, {"error": "not_found"})

        def do_PATCH(self):
            match = re.fullmatch(r"/api/challenge/leaderboard/teams/([a-zA-Z0-9_-]{1,64})", urlparse(self.path).path)
            if not match:
                self._send(404, {"error": "not_found"})
                return
            actor_team_id = self._auth()
            if actor_team_id is None:
                self._send(401, {"error": "authentication_required"})
                return
            body = self._body()
            if body is None or set(body) - {"score", "display_name"}:
                self._send(400, {"error": "invalid_request"})
                return
            # Intentional CTF flaw: any authenticated participant can mass-assign
            # another sandbox team's score (IDOR + broken property authorization).
            score = body.get("score")
            display_name = body.get("display_name")
            if score is not None and (not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 1_000_000):
                self._send(400, {"error": "invalid_score"})
                return
            if display_name is not None and (not isinstance(display_name, str) or not 1 <= len(display_name) <= 40):
                self._send(400, {"error": "invalid_display_name"})
                return
            with self._database() as connection:
                current = connection.execute("SELECT * FROM challenge_teams WHERE team_id = ?", (match.group(1),)).fetchone()
                if current is None:
                    self._send(404, {"error": "team_not_found"})
                    return
                previous_first = connection.execute(
                    "SELECT team_id, score FROM challenge_teams ORDER BY score DESC, team_id ASC LIMIT 1"
                ).fetchone()
                connection.execute(
                    "UPDATE challenge_teams SET score = ?, display_name = ? WHERE team_id = ?",
                    (score if score is not None else current["score"],
                     display_name if display_name is not None else current["display_name"], match.group(1)),
                )
                if (
                    score is not None
                    and actor_team_id != match.group(1)
                    and current["team_id"] != previous_first["team_id"]
                    and score != current["score"]
                    and score > previous_first["score"]
                ):
                    connection.execute(
                        "INSERT INTO leaderboard_exploit_events (actor_team_id, target_team_id) VALUES (?, ?)",
                        (actor_team_id, match.group(1)),
                    )
                updated = connection.execute("SELECT team_id, display_name, score FROM challenge_teams WHERE team_id = ?", (match.group(1),)).fetchone()
            updated_entry = dict(updated)
            updated_entry["display_name"] = _public_text(updated_entry["display_name"], flags)
            self._send(200, {"entry": updated_entry, "scope": "challenge-sandbox"})

        def do_POST(self):
            path = urlparse(self.path).path
            if path == "/api/challenge/leaderboard/reset":
                authorization = self.headers.get("Authorization", "")
                if not organizer_token or not authorization.isascii() or not hmac.compare_digest(authorization, f"Bearer {organizer_token}"):
                    self._send(401, {"error": "organizer_authentication_required"})
                    return
                with self._database() as connection:
                    connection.execute("DELETE FROM challenge_awards")
                    connection.execute("DELETE FROM leaderboard_exploit_events")
                    connection.execute("DELETE FROM leaderboard_completions")
                    connection.execute("DELETE FROM challenge_teams")
                    connection.executemany("INSERT INTO challenge_teams VALUES (?, ?, ?)", SEED_TEAMS)
                self._send(200, {"reset": True, "scope": "challenge-sandbox"})
                return

            if path == "/api/challenge/leaderboard/complete":
                actor_team_id = self._auth()
                if actor_team_id is None:
                    self._send(401, {"error": "authentication_required"})
                    return
                body = self._body()
                if body is None or body:
                    self._send(400, {"error": "invalid_request"})
                    return
                with self._database() as connection:
                    already = connection.execute(
                        "SELECT points FROM leaderboard_completions WHERE team_id = ?", (actor_team_id,)
                    ).fetchone()
                    first = connection.execute(
                        "SELECT team_id FROM challenge_teams ORDER BY score DESC, team_id ASC LIMIT 1"
                    ).fetchone()
                    event = connection.execute(
                        "SELECT target_team_id FROM leaderboard_exploit_events "
                        "WHERE actor_team_id = ? AND target_team_id != ? ORDER BY event_id DESC LIMIT 1",
                        (actor_team_id, actor_team_id),
                    ).fetchone()
                    eligible = bool(event and first and event["target_team_id"] == first["team_id"])
                    awarded = 0
                    if eligible and not already:
                        cursor = connection.execute(
                            "INSERT OR IGNORE INTO leaderboard_completions VALUES (?, 50)", (actor_team_id,)
                        )
                        if cursor.rowcount == 1:
                            connection.execute("UPDATE challenge_teams SET score = score + 50 WHERE team_id = ?", (actor_team_id,))
                            awarded = 50
                    completed = already is not None or eligible
                self._send(200, {"completed": completed, "points_awarded": awarded})
                return

            chat = re.fullmatch(r"/api/challenges/level-(5|6)/chat", path)
            verify = re.fullmatch(r"/api/challenges/level-(5|6)/verify", path)
            if chat or verify:
                team_id = self._auth()
                if team_id is None:
                    self._send(401, {"error": "authentication_required"})
                    return
                body = self._body()
                if body is None:
                    self._send(400, {"error": "invalid_request"})
                    return
                level = int((chat or verify).group(1))
                if chat:
                    message = body.get("message")
                    if not isinstance(message, str) or not 1 <= len(message) <= 1000:
                        self._send(400, {"error": "invalid_message"})
                        return
                    try:
                        reply = generate_reply(level, message, model_provider, flags)
                    except Exception:
                        self._send(502, {"error": "model_unavailable"})
                        return
                    self._send(200, {"reply": reply, "challenge": f"level-{level}"})
                    return

                submitted = body.get("flag")
                if not isinstance(submitted, str) or len(submitted) > 200:
                    self._send(400, {"error": "invalid_flag"})
                    return
                expected = flags[level]
                correct = hmac.compare_digest(submitted.strip(), expected)
                points = 100 if level == 5 else 200
                awarded = 0
                if correct:
                    with self._database() as connection:
                        cursor = connection.execute(
                            "INSERT OR IGNORE INTO challenge_awards VALUES (?, ?, ?)", (team_id, f"level-{level}", points)
                        )
                        if cursor.rowcount == 1:
                            connection.execute("UPDATE challenge_teams SET score = score + ? WHERE team_id = ?", (points, team_id))
                            awarded = points
                self._send(200, {"correct": correct, "points_awarded": awarded})
                return
            self._send(404, {"error": "not_found"})

        def do_PUT(self):
            self._send(405, {"error": "method_not_allowed"})

    return ThreadingHTTPServer((host, port), Handler)
