"""Health helpers for Meridian."""

from __future__ import annotations

from typing import Any

from cli_anything.meridian.client import MeridianClient


def health(client: MeridianClient) -> dict[str, Any]:
    return client.health()
