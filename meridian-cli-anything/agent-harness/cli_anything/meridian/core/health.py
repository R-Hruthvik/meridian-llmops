"""Health helpers for Meridian."""

from __future__ import annotations

from typing import cast, Any

from cli_anything.meridian.client import MeridianClient


def health(client: MeridianClient) -> dict[str, Any]:
    return cast(dict[str, Any], client.health())
