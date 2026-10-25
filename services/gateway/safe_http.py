"""Outbound HTTP helpers for provider endpoints with validated, pinned DNS."""

import ipaddress
import socket
import threading
from urllib.parse import urlsplit

import httpcore
import httpx


class ProviderURLNotAllowed(ValueError):
    """Raised when a configured provider endpoint is not safe to contact."""


def validate_provider_url(
    provider: str,
    url: str,
    *,
    allow_private: bool = False,
    resolve: bool = True,
) -> tuple[str, str, int, tuple[str, ...]]:
    """Validate an endpoint and return the DNS answers to pin for its request."""
    try:
        if not url or url != url.strip() or any(char in url for char in "\r\n\t"):
            raise ValueError
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or "?" in url
            or "#" in url
        ):
            raise ValueError
        hostname = parsed.hostname.encode("idna").decode("ascii").lower()
        if "%" in hostname:
            raise ValueError
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if parsed.scheme == "http":
            is_loopback_host = hostname in {"localhost", "127.0.0.1", "::1"}
            local_http_providers = {"litellm", "ollama", "custom", "openai_compatible"}
            if provider not in local_http_providers:
                raise ValueError
            if provider == "litellm":
                if not allow_private:
                    raise ValueError
            elif not (allow_private or is_loopback_host):
                raise ValueError
        if not resolve:
            return url, hostname, port, ()
        addresses = tuple(
            sorted(
                {
                    str(ipaddress.ip_address(str(info[4][0]).split("%", 1)[0]))
                    for info in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
                }
            )
        )
        if not addresses:
            raise ValueError
        is_loopback_host = hostname in {"localhost", "127.0.0.1", "::1"}
        parsed_addresses = [ipaddress.ip_address(address) for address in addresses]
        if allow_private:
            if any(
                address.is_unspecified
                or address.is_multicast
                or address.is_link_local
                or (address.is_reserved and not address.is_loopback)
                or not (address.is_global or address.is_private or address.is_loopback)
                for address in parsed_addresses
            ):
                raise ValueError
        elif not (parsed.scheme == "http" and provider in {"ollama", "custom", "openai_compatible", "litellm"} and is_loopback_host):
            if not all(
                address.is_global
                and not (
                    address.is_private
                    or address.is_loopback
                    or address.is_link_local
                    or address.is_unspecified
                    or address.is_multicast
                    or address.is_reserved
                )
                for address in parsed_addresses
            ):
                raise ValueError
        if parsed.scheme == "http" and provider != "litellm" and not all(
            address.is_loopback for address in parsed_addresses
        ):
            raise ValueError
        if parsed.scheme == "http" and provider == "litellm" and not all(
            address.is_private or address.is_loopback for address in parsed_addresses
        ):
            raise ValueError
    except (OSError, ValueError, IndexError):
        raise ProviderURLNotAllowed("Provider URL is not allowed.") from None
    return url, hostname, port, addresses


class PinnedAddressBackend:
    """Connect to validated addresses while retaining the URL hostname for TLS."""

    def __init__(self, network_backend):
        self._network_backend = network_backend
        self._addresses: dict[tuple[str, int], tuple[str, ...]] = {}
        self._lock = threading.Lock()

    def pin(self, host: str, port: int, addresses: tuple[str, ...]) -> None:
        with self._lock:
            self._addresses[(host.lower(), port)] = addresses

    async def connect_tcp(self, host: str, port: int, **kwargs):
        with self._lock:
            addresses = self._addresses.get((host.lower(), port), ())
            addresses = tuple(addresses)
        if not addresses:
            raise OSError("No validated provider address is available.")
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._network_backend.connect_tcp(address, port, **kwargs)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as error:
                last_error = error
        if last_error:
            raise last_error
        raise OSError("No validated provider address is available.")

    async def connect_unix_socket(self, path: str, **kwargs):
        return await self._network_backend.connect_unix_socket(path, **kwargs)

    async def sleep(self, seconds: float) -> None:
        await self._network_backend.sleep(seconds)


class PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    """HTTPX transport that disables ambient proxies and pins validated DNS."""

    def __init__(self):
        try:
            import ssl

            import certifi

            verify = ssl.create_default_context(cafile=certifi.where())
        except Exception:  # noqa: BLE001
            verify = True
        super().__init__(trust_env=False, verify=verify)
        self.address_backend = PinnedAddressBackend(self._pool._network_backend)
        self._pool._network_backend = self.address_backend
