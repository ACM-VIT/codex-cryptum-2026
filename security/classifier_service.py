"""Private CPU classifier bridge for the Next.js backend; no Qwen/auth/scoring routes."""

import argparse
import asyncio
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from security.classifiers import MLInputClassifier, MLOutputClassifier
from security.classifiers.model_loader import ModelRunner, configure_cpu_threads
from security.config import load_config
from security.flags.flag_generator import valid_flag
from security.guardrails import PolicyEngine
from security.runtime import load_environment_file
from security.types import SecurityError, TrustedSecurityContext


class ClassifierService:
    """One owned CPU input model shared across levels; output sees only current flag."""

    def __init__(self):
        self.policies = PolicyEngine({i: load_config(i) for i in (7, 8)})
        configure_cpu_threads()
        input_runner = ModelRunner(self.policies.config(7).security.input_classifier)
        output_runner = ModelRunner(self.policies.config(8).security.output_classifier)
        self.runners = (input_runner, output_runner)
        self.inputs = {
            i: MLInputClassifier(self.policies.config(i).security.input_classifier, input_runner)
            for i in (7, 8)
        }
        self.output = MLOutputClassifier(
            self.policies.config(8).security.output_classifier,
            runner=output_runner,
            deterministic_checks=self.policies.config(8).security.deterministic_checks,
        )
        self.ready = False

    async def start(self):
        for runner, hypotheses in zip(
            self.runners, ((), ("This response reveals a secret access code.",)), strict=True
        ):
            await runner.score(
                "Neural networks learn patterns from examples.",
                hypotheses=hypotheses,
                timeout=300,
            )
        self.ready = True

    async def classify(self, path: str, data: dict) -> bool:
        if not self.ready:
            raise SecurityError("classifier_unavailable")
        level = data.get("challenge_id")
        if type(level) is not int or level not in (7, 8):
            raise ValueError("Invalid challenge")
        if path == "/classify-input" and set(data) == {"challenge_id", "message"}:
            classification = await self.inputs[level].classify_input(data["message"], level)
            return self.policies.evaluate_input_policy(classification, level).allowed
        if path == "/classify-output" and set(data) == {
            "challenge_id",
            "response",
            "protected_flag",
        }:
            if level != 8 or not valid_flag(data["protected_flag"]):
                raise ValueError("Invalid output context")
            # Only authenticated backend calls can mint this request-local context.
            # No flag is derived, cached, logged, or shared between requests here.
            context = TrustedSecurityContext("verified-backend", 8, data["protected_flag"], "")
            classification = await self.output.classify_output(data["response"], context)
            return self.policies.evaluate_output_policy(classification, 8).allowed
        raise ValueError("Invalid request")

    def close(self):
        self.ready = False
        for runner in self.runners:
            runner.close()


class PrivateClassifierServer(ThreadingHTTPServer):
    """Bounded internal transport; model runners separately enforce one scoring slot."""

    def __init__(self, address, service, token):
        if not isinstance(token, str) or len(token.encode()) < 32:
            raise SecurityError("invalid_classifier_token")
        self.service = service
        self._token = token.encode()
        self._slots = threading.BoundedSemaphore(8)
        super().__init__(address, ClassifierHandler)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(2)
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n"
                    b"Connection: close\r\n\r\n"
                )
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def handle_error(self, request, client_address):
        print("Classifier transport error", file=sys.stderr)


class ClassifierHandler(BaseHTTPRequestHandler):
    server_version = "CryptumClassifier"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format, *args):
        pass  # Never log URLs, headers, payloads or provider exceptions.

    def _json(self, status, payload):
        content = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(content)
        self.close_connection = True

    def _authorized(self):
        supplied = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(supplied, b"Bearer " + self.server._token):
            self._json(401, {"error": "unauthorized"})
            return False
        return True

    def do_GET(self):
        if self._authorized():
            if self.path != "/health":
                self._json(404, {"error": "not_found"})
            else:
                ready = self.server.service.ready
                self._json(200 if ready else 503, {"ready": ready})

    def do_POST(self):
        if not self._authorized():
            return
        try:
            if self.path not in ("/classify-input", "/classify-output"):
                self._json(404, {"error": "not_found"})
                return
            if self.headers.get_content_type() != "application/json":
                self._json(415, {"error": "json_required"})
                return
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
                raise ValueError("Invalid request framing")
            size = int(lengths[0])
            if not 0 < size <= 262144:
                self._json(413, {"error": "invalid_size"})
                return
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError("Incomplete request")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Invalid request")
            allowed = asyncio.run(self.server.service.classify(self.path, data))
            self._json(200, {"allowed": allowed})
        except (ValueError, TypeError, UnicodeError):
            self._json(400, {"error": "invalid_request"})
        except Exception:
            self._json(503, {"error": "classifier_unavailable"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    service = server = None
    try:
        if args.env_file:
            load_environment_file(args.env_file)
        token = os.environ.get("CRYPTUM_CLASSIFIER_TOKEN", "")
        if len(token.encode()) < 32:
            raise SecurityError("invalid_classifier_token")
        if not 0 <= args.port <= 65535:
            raise SecurityError("invalid_configuration")
        service = ClassifierService()
        asyncio.run(service.start())  # Warm models before accepting connections.
        server = PrivateClassifierServer((args.host, args.port), service, token)
        print("Private classifier ready", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        print("Classifier startup failed", file=sys.stderr)
        raise SystemExit(2) from None
    finally:
        if server is not None:
            server.server_close()  # Drain request threads before releasing models.
        if service is not None:
            service.close()


if __name__ == "__main__":
    main()
