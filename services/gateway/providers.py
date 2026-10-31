"""Supported direct LLM provider endpoint conventions."""

PROVIDERS = {
    "openai": {
        "base_url_default": "https://api.openai.com/v1",
        "path": "/chat/completions",
        "auth_style": "bearer",
        "request_format": "openai",
    },
    "anthropic": {
        "base_url_default": "https://api.anthropic.com",
        "path": "/v1/messages",
        "auth_style": "anthropic",
        "request_format": "anthropic",
    },
    "openrouter": {
        "base_url_default": "https://openrouter.ai/api/v1",
        "path": "/chat/completions",
        "auth_style": "bearer",
        "request_format": "openai",
    },
    "deepseek": {
        "base_url_default": "https://api.deepseek.com/v1",
        "path": "/chat/completions",
        "auth_style": "bearer",
        "request_format": "openai",
    },
    "groq": {
        "base_url_default": "https://api.groq.com/openai/v1",
        "path": "/chat/completions",
        "auth_style": "bearer",
        "request_format": "openai",
    },
    "ollama": {
        "base_url_default": "http://localhost:11434/v1",
        "path": "/chat/completions",
        "auth_style": "none",
        "request_format": "openai",
    },
    "custom": {
        "base_url_default": "",
        "path": "/chat/completions",
        "auth_style": "bearer",
        "request_format": "openai",
    },
}
