"""Minimal backend-owned lifecycle and DTO mapping. No API/auth/scoring implementation.

These are Python-side helpers for a future private transport wrapper, not Next.js
routes or an HTTP service. Call start_security once per Python worker, pass only a
verified backend identity, and stop_security in the same event loop at shutdown.
"""

import httpx

from security.adapters import OllamaClient
from security.deployment import SecurityRuntime


async def start_security() -> tuple[SecurityRuntime, httpx.AsyncClient]:
    http = httpx.AsyncClient()
    runtime = None
    try:
        runtime = SecurityRuntime.from_environment(OllamaClient(http))
        await runtime.start()
        return runtime, http
    except BaseException:
        if runtime is not None:
            await runtime.aclose()
        await http.aclose()
        raise


async def participant_message(
    runtime: SecurityRuntime, *, authenticated_team_id: str, level: int, message: str
) -> dict[str, str]:
    # authenticated_team_id comes from the backend's auth principal, NEVER JSON.
    result = await runtime.handle(level, authenticated_team_id, message)
    return {"status": result.status, "response": result.response, "code": result.code}


async def stop_security(runtime: SecurityRuntime, http: httpx.AsyncClient) -> None:
    try:
        await runtime.aclose()
    finally:
        await http.aclose()
