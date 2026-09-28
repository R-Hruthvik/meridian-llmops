def test_4xx_never_retries_503_retries():
    import httpx
    from packages.core.retry_config import is_retryable
    r404 = httpx.Response(404, request=httpx.Request("GET", "http://x"))
    r503 = httpx.Response(503, request=httpx.Request("GET", "http://x"))
    assert is_retryable(httpx.HTTPStatusError("nf", request=r404.request, response=r404)) is False
    assert is_retryable(httpx.HTTPStatusError("se", request=r503.request, response=r503)) is True
