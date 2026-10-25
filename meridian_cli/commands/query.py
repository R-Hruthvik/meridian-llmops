"""Query command."""

from typing import Any

import typer

from .. import client as client_module
from ..output import emit


def query(
    ctx: typer.Context,
    question: str = typer.Argument(..., help="Question to ask"),
    top_k: int = typer.Option(5, "--top-k", help="Number of chunks to retrieve"),
    stream: bool = typer.Option(False, "--stream", help="Stream the response via SSE"),
) -> None:
    state = ctx.obj
    client = client_module.MeridianClient(
        base_url=state.base_url,
        api_key=state.api_key,
        admin_key=state.admin_key,
        timeout=state.timeout,
    )
    try:
        if stream:
            answer: str = ""
            done_payload = None
            stream_error = None
            for event, payload in client.query_stream(question, top_k=top_k):
                if event == "token":
                    delta = payload.get("delta", "")
                    answer += delta
                    if not state.json_output and not state.quiet:
                        typer.echo(delta, nl=False)
                elif event == "error":
                    stream_error = payload.get("message") if isinstance(payload, dict) else str(payload)
                elif event == "done":
                    done_payload = payload
                    if isinstance(payload, dict) and "answer" in payload:
                        answer = str(payload.get("answer", answer) or answer)
            if stream_error:
                emit(ctx, False, error=stream_error)
                raise typer.Exit(1)
            if not state.json_output and not state.quiet:
                typer.echo()
            data: dict[str, Any] = {"answer": answer}
            if done_payload:
                data["request_id"] = done_payload.get("request_id")
            emit(ctx, True, data=data, human=None)
        else:
            data = client.query(question, top_k=top_k)
            answer = data.get("answer", "")
            emit(ctx, True, data=data, human=answer)
    except Exception as exc:  # noqa: BLE001
        emit(ctx, False, error=str(exc))
        raise typer.Exit(1)
