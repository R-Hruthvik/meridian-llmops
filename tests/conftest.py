"""Shared pytest fixtures and environment setup for Meridian LLMOps tests."""

import os

# Set test environment variables so Settings picks them up before any imports
# that call get_settings(). These must be set before the first import of
# modules that use Settings.
os.environ.setdefault("API_KEY_SECRET", "meridian-test-secret-key-2026")
os.environ.setdefault("LITELLM_MASTER_KEY", "sk-test-litellm-key")
os.environ.setdefault("NEO4J_PASSWORD", "test-neo4j-password")
os.environ.setdefault("APP_ENV", "testing")
