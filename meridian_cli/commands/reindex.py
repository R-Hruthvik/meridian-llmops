"""Reindex command (delegates to existing script)."""

import subprocess
import sys
from pathlib import Path

import typer

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def reindex(ctx: typer.Context) -> None:
    script = PROJECT_ROOT / "scripts" / "reindex.py"
    cmd = [sys.executable, str(script), "--yes"]
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), check=False)
    raise typer.Exit(result.returncode)
