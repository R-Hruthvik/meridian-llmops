"""Settings commands."""

import typer

from .. import client as client_module
from ..output import emit


def show(ctx: typer.Context) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        data = client.settings_show()
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    emit(ctx, True, data=data, human="LLM settings loaded")


def test(ctx: typer.Context) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        data = client.settings_test()
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    ok = bool(data.get("status") == "success" or data.get("success"))
    human = data.get("message", "LLM connection test complete")
    if ok:
        emit(ctx, True, data=data, human=human)
    else:
        emit(ctx, False, data=data, error=human)
        raise typer.Exit(1)


def set_provider(
    ctx: typer.Context,
    provider: str = typer.Option(..., "--provider", help="Provider id"),
    model: str = typer.Option(..., "--model", help="Model name"),
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
        data = client.settings_set_provider(provider, model, base_url=base_url, api_key=api_key)
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    emit(ctx, True, data=data, human=f"Provider set to {provider} ({model})")
