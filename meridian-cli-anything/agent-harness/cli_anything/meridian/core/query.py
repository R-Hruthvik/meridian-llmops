"""Query helpers for Meridian."""

from __future__ import annotations

from typing import Any, cast

from cli_anything.meridian.client import MeridianClient


def query(client: MeridianClient, question: str, top_k: int = 5) -> dict[str, Any]:
    return cast(dict[str, Any], client.query(question, top_k=top_k))


def query_stream(client: MeridianClient, question: str, top_k: int = 5) -> list[tuple[str, dict[str, Any]]]:
    return list(client.query_stream(question, top_k=top_k))
