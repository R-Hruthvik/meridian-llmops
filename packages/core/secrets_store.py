import json
import os

SECRET_SUFFIX = ("_api_key", "_secret", "_password")


def save_prefs(path, prefs):
    clean = {k: v for k, v in prefs.items() if not k.endswith(SECRET_SUFFIX)}
    path.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)
