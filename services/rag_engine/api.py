"""Compatibility import for the historical RAG API module."""

import sys

from services.rag_engine.routers import api as _api

sys.modules[__name__] = _api
