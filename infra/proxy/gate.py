import argparse
import http.client
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTES = {
    ("POST", "/v1/chat/completions"),
    ("GET", "/v1/models"),
    ("GET", "/api/tags"),
}
MAX_BODY = 256 * 1024
UPSTREAM_TIMEOUT = 600


def log(client, method, path, status, started):
    print(f"{time.strftime('%H:%M:%S')} {client} {method} {path} {status} {time.time() - started:.1f}s", flush=True)


class Gate(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    allow = set()
    model = "qwen3:8b"
    upstream = ("127.0.0.1", 11434)

    def log_message(self, *args):
        pass

    def deny(self, status, message):
        body = json.dumps({"error": {"message": message}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return status

    def handle_any(self, method):
        started = time.time()
        client = self.client_address[0]
        path = self.path.split("?", 1)[0]
        status = self.forward(method, client, path)
        log(client, method, path, status, started)

    def forward(self, method, client, path):
        if client not in self.allow:
            return self.deny(403, "forbidden")
        if (method, path) not in ROUTES:
            return self.deny(404, "not found")

        body = None
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self.deny(413, "body missing or too large")
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except ValueError:
                return self.deny(400, "invalid json")
            if not isinstance(payload, dict) or payload.get("model") != self.model:
                return self.deny(400, f"model must be {self.model}")

        conn = http.client.HTTPConnection(*self.upstream, timeout=UPSTREAM_TIMEOUT)
        try:
            headers = {"Content-Type": "application/json"} if body else {}
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
        except OSError:
            conn.close()
            return self.deny(502, "model server unavailable")

        try:
            self.send_response(resp.status)
            for key in ("Content-Type", "Content-Length"):
                value = resp.getheader(key)
                if value:
                    self.send_header(key, value)
            self.end_headers()
            while True:
                chunk = resp.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except OSError:
            pass
        finally:
            conn.close()
        return resp.status

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PUT(self):
        self.handle_any("PUT")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def do_HEAD(self):
        self.handle_any("HEAD")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow", action="append", required=True, help="client IP allowed to connect; repeatable")
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--model", default="qwen3:8b")
    ap.add_argument("--upstream-port", type=int, default=11434)
    args = ap.parse_args()

    Gate.allow = set(args.allow)
    Gate.model = args.model
    Gate.upstream = ("127.0.0.1", args.upstream_port)

    server = ThreadingHTTPServer((args.bind, args.port), Gate)
    server.daemon_threads = True
    print(f"gate on {args.bind}:{args.port} -> 127.0.0.1:{args.upstream_port}, model {args.model}, allow {sorted(Gate.allow)}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
