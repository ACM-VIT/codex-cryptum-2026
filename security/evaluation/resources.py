"""Optional resource measurements; unavailable instruments return None."""

import platform
import shutil
import subprocess


def resource_snapshot() -> dict:
    rss_bytes = None
    try:
        import psutil

        rss_bytes = psutil.Process().memory_info().rss
    except Exception:
        # Optional measurements must not break validation on restricted hosts.
        pass
    peak_bytes = None
    try:
        import resource

        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        system = platform.system()
        if system == "Darwin":
            peak_bytes = int(raw)  # macOS reports bytes.
        elif system == "Linux":
            peak_bytes = int(raw) * 1024  # Linux reports KiB.
    except Exception:
        pass
    gpu = None
    executable = shutil.which("nvidia-smi")
    if executable is not None:
        try:
            process = subprocess.run(
                [
                    executable,
                    "--query-gpu=name,memory.total,memory.used",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
            name, total, used = process.stdout.strip().split(",")
            gpu = {"name": name.strip(), "total_mib": int(total), "used_mib": int(used)}
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    return {"rss_bytes": rss_bytes, "process_max_rss_bytes": peak_bytes, "gpu_global_sample": gpu}
