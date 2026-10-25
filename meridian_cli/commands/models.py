"""Models command."""

import typer

from .. import client as client_module
from ..output import emit


def list_models(
    ctx: typer.Context,
    provider: str = typer.Option(..., "--provider", help="Provider id"),
    base_url: str = typer.Option(None, "--base-url", help="Provider base URL"),
    api_key: str = typer.Option(None, "--api-key", help="Provider API key"),
) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        data = client.models_list(provider, base_url=base_url, api_key=api_key)
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    if not (data.get("success") or data.get("status") == "success"):
        message = data.get("message") or "Model fetch failed"
        emit(ctx, False, data=data, error=message)
        raise typer.Exit(1)
    models = data.get("models", [])
    human = data.get("message") or f"Fetched {len(models)} models for {provider}"
    emit(ctx, True, data=data, human=human)
