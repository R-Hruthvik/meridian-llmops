"""Settings helpers for Meridian."""

from __future__ import annotations

from typing import Any, cast

from cli_anything.meridian.client import MeridianClient


def show(client: MeridianClient) -> dict[str, Any]:
    return cast(dict[str, Any], client.settings_show())


def test(client: MeridianClient) -> dict[str, Any]:
    return cast(dict[str, Any], client.settings_test())


def set_provider(
    client: MeridianClient,
    provider: str,
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        client.settings_set_provider(provider, model, base_url=base_url, api_key=api_key),
    )


def list_models(
    client: MeridianClient,
    provider: str,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    return cast(dict[str, Any], client.models_list(provider, base_url=base_url, api_key=api_key))
