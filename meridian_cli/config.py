"""Configuration helpers for the Meridian CLI."""

from dataclasses import dataclass


@dataclass
class CLIConfig:
    base_url: str
    api_key: str | None
    admin_key: str | None
    json_output: bool
    quiet: bool
    timeout: float
