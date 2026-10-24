"""Meridian CLI entry point."""

from __future__ import annotations

import typer

from .config import CLIConfig  # noqa: F401


class CLIState:
    def __init__(self, base_url, api_key, admin_key, json_output, quiet, timeout):
        self.base_url = base_url
        self.api_key = api_key
        self.admin_key = admin_key
        self.json_output = json_output
        self.quiet = quiet
        self.timeout = timeout


app = typer.Typer(name="meridian", help="Meridian CLI", no_args_is_help=True)
settings_app = typer.Typer(help="LLM settings commands")
models_app = typer.Typer(help="Model commands")
app.add_typer(settings_app, name="settings")
app.add_typer(models_app, name="models")


@app.callback()
def main(
    ctx: typer.Context,
    base_url: str = typer.Option(None, "--base-url", envvar="MERIDIAN_BASE_URL", help="Backend base URL"),
    api_key: str = typer.Option(None, "--api-key", envvar="MERIDIAN_API_KEY", help="User API key"),
    admin_key: str = typer.Option(None, "--admin-key", envvar="MERIDIAN_ADMIN_API_KEY", help="Admin API key"),
    json_output: bool = typer.Option(False, "--json", help="Machine-readable JSON output"),
    quiet: bool = typer.Option(False, "--quiet", help="Suppress progress output"),
    timeout: float = typer.Option(60.0, "--timeout", help="Request timeout seconds"),
) -> None:
    ctx.ensure_object(dict)
    ctx.obj = CLIState(
        base_url=base_url or "http://localhost:8000",
        api_key=api_key,
        admin_key=admin_key,
        json_output=json_output,
        quiet=quiet,
        timeout=timeout,
    )


# Register commands.
from .commands import health as _health
from .commands import ingest as _ingest
from .commands import models as _models
from .commands import query as _query
from .commands import reindex as _reindex
from .commands import retrieve as _retrieve
from .commands import settings as _settings
from .commands import smoke as _smoke

app.command("health")(_health.health)
app.command("retrieve")(_retrieve.retrieve)
app.command("query")(_query.query)
app.command("ingest")(_ingest.ingest)
app.command("reindex")(_reindex.reindex)
settings_app.command("show")(_settings.show)
settings_app.command("test")(_settings.test)
settings_app.command("set-provider")(_settings.set_provider)
models_app.command("list")(_models.list_models)
app.command("smoke")(_smoke.smoke)
