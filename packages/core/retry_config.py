"""Centralized retry configuration using tenacity for resilient external service calls."""

import asyncio
import logging
from collections.abc import Callable

import httpx
from tenacity import (
    after_log,
    before_log,
    retry,
    retry_if_exception,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    wait_random,
)

logger = logging.getLogger(__name__)


def retry_on_connection_failure(max_attempts: int = 3) -> Callable:
    """Decorator factory for retrying connection attempts with exponential backoff.

    Retries on transient network/connection failures: ConnectionError, TimeoutError,
    OSError, and asyncio.TimeoutError.

    Args:
        max_attempts: Maximum number of retry attempts (default 3).

    Returns:
        A tenacity retry decorator configured for connection failures.
    """
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=30) + wait_random(min=0, max=1),
        retry=retry_if_exception_type(_TRANSIENT_EXCEPTIONS),
        before=before_log(logger, logging.INFO),
        after=after_log(logger, logging.INFO),
        reraise=True,
    )


def retry_on_api_error(max_attempts: int = 5) -> Callable:
    """Decorator factory for retrying idempotent API operations on 5xx errors.

    Retries on HTTP 5xx server errors and transient network failures with longer
    backoff suitable for API operations.

    Args:
        max_attempts: Maximum number of retry attempts (default 5).

    Returns:
        A tenacity retry decorator configured for API errors.

    Note:
        Uses the shared :func:`is_retryable` predicate (5xx-only plus 429 and
        transient network failures) via ``retry_if_exception``.
    """
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=30) + wait_random(min=0, max=2),
        retry=retry_if_exception(is_retryable),
        before=before_log(logger, logging.INFO),
        after=after_log(logger, logging.INFO),
        reraise=True,
    )


_RETRYABLE = {429, 500, 502, 503, 504}

_TRANSIENT_EXCEPTIONS: tuple[type[BaseException], ...] = (
    ConnectionError,
    TimeoutError,
    OSError,
    asyncio.TimeoutError,
    httpx.RequestError,
)
try:  # pragma: no cover - optional driver
    from sqlalchemy.exc import DBAPIError, OperationalError

    _TRANSIENT_EXCEPTIONS = _TRANSIENT_EXCEPTIONS + (DBAPIError, OperationalError)
except ImportError:
    pass
try:  # pragma: no cover - optional driver
    import asyncpg.exceptions as _asyncpg_exceptions

    _TRANSIENT_EXCEPTIONS = _TRANSIENT_EXCEPTIONS + (
        getattr(_asyncpg_exceptions, "PostgresConnectionError", Exception),
    )
except ImportError:
    pass


def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE
    return isinstance(exc, _TRANSIENT_EXCEPTIONS)


def retry_transient(max_attempts: int = 5):
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        retry=retry_if_exception(is_retryable),
        reraise=True,
    )


import time as _time


class CircuitBreaker:
    """Simple in-process circuit breaker for unreliable downstream calls."""

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = __import__("threading").Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._opened_at is None:
                return "closed"
            if _time.monotonic() - self._opened_at >= self.recovery_timeout:
                return "half_open"
            return "open"

    def allow(self) -> bool:
        state = self.state
        return state in {"closed", "half_open"}

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = None

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self.failure_threshold:
                self._opened_at = _time.monotonic()

    def call(self, func, *args, **kwargs):
        if not self.allow():
            raise RuntimeError("Circuit breaker is open")
        try:
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception:
            self.record_failure()
            raise
