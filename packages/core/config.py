"""Application configuration and environment settings.

Re-export shim: the single owner is :mod:`packages.core.settings`.
This module remains until migration completes so existing imports
(``from packages.core.config import Settings, ...``) keep working.
"""

from packages.core.settings import Settings, get_settings, validate_production

__all__ = ["Settings", "get_settings", "validate_production"]
