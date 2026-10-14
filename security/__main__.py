"""Portable local demonstration: python -m security [--ollama] [--env-file PATH]."""

from security.examples.demo import main
from security.runtime import run_cli

if __name__ == "__main__":
    run_cli(main)
