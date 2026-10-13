import json
import os
import tempfile
from pathlib import Path

SECRET_SUFFIX = ("_api_key", "_secret", "_password")


def save_prefs(path, prefs):
    clean = {k: v for k, v in prefs.items() if not k.endswith(SECRET_SUFFIX)}
    path.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)


def load_secrets(path: Path) -> dict:
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(saved, dict):
        return {}
    return {key: value for key, value in saved.items() if key.endswith(SECRET_SUFFIX)}


def save_secrets(path: Path, secrets: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        stream_context = os.fdopen(descriptor, "w", encoding="utf-8")
        descriptor = -1
        with stream_context as stream:
            json.dump(secrets, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)
