"""Meridian CLI harness (Click-based)."""

from __future__ import annotations

import functools
import json
import os
import shlex
import sys
from typing import Any

import click

from cli_anything.meridian import client as client_module
from cli_anything.meridian.core import health as health_core
from cli_anything.meridian.core import ingest as ingest_core
from cli_anything.meridian.core import query as query_core
from cli_anything.meridian.core import retrieve as retrieve_core
from cli_anything.meridian.core import session as session_core
from cli_anything.meridian.core import settings as settings_core

_json_output: bool = False
_repl_mode: bool = False
_base_url: str = "http://localhost:8000"
_api_key: str | None = None
_admin_key: str | None = None
_timeout: float = 60.0


_session: session_core.Session | None = None


def get_session() -> session_core.Session:
    global _session
    if _session is None:
        _session = session_core.Session()
    return _session


def _emit(ok: bool, command: str, data: Any = None, message: str = "", error: str | None = None) -> None:
    global _json_output
    if _json_output:
        click.echo(json.dumps({"ok": ok, "command": command, "data": data, "error": error}, default=str))
        return
    if ok:
        if message:
            click.echo(message)
        if isinstance(data, dict):
            for k, v in data.items():
                click.echo(f"{k}: {v}")
        elif isinstance(data, list):
            for item in data:
                click.echo(item)
        elif data is not None and not message:
            click.echo(data)
    else:
        if error:
            click.echo(f"Error: {error}", err=True)
        if data is not None:
            click.echo(str(data), err=True)


def _make_client() -> client_module.MeridianClient:
    return client_module.MeridianClient(
        base_url=_base_url,
        api_key=_api_key,
        admin_key=_admin_key,
        timeout=_timeout,
    )


def handle_error(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            _emit(False, func.__name__, error=str(exc))
            if not _repl_mode:
                sys.exit(1)
    return wrapper


@click.group(invoke_without_command=True)
@click.option("--json", "use_json", is_flag=True, help="Emit machine-readable JSON output.")
@click.option("--base-url", "base_url", default=None, envvar="MERIDIAN_BASE_URL", help="Backend base URL.")
@click.option("--api-key", "api_key", default=None, envvar="MERIDIAN_API_KEY", help="User API key.")
@click.option("--admin-key", "--admin-api-key", "admin_key", default=None, envvar="MERIDIAN_ADMIN_API_KEY", help="Admin API key.")
@click.option("--timeout", "timeout", default=60.0, envvar="MERIDIAN_TIMEOUT", type=float, help="Request timeout seconds.")
@click.option("--project", "project_path", type=str, default=None, help="Path to a session JSON file.")
@click.option("--dry-run", "dry_run", is_flag=True, default=False, help="Run without saving session changes.")
@click.pass_context
def cli(ctx, use_json, base_url, api_key, admin_key, timeout, project_path, dry_run):
    global _json_output, _base_url, _api_key, _admin_key, _timeout
    _json_output = use_json
    _base_url = (base_url or "http://localhost:8000").rstrip("/")
    _api_key = api_key
    _admin_key = admin_key
    _timeout = float(timeout)

    sess = get_session()
    if project_path and not sess.has_project() and os.path.exists(project_path):
        proj = session_core.open_session_state(project_path)
        sess.set_project(proj, project_path)

    ctx.ensure_object(dict)
    ctx.obj = {
        "base_url": _base_url,
        "api_key": _api_key,
        "admin_key": _admin_key,
        "timeout": _timeout,
        "dry_run": dry_run,
    }

    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


@cli.result_callback()
def auto_save_on_exit(result, use_json, base_url, api_key, admin_key, timeout, project_path, dry_run, **kwargs):
    if _repl_mode:
        return
    if dry_run:
        return
    sess = get_session()
    if sess.has_project() and sess._modified and sess.project_path:
        try:
            sess.save_session()
        except Exception as exc:  # noqa: BLE001
            click.echo(f"Warning: Auto-save failed: {exc}", err=True)


# health
@cli.command("health")
@handle_error
def health():
    client = _make_client()
    data = health_core.health(client)
    svc = data.get("service", "meridian-rag-engine")
    _emit(True, "health", data=data, message=f"Meridian backend healthy ({svc})")


# retrieve
@cli.command("retrieve")
@click.argument("query")
@click.option("--top-k", "top_k", default=5, type=int, help="Number of chunks to return.")
@click.option("--debug", is_flag=True, help="Include debug info.")
@handle_error
def retrieve(query, top_k, debug):
    client = _make_client()
    data = retrieve_core.retrieve(client, query, top_k=top_k, debug=debug)
    chunks = data.get("chunks", [])
    _emit(True, "retrieve", data=data, message=f"Retrieved {len(chunks)} chunks (top_k={data.get('top_k', top_k)})")


# query
@cli.command("query")
@click.argument("question")
@click.option("--top-k", "top_k", default=5, type=int, help="Number of chunks to retrieve.")
@click.option("--stream", is_flag=True, help="Stream the response via SSE.")
@handle_error
def query(question, top_k, stream):
    client = _make_client()
    if stream:
        answer = ""
        done_payload = None
        for event, payload in client.query_stream(question, top_k=top_k):
            if event == "token":
                delta = payload.get("delta", "")
                answer += delta
                if not _json_output:
                    click.echo(delta, nl=False)
            elif event == "done":
                done_payload = payload
                if isinstance(payload, dict) and "answer" in payload:
                    answer = str(payload.get("answer", answer) or answer)
        if not _json_output:
            click.echo()
        data: dict[str, Any] = {"answer": answer}
        if done_payload:
            data["request_id"] = done_payload.get("request_id")
        _emit(True, "query", data=data)
    else:
        data = client.query(question, top_k=top_k)
        answer = data.get("answer", "")
        _emit(True, "query", data=data, message=answer)


# ingest
@cli.command("ingest")
@click.argument("path")
@click.option("--recursive", "-r", is_flag=True, help="Recurse into subdirectories.")
@handle_error
def ingest(path, recursive):
    client = _make_client()
    data = ingest_core.ingest_path(client, path, recursive=recursive)
    _emit(True, "ingest", data=data, message=f"Ingested {data.get('ingested', 0)} files")


# reindex
@cli.command("reindex")
@handle_error
def reindex():
    client = _make_client()
    data = client.reindex()
    _emit(True, "reindex", data=data, message=f"Reindexed: {data.get('status', 'done')}")


# settings
@cli.group("settings")
def settings_group():
    """LLM settings commands."""


@settings_group.command("show")
@handle_error
def settings_show():
    client = _make_client()
    data = settings_core.show(client)
    _emit(True, "settings.show", data=data, message="LLM settings loaded")


@settings_group.command("test")
@handle_error
def settings_test():
    client = _make_client()
    data = settings_core.test(client)
    ok = bool(data.get("status") == "success" or data.get("success"))
    human = data.get("message", "LLM connection test complete")
    if ok:
        _emit(True, "settings.test", data=data, message=human)
    else:
        _emit(False, "settings.test", data=data, error=human)
        if not _repl_mode:
            sys.exit(1)


@settings_group.command("set-provider")
@click.option("--provider", required=True, help="Provider id.")
@click.option("--model", required=True, help="Model name.")
@click.option("--base-url", "base_url", default=None, help="Provider base URL.")
@click.option("--api-key", "api_key", default=None, help="Provider API key.")
@handle_error
def settings_set_provider(provider, model, base_url, api_key):
    client = _make_client()
    sess = get_session()
    if sess.has_project():
        sess.snapshot(f"settings.set-provider {provider}")
    data = settings_core.set_provider(client, provider, model, base_url=base_url, api_key=api_key)
    _emit(True, "settings.set-provider", data=data, message=f"Provider set to {provider} ({model})")


# models
@cli.group("models")
def models_group():
    """Model commands."""


@models_group.command("list")
@click.option("--provider", required=True, help="Provider id.")
@click.option("--base-url", "base_url", default=None, help="Provider base URL.")
@click.option("--api-key", "api_key", default=None, help="Provider API key.")
@handle_error
def models_list(provider, base_url, api_key):
    client = _make_client()
    data = settings_core.list_models(client, provider, base_url=base_url, api_key=api_key)
    models = data.get("models", [])
    _emit(True, "models.list", data=data, message=f"Fetched {len(models)} models for {provider}")


# smoke
@cli.command("smoke")
@handle_error
def smoke():
    client = _make_client()
    results: dict[str, Any] = {}
    results["health"] = client.health()
    results["retrieve"] = client.retrieve("Meridian", top_k=3)
    q = client.query("What is Meridian?", top_k=3)
    results["query"] = q
    answer = str(q.get("answer", ""))
    _emit(True, "smoke", data=results, message=f"Smoke passed. Answer: {answer[:200]}")


# session
@cli.group("session")
def session_group():
    """Session management commands."""


@session_group.command("new")
@click.option("--name", default="meridian-session", help="Session name.")
@click.option("--output", "-o", default=None, help="Output path.")
@handle_error
def session_new(name, output):
    sess = get_session()
    proj = session_core.create_session_state(name=name, base_url=_base_url, api_key=_api_key, admin_key=_admin_key, timeout=_timeout)
    sess.set_project(proj, output)
    if output:
        sess.save_session(output)
    _emit(True, "session.new", data={"name": name, "path": output}, message=f"Created session: {name}")


@session_group.command("open")
@click.argument("path")
@handle_error
def session_open(path):
    sess = get_session()
    proj = session_core.open_session_state(path)
    sess.set_project(proj, path)
    _emit(True, "session.open", data={"path": path}, message=f"Opened: {path}")


@session_group.command("save")
@click.argument("path", required=False)
@handle_error
def session_save(path):
    sess = get_session()
    saved = sess.save_session(path)
    _emit(True, "session.save", data={"saved": saved}, message=f"Saved session: {saved}")


@session_group.command("export")
@click.argument("path")
@handle_error
def session_export(path):
    sess = get_session()
    saved = sess.export_session(path)
    _emit(True, "session.export", data={"exported": saved}, message=f"Exported session: {saved}")


@session_group.command("status")
@handle_error
def session_status():
    sess = get_session()
    _emit(True, "session.status", data=sess.status(), message="Session status")


@session_group.command("undo")
@handle_error
def session_undo():
    sess = get_session()
    proj = sess.undo()
    _emit(True, "session.undo", data=sess.status(), message="Undo complete")


@session_group.command("redo")
@handle_error
def session_redo():
    sess = get_session()
    proj = sess.redo()
    _emit(True, "session.redo", data=sess.status(), message="Redo complete")


# top-level undo/redo aliases
@cli.command("undo")
@handle_error
def undo():
    sess = get_session()
    sess.undo()
    _emit(True, "undo", data=sess.status(), message="Undo complete")


@cli.command("redo")
@handle_error
def redo():
    sess = get_session()
    sess.redo()
    _emit(True, "redo", data=sess.status(), message="Redo complete")


# repl
@cli.command("repl")
def repl():
    global _repl_mode
    _repl_mode = True
    from cli_anything.meridian.utils.repl_skin import ReplSkin

    skin = ReplSkin(software="meridian", version="1.0.0")
    skin.print_banner()
    pt_session = skin.create_prompt_session()

    while True:
        try:
            line = skin.get_input(pt_session).strip()
        except (KeyboardInterrupt, EOFError):
            skin.print_goodbye()
            break
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            skin.print_goodbye()
            break
        try:
            args = shlex.split(line)
            cli.main(args=args, standalone_mode=False)
        except SystemExit:
            pass
        except ValueError as exc:
            _emit(False, "repl", error=f"Invalid input: {exc}")
        except Exception as exc:  # noqa: BLE001
            _emit(False, "repl", error=str(exc))
    _repl_mode = False


app = cli


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
