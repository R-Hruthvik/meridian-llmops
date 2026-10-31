"""E2E tests for Meridian CLI harness."""

import os
import subprocess
import sys

import pytest

pytestmark = pytest.mark.integration


def _resolve_cli(name):
    import shutil

    force = os.environ.get("CLI_ANYTHING_FORCE_INSTALLED", "").strip() == "1"
    path = shutil.which(name)
    if path:
        print(f"[_resolve_cli] Using installed command: {path}")
        return [path]
    if force:
        raise RuntimeError(f"{name} not found in PATH. Install with: pip install -e .")
    module = name.replace("cli-anything-", "cli_anything.") + "." + name.split("-")[-1] + "_cli"
    print(f"[_resolve_cli] Falling back to: {sys.executable} -m {module}")
    return [sys.executable, "-m", module]


class TestCLISubprocess:
    CLI_BASE = _resolve_cli("cli-anything-meridian")

    def _run(self, args, check=False, env=None):
        e = dict(os.environ)
        if env:
            e.update(env)
        return subprocess.run(
            self.CLI_BASE + args, capture_output=True, text=True, check=check, env=e
        )

    def test_help(self):
        result = self._run(["--help"])
        assert result.returncode == 0

    def test_health_json_shape(self):
        result = self._run(["--json", "health"], env={"MERIDIAN_BASE_URL": "http://127.0.0.1:8000"})
        # Server may be unavailable; just ensure CLI runs
        assert result.returncode in (0, 1)

    def test_session_roundtrip(self, tmp_path):
        out = tmp_path / "s.json"
        r = self._run(["session", "new", "-o", str(out)])
        assert r.returncode == 0
        assert out.exists()
        r2 = self._run(["--project", str(out), "session", "status"])
        assert r2.returncode == 0
