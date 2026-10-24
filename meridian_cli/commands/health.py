"""Health command."""

import typer

from .. import client as client_module
from ..output import emit


def health(ctx: typer.Context) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        data = client.health()
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    human = f"Meridian backend healthy ({data.get('service', 'meridian-rag-engine')})"
    emit(ctx, True, data=data, human=human)
