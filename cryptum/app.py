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

from .challenges import FLAG_L5, FLAG_L6, generate_reply

SEED_TEAMS = (
    ("team-aurora", "Team Aurora", 120),
    ("team-borealis", "Team Borealis", 90),
    ("team-cipher", "Team Cipher", 65),
)

# Integration seam: production should supply this data from the authoritative
# competition scoring service. Challenge writes never call this provider.
DEFAULT_COMPETITION_ENTRIES = (
    {"team_id": "team-aurora", "display_name": "Team Aurora", "score": 120},
    {"team_id": "team-borealis", "display_name": "Team Borealis", "score": 90},
    {"team_id": "team-cipher", "display_name": "Team Cipher", "score": 65},
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
        count = connection.execute("SELECT COUNT(*) FROM challenge_teams").fetchone()[0]
        if count == 0:
            connection.executemany("INSERT INTO challenge_teams VALUES (?, ?, ?)", SEED_TEAMS)


def create_server(host="127.0.0.1", port=8000, database_path=None, *, tokens=None,
                  organizer_token=None, competition_entries=None, model_provider=None):
    database_path = database_path or os.environ.get("CRYPTUM_CHALLENGE_DB", "challenge.sqlite3")
    tokens = tokens if tokens is not None else json.loads(os.environ.get("CRYPTUM_PARTICIPANT_TOKENS", "{}"))
    organizer_token = organizer_token if organizer_token is not None else os.environ.get("CRYPTUM_ORGANIZER_TOKEN")
    competition_entries = competition_entries or DEFAULT_COMPETITION_ENTRIES
    _initialize_database(database_path)

    class Handler(BaseHTTPRequestHandler):
        server_version = "CodexCryptum/1.0"

        def log_message(self, format, *args):
            # Do not log bodies, authorization headers, or model responses.
            super().log_message(format, *args)

        def _send(self, status, payload):
            encoded = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(encoded)

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
                self._send(200, {"entries": entries, "scope": "challenge-sandbox"})
                return
            if path == "/api/competition/leaderboard":
                entries = sorted(competition_entries, key=lambda row: (-row["score"], row["team_id"]))
                self._send(200, {"entries": [dict(row, rank=rank) for rank, row in enumerate(entries, 1)], "scope": "authoritative-read-only"})
                return
            self._send(404, {"error": "not_found"})

        def do_PATCH(self):
            match = re.fullmatch(r"/api/challenge/leaderboard/teams/([a-zA-Z0-9_-]{1,64})", urlparse(self.path).path)
            if not match:
                self._send(404, {"error": "not_found"})
                return
            if self._auth() is None:
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
                connection.execute(
                    "UPDATE challenge_teams SET score = ?, display_name = ? WHERE team_id = ?",
                    (score if score is not None else current["score"],
                     display_name if display_name is not None else current["display_name"], match.group(1)),
                )
                updated = connection.execute("SELECT team_id, display_name, score FROM challenge_teams WHERE team_id = ?", (match.group(1),)).fetchone()
            self._send(200, {"entry": dict(updated), "scope": "challenge-sandbox"})

        def do_POST(self):
            path = urlparse(self.path).path
            if path == "/api/challenge/leaderboard/reset":
                if not organizer_token or not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {organizer_token}"):
                    self._send(401, {"error": "organizer_authentication_required"})
                    return
                with self._database() as connection:
                    connection.execute("DELETE FROM challenge_awards")
                    connection.execute("DELETE FROM challenge_teams")
                    connection.executemany("INSERT INTO challenge_teams VALUES (?, ?, ?)", SEED_TEAMS)
                self._send(200, {"reset": True, "scope": "challenge-sandbox"})
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
                    self._send(200, {"reply": generate_reply(level, message, model_provider), "challenge": f"level-{level}"})
                    return

                submitted = body.get("flag")
                if not isinstance(submitted, str) or len(submitted) > 200:
                    self._send(400, {"error": "invalid_flag"})
                    return
                expected = FLAG_L5 if level == 5 else FLAG_L6
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
