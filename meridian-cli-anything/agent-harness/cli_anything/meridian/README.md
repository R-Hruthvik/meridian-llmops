# Meridian CLI (CLI-Anything harness)

Install:
```
cd agent-harness
pip install -e .
```

Usage:
```
cli-anything-meridian --help
cli-anything-meridian health
cli-anything-meridian --json retrieve "hello" --top-k 4
```

Environment:
- MERIDIAN_BASE_URL
- MERIDIAN_API_KEY
- MERIDIAN_ADMIN_API_KEY
- MERIDIAN_TIMEOUT

Tests:
```
cd agent-harness
python -m pytest cli_anything/meridian/tests -q
```
