"""Stateful session management for the Meridian CLI harness."""

from __future__ import annotations

import copy
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


if sys.platform == "win32":
    import contextlib
    import msvcrt as _msvcrt

    @contextlib.contextmanager
    def _exclusive_lock(fd: int):
        delay = 0.05
        while True:
            try:
                _msvcrt.locking(fd, _msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if delay > 10:
                    raise RuntimeError("Could not acquire lock")
                time.sleep(delay)
                delay = min(delay * 2, 2.0)
        try:
            yield
        finally:
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                _msvcrt.locking(fd, _msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
else:
    import contextlib
    import fcntl as _fcntl

    @contextlib.contextmanager
    def _exclusive_lock(fd: int):
        _fcntl.flock(fd, _fcntl.LOCK_EX)
        try:
            yield
        finally:
            _fcntl.flock(fd, _fcntl.LOCK_UN)


def create_session_state(
    name: str = "meridian-session",
    base_url: str | None = None,
    api_key: str | None = None,
    admin_key: str | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    return {
        "name": name,
        "base_url": base_url,
        "api_key": api_key,
        "admin_key": admin_key,
        "timeout": timeout,
        "history": [],
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }


def open_session_state(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_session_state(state: dict[str, Any], path: str) -> str:
    state["updated_at"] = utc_now()
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    lock_path = f"{path}.lock"
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR)
    try:
        with _exclusive_lock(lock_fd):
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2, ensure_ascii=False)
            os.replace(tmp, path)
    finally:
        os.close(lock_fd)
    return path


def export_session_state(state: dict[str, Any], path: str) -> str:
    # Export is a plain (non-locked) write to a new artifact path.
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    return path


@dataclass
class Session:
    project: dict[str, Any] | None = None
    project_path: str | None = None
    _modified: bool = False
    _undo_stack: list[dict[str, Any]] = field(default_factory=list)
    _redo_stack: list[dict[str, Any]] = field(default_factory=list)

    def has_project(self) -> bool:
        return self.project is not None

    def set_project(self, project: dict[str, Any], path: str | None = None) -> None:
        self.project = project
        self.project_path = path
        self._modified = False
        self._undo_stack.clear()
        self._redo_stack.clear()

    def get_project(self) -> dict[str, Any]:
        if self.project is None:
            raise RuntimeError("No session loaded")
        return self.project

    def snapshot(self, reason: str) -> None:
        if self.project is None:
            raise RuntimeError("No session loaded")
        self._undo_stack.append(copy.deepcopy(self.project))
        self._redo_stack.clear()
        self._modified = True
        self.project.setdefault("history", []).append({"reason": reason, "at": utc_now()})

    def mark_dirty(self) -> None:
        if self.project is None:
            raise RuntimeError("No session loaded")
        self._modified = True

    def undo(self) -> dict[str, Any]:
        if not self._undo_stack:
            raise RuntimeError("Nothing to undo")
        if self.project is not None:
            self._redo_stack.append(copy.deepcopy(self.project))
        self.project = self._undo_stack.pop()
        self._modified = True
        return self.project

    def redo(self) -> dict[str, Any]:
        if not self._redo_stack:
            raise RuntimeError("Nothing to redo")
        if self.project is not None:
            self._undo_stack.append(copy.deepcopy(self.project))
        self.project = self._redo_stack.pop()
        self._modified = True
        return self.project

    def status(self) -> dict[str, Any]:
        return {
            "has_project": self.has_project(),
            "project_path": self.project_path,
            "modified": self._modified,
            "undo_depth": len(self._undo_stack),
            "redo_depth": len(self._redo_stack),
        }

    def save_session(self, path: str | None = None) -> str:
        if self.project is None:
            raise RuntimeError("No session loaded")
        target = path or self.project_path
        if not target:
            raise RuntimeError("No session path set")
        saved = save_session_state(self.project, target)
        self.project_path = target
        self._modified = False
        return saved

    def export_session(self, path: str) -> str:
        if self.project is None:
            raise RuntimeError("No session loaded")
        return export_session_state(self.project, path)


# Backwards-friendly aliases used by tests.
def new_session(name: str = "meridian-session", **kwargs: Any) -> Session:
    sess = Session()
    sess.set_project(create_session_state(name=name, **kwargs))
    return sess


def open_session(path: str) -> Session:
    sess = Session()
    sess.set_project(open_session_state(path), path)
    return sess
