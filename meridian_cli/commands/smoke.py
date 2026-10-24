"""Smoke command."""

from typing import Any

import typer

from .. import client as client_module
from ..output import emit


def smoke(ctx: typer.Context) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    results: dict[str, Any] = {}
    try:
        results["health"] = client.health()
        results["retrieve"] = client.retrieve("Meridian", top_k=3)
        q = client.query("What is Meridian?", top_k=3)
        results["query"] = q
        answer = str(q.get("answer", ""))
        emit(ctx, True, data=results, human=f"Smoke passed. Answer: {answer[:200]}")
    except Exception as exc:  # noqa: BLE001
        results["error"] = str(exc)
        emit(ctx, False, data=results, error=str(exc))
        raise typer.Exit(1)
