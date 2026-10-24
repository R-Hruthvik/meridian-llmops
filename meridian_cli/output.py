"""Output helpers for the Meridian CLI."""

import json

import typer


def emit(ctx, ok: bool, data=None, error=None, human=None) -> None:
    state = ctx.obj
    if getattr(state, "json_output", False):
        typer.echo(json.dumps({"ok": ok, "data": data, "error": error}))
        return
    if human is not None:
        typer.echo(human)
    if error:
        typer.echo(str(error), err=True)
