"""Centralized retry configuration using tenacity for resilient external service calls."""

import asyncio
import logging
from typing import Callable

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
        retry=retry_if_exception_type((ConnectionError, TimeoutError, OSError, asyncio.TimeoutError)),
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


def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE
    return isinstance(exc, (ConnectionError, TimeoutError, OSError, asyncio.TimeoutError))


def retry_transient(max_attempts: int = 5):
    return retry(stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        retry=retry_if_exception(is_retryable), reraise=True)

