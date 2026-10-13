"""Application factory and compatibility exports for the RAG API."""

import sys

from services.rag_engine.routers import api as _api

# Route and legacy imports share one module so existing monkeypatch seams work.
_api.__name__ = __name__
sys.modules[__name__] = _api
