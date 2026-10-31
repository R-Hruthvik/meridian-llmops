"""Retrieve helpers for Meridian."""

from __future__ import annotations

from typing import Any, cast

from cli_anything.meridian.client import MeridianClient


def retrieve(
    client: MeridianClient, query: str, top_k: int = 5, debug: bool = False
) -> dict[str, Any]:
    return cast(dict[str, Any], client.retrieve(query, top_k=top_k, debug=debug))
