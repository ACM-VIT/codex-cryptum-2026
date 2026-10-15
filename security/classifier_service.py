"""Private CPU classifier bridge for the Next.js backend; no Qwen/auth/scoring routes."""

import argparse
import asyncio
import hmac
import json
import logging
import math
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

from security.classifiers import MLInputClassifier, MLOutputClassifier
from security.classifiers.model_loader import ModelRunner, configure_cpu_threads
from security.config import load_config
from security.diagnostics import error_code, record
from security.flags.flag_generator import valid_flag
from security.guardrails import PolicyEngine
from security.runtime import load_environment_file
from security.types import SecurityError, TrustedSecurityContext


def validate_token(token):
    if (
        not isinstance(token, str)
        or not 32 <= len(token) <= 4096
        or any(not 33 <= ord(char) <= 126 for char in token)
    ):
        raise SecurityError("invalid_classifier_token")


def queue_timeout():
    try:
        value = float(os.environ.get("CRYPTUM_CLASSIFIER_QUEUE_TIMEOUT_SECONDS", "5"))
        if not math.isfinite(value) or not 0 <= value <= 30:
            raise ValueError
        return value
    except (ValueError, TypeError):
        raise SecurityError("invalid_configuration") from None


def check_service(token, base_url):
    validate_token(token)
    try:
        url = httpx.URL(base_url)
        if (
            url.username
            or url.password
            or url.query
            or url.fragment
            or not url.host
            or not (
                url.scheme == "https"
                or (url.scheme == "http" and url.host in ("127.0.0.1", "localhost", "::1"))
            )
        ):
            raise SecurityError("invalid_configuration")
        with httpx.stream(
            "GET",
            base_url.rstrip("/") + "/health",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
            follow_redirects=False,
        ) as response:
            if response.status_code == 401:
                raise SecurityError("classifier_authentication_failed")
            if response.status_code == 503:
                raise SecurityError("classifier_not_ready")
            if response.status_code != 200:
                raise SecurityError("classifier_invalid_response")
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 2048:
                    raise SecurityError("classifier_invalid_response")
            data = json.loads(content)
            if (
                not isinstance(data, dict)
                or set(data) != {"ready"}
                or type(data["ready"]) is not bool
            ):
                raise SecurityError("classifier_invalid_response")
            if not data["ready"]:
                raise SecurityError("classifier_not_ready")
    except SecurityError:
        raise
    except (ValueError, TypeError, httpx.InvalidURL):
        raise SecurityError("classifier_invalid_response") from None
    except httpx.HTTPError:
        raise SecurityError("classifier_unreachable") from None


class ClassifierService:
    """One owned CPU input model shared across levels; output sees only current flag."""

    def __init__(self):
        self.ready = False
        self.policies = PolicyEngine(
            {i: load_config(i, resolve_inference_model=False) for i in (7, 8)}
        )
        rules = [self.policies.config(i).security.input_classifier for i in (7, 8)]
        if (rules[0].model_id, rules[0].revision) != (rules[1].model_id, rules[1].revision):
            raise SecurityError("invalid_classifier_configuration")
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
        for stage, runner, hypotheses in zip(
            ("input", "output"),
            self.runners,
            ((), ("This response reveals a secret access code.",)),
            strict=True,
        ):
            started = time.perf_counter()
            record("model_loading", stage=stage)
            try:
                await runner.score(
                    "Neural networks learn patterns from examples.",
                    hypotheses=hypotheses,
                    timeout=300,
                )
            except Exception as error:
                record("model_load_failed", stage=stage, code=error_code(error))
                raise SecurityError(error_code(error)) from None
            record("model_ready", stage=stage, elapsed_ms=(time.perf_counter() - started) * 1000)
        self.ready = True

    def healthy(self):
        return self.ready and all(runner.state == "ready" for runner in self.runners)

    def validate_request(self, path: str, data: object):
        if not isinstance(data, dict):
            raise ValueError("Invalid request")
        level = data.get("challenge_id")
        if type(level) is not int or level not in (7, 8):
            raise ValueError("Invalid challenge")
        if path == "/classify-input" and set(data) == {"challenge_id", "message"}:
            stage, text, limit = (
                "input",
                data["message"],
                self.policies.config(level).max_input_chars,
            )
        elif path == "/classify-output" and set(data) == {
            "challenge_id",
            "response",
            "protected_flag",
        }:
            if level != 8 or not valid_flag(data["protected_flag"]):
                raise ValueError("Invalid output context")
            stage, text, limit = (
                "output",
                data["response"],
                self.policies.config(level).max_output_chars,
            )
        else:
            raise ValueError("Invalid request")
        if not isinstance(text, str) or not text.strip() or "\x00" in text or len(text) > limit:
            raise ValueError("Invalid text")
        return level, stage

    async def classify(self, path: str, data: dict, *, timeout_seconds=None) -> bool:
        level, stage = self.validate_request(path, data)
        if not self.ready:
            raise SecurityError("classifier_unavailable")
        rule = getattr(self.policies.config(level).security, stage + "_classifier")
        budget = rule.timeout_seconds
        if timeout_seconds is not None:
            if (
                type(timeout_seconds) not in (int, float)
                or not math.isfinite(timeout_seconds)
                or timeout_seconds <= 0
            ):
                raise ValueError("Invalid timeout")
            budget = min(budget, timeout_seconds)
        started = time.perf_counter()
        try:
            async with asyncio.timeout(budget):
                if stage == "input":
                    classification = await self.inputs[level].classify_input(data["message"], level)
                    decision = self.policies.evaluate_input_policy(classification, level)
                else:
                    decision = await self._classify_output(data)
        except Exception as error:
            record(
                "inference_failed",
                stage=stage,
                challenge_id=level,
                outcome="fail_closed",
                code=error_code(error),
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )
            raise SecurityError(error_code(error)) from None
        if rule.event_logging:
            record(
                "classification",
                stage=stage,
                challenge_id=level,
                outcome=decision.action.value,
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )
        return decision.allowed

    async def _classify_output(self, data):
        # Only authenticated backend calls can mint this request-local context.
        # No flag is derived, cached, logged, or shared between requests here.
        context = TrustedSecurityContext("verified-backend", 8, data["protected_flag"], "")
        classification = await self.output.classify_output(data["response"], context)
        return self.policies.evaluate_output_policy(classification, 8)

    def close(self):
        self.ready = False
        for runner in self.runners:
            runner.close()


class PrivateClassifierServer(ThreadingHTTPServer):
    """Bounded internal transport; model runners separately enforce one scoring slot."""

    def __init__(self, address, service, token):
        validate_token(token)
        self.queue_timeout = queue_timeout()
        self.service = service
        self._token = token.encode()
        self._slots = threading.BoundedSemaphore(8)
        self._inference_slots = {stage: threading.Lock() for stage in ("input", "output")}
        super().__init__(address, ClassifierHandler)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            record("transport_busy", stage="transport", code="classifier_busy")
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
        record("transport_failed", stage="transport", code="classifier_unavailable")


class ClassifierHandler(BaseHTTPRequestHandler):
    server_version = "CryptumClassifier"
    sys_version = ""
    max_body_bytes = 262144
    max_rejected_body_drain_bytes = 1048576

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

    def _drain_rejected_body(self):
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
            return
        try:
            remaining = int(lengths[0])
        except ValueError:
            return
        if not 0 < remaining <= self.max_rejected_body_drain_bytes:
            return
        while remaining:
            discarded = self.rfile.read(min(65536, remaining))
            if not discarded:
                break
            remaining -= len(discarded)

    def _authorized(self):
        supplied = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(supplied, b"Bearer " + self.server._token):
            record(
                "authentication_failed", stage="transport", code="classifier_authentication_failed"
            )
            self._json(401, {"error": "unauthorized"})
            self._drain_rejected_body()
            return False
        return True

    def do_GET(self):
        if self._authorized():
            if self.path != "/health":
                self._json(404, {"error": "not_found"})
            else:
                ready = self.server.service.healthy()
                self._json(200 if ready else 503, {"ready": ready})

    def do_POST(self):
        if not self._authorized():
            return
        try:
            if self.path not in ("/classify-input", "/classify-output"):
                self._json(404, {"error": "not_found"})
                self._drain_rejected_body()
                return
            if self.headers.get_content_type() != "application/json":
                self._json(415, {"error": "json_required"})
                self._drain_rejected_body()
                return
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
                raise ValueError("Invalid request framing")
            size = int(lengths[0])
            if not 0 < size <= self.max_body_bytes:
                self._json(413, {"error": "invalid_size"})
                # Leave modest rejected uploads readable until the client has
                # finished sending, or closing with unread bytes can reset the
                # connection before it receives the 413 response (notably on
                # Windows). Large uploads are rejected without draining.
                self._drain_rejected_body()
                return
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError("Incomplete request")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Invalid request")
            level, stage = self.server.service.validate_request(self.path, data)
            rule = getattr(
                self.server.service.policies.config(level).security, stage + "_classifier"
            )
            deadline = time.monotonic() + rule.timeout_seconds
            gate = self.server._inference_slots[stage]
            if not gate.acquire(timeout=min(self.server.queue_timeout, rule.timeout_seconds)):
                raise SecurityError("classifier_busy")
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise SecurityError("classifier_timeout")
                allowed = asyncio.run(
                    self.server.service.classify(
                        self.path,
                        data,
                        timeout_seconds=remaining,
                    )
                )
            finally:
                gate.release()
            self._json(200, {"allowed": allowed})
        except (ValueError, TypeError, UnicodeError):
            self._json(400, {"error": "invalid_request"})
        except Exception as error:
            record("request_failed", stage="transport", code=error_code(error))
            self._json(503, {"error": "classifier_unavailable"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument(
        "--check", action="store_true", help="Check authenticated readiness without loading models"
    )
    parser.add_argument("--log-level", choices=("INFO", "WARNING", "ERROR"), default="INFO")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    logging.getLogger("cryptum.classifiers").setLevel(args.log_level)
    service = server = None
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        if args.env_file:
            load_environment_file(args.env_file)
        token = os.environ.get("CRYPTUM_CLASSIFIER_TOKEN", "")
        validate_token(token)
        queue_timeout()
        if not 0 <= args.port <= 65535:
            raise SecurityError("invalid_configuration")
        if args.check:
            check_service(token, os.environ.get("CRYPTUM_CLASSIFIER_URL", "http://127.0.0.1:8091"))
            print("Classifier health check passed")
            return
        service = ClassifierService()
        asyncio.run(service.start())  # Warm models before accepting connections.
        server = PrivateClassifierServer((args.host, args.port), service, token)
        record("startup_ready", outcome="ready", port=server.server_port)
        print("Private classifier ready", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        record("startup_failed", code=error_code(error))
        print(f"Classifier startup failed: {error_code(error)}", file=sys.stderr)
        raise SystemExit(2) from None
    finally:
        if server is not None:
            server.server_close()  # Drain request threads before releasing models.
        if service is not None:
            service.close()
        record("shutdown", outcome="closed")
        signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    main()
