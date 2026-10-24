"""Retrieve command."""

import typer

from .. import client as client_module
from ..output import emit


def retrieve(
    ctx: typer.Context,
    query: str = typer.Argument(..., help="Search query"),
    top_k: int = typer.Option(5, "--top-k", help="Number of chunks to return"),
) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        data = client.retrieve(query, top_k=top_k)
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
    chunks = data.get("chunks", [])
    human = f"Retrieved {len(chunks)} chunks (top_k={data.get('top_k', top_k)})"
    emit(ctx, True, data=data, human=human)
