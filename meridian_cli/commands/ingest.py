"""Ingest command (delegates to existing script)."""

import subprocess
import sys
from pathlib import Path

import typer

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def ingest(
    ctx: typer.Context,
    path: Path = typer.Argument(..., help="File or directory to ingest"),
    recursive: bool = typer.Option(False, "--recursive", "-r", help="Recurse into subdirectories"),
) -> None:
    script = PROJECT_ROOT / "scripts" / "ingest_folder.py"
    cmd = [sys.executable, str(script), str(path)]
    if recursive:
        cmd.append("--recursive")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), check=False)
    raise typer.Exit(result.returncode)
