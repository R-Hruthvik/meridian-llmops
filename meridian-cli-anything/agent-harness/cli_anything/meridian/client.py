"""HTTP client wrapper for the Meridian backend (CLI-Anything harness)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any, cast

import httpx

DEFAULT_BASE_URL = "http://localhost:8000"


class MeridianAPIError(Exception):
    """Raised when the backend returns an error response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class MeridianConnectionError(MeridianAPIError):
    """Raised when the backend cannot be reached."""


class MeridianClient:
    """Thin httpx wrapper. Returns parsed JSON for domain helpers."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        admin_key: str | None = None,
        admin_api_key: str | None = None,
        timeout: float = 60.0,
        transport: Any = None,
        client: Any = None,
        http_client: Any = None,
    ) -> None:
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.api_key = api_key
        self.admin_key = admin_key if admin_key is not None else admin_api_key
        self.timeout = float(timeout)
        self.transport = transport
        self._client = client if client is not None else http_client

    def _headers(self, admin: bool = False) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        key = self.admin_key if admin else self.api_key
        if key:
            headers["X-API-Key"] = key
        return headers

    def _http(self) -> Any:
        if self._client is not None:
            return self._client
        return httpx.Client(base_url=self.base_url, timeout=self.timeout, transport=self.transport)

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        data: Any = None,
        headers: dict[str, str] | None = None,
        admin: bool = False,
        timeout: float | None = None,
        stream: bool = False,
    ) -> httpx.Response:
        merged = self._headers(admin)
        if headers:
            merged.update(headers)
        client = self._http()
        try:
            response: httpx.Response = client.request(
                method,
                path,
                params=params,
                json=json,
                data=data,
                headers=merged,
                timeout=timeout if timeout is not None else self.timeout,
            )
        except httpx.HTTPError as exc:
            raise MeridianConnectionError(str(exc)) from exc
        return response

    def get(self, path: str, *, admin: bool = False, **kwargs: Any) -> httpx.Response:
        return self.request("GET", path, admin=admin, **kwargs)

    def post(self, path: str, *, admin: bool = False, **kwargs: Any) -> httpx.Response:
        return self.request("POST", path, admin=admin, **kwargs)

    def put(self, path: str, *, admin: bool = False, **kwargs: Any) -> httpx.Response:
        return self.request("PUT", path, admin=admin, **kwargs)

    def patch(self, path: str, *, admin: bool = False, **kwargs: Any) -> httpx.Response:
        return self.request("PATCH", path, admin=admin, **kwargs)

    def delete(self, path: str, *, admin: bool = False, **kwargs: Any) -> httpx.Response:
        return self.request("DELETE", path, admin=admin, **kwargs)

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code >= 400:
            try:
                detail = response.json()
            except (ValueError, json.JSONDecodeError):
                detail = response.text
            raise MeridianAPIError(f"HTTP {response.status_code}: {detail}", status_code=response.status_code)

    def health(self) -> dict[str, Any]:
        response = self.get("/health")
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def retrieve(self, query: str, top_k: int = 5, debug: bool = False) -> dict[str, Any]:
        response = self.post("/v1/retrieve", json={"query": query, "top_k": top_k, "debug": debug})
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def query(self, query: str, top_k: int = 5) -> dict[str, Any]:
        response = self.post("/v1/query", json={"query": query, "top_k": top_k})
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def query_stream(self, query: str, top_k: int = 5) -> Iterator[tuple[str, dict[str, Any]]]:
        payload = {"query": query, "top_k": top_k}
        headers = self._headers(admin=False)
        headers["Accept"] = "text/event-stream"
        client = self._http()
        with client.stream("POST", "/v1/query/stream", json=payload, headers=headers, timeout=self.timeout) as response:
            if response.status_code >= 400:
                raise MeridianAPIError(f"HTTP {response.status_code}", status_code=response.status_code)
            event = "message"
            for line in response.iter_lines():
                if not line:
                    event = "message"
                    continue
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    raw = line[len("data:"):].strip()
                    try:
                        data = json.loads(raw) if raw else {}
                    except json.JSONDecodeError:
                        data = {"raw": raw}
                    yield event, data
                    event = "message"

    def settings_show(self) -> dict[str, Any]:
        response = self.get("/v1/settings/llm", admin=True)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def settings_test(self) -> dict[str, Any]:
        response = self.post("/v1/settings/llm/test", admin=True)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def settings_set_provider(
        self,
        provider: str,
        model: str,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "active_provider": provider,
            "default_model": model,
            "model": model,
        }
        if base_url is not None:
            payload["base_url"] = base_url
        if api_key is not None:
            payload["api_key"] = api_key
        response = self.post("/v1/settings/llm", json=payload, admin=True)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def models_list(
        self,
        provider: str,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"provider": provider}
        if base_url is not None:
            payload["base_url"] = base_url
        if api_key is not None:
            payload["api_key"] = api_key
        response = self.post("/v1/settings/llm/test-and-fetch-models", json=payload, admin=True)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def ingest_text(
        self,
        text: str,
        title: str | None = None,
        source: str | None = None,
        fmt: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"text": text}
        if title is not None:
            payload["title"] = title
        if source is not None:
            payload["source"] = source
        if fmt is not None:
            payload["format"] = fmt
        response = self.post("/v1/ingest", json=payload)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())

    def reindex(self) -> dict[str, Any]:
        response = self.post("/v1/reindex", admin=True)
        self._raise_for_status(response)
        return cast(dict[str, Any], response.json())
