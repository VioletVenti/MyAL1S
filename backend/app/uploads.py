"""File-storage helper for P2 write-ops (NOT a seam — a small I/O utility).

Chat-attached and UI-uploaded files land in a single on-disk dir keyed by an
opaque ``file_id``. The :class:`PermissionGate` resolves ``file_id`` → an
absolute path just before dispatching a write to pku3b's ``submit_assignment``
(which needs a server-local path). The original filename is preserved in the
stored path because pku3b's ``submit_file`` derives the Blackboard submission
title from the file name — stripping it would submit every file as a uuid.

Files live under ``uploads_dir`` (gitignored; see ``.gitignore``). This module
knows nothing about permissions, the matrix, or the teaching network — it only
stores and locates bytes.
"""

from __future__ import annotations

import uuid
from pathlib import Path


def _safe_filename(name: str) -> str:
    """Reduce a client-supplied filename to its basename (defuses path traversal
    and separators). Empty → ``upload``."""
    base = Path(name).name
    return base or "upload"


class Uploads:
    """Bytes-in / path-out over one directory. Construct with a root path; the
    dir is created on first save."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)

    def _dir(self, file_id: str) -> Path:
        return self._root / file_id

    def save(self, content: bytes, filename: str) -> str:
        """Persist ``content`` under a fresh ``file_id``; return the file_id. The
        original (basename-sanitized) filename is kept as the stored file's name
        so pku3b submits it under the right title."""
        file_id = uuid.uuid4().hex
        d = self._dir(file_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / _safe_filename(filename)).write_bytes(content)
        return file_id

    def path_for(self, file_id: str) -> Path:
        """Resolve a ``file_id`` to its absolute stored path. Raises
        ``FileNotFoundError`` if the file_id is unknown — the gate surfaces that
        as a failed approval rather than dispatching a bad path."""
        d = self._dir(file_id)
        if not d.is_dir():
            raise FileNotFoundError(file_id)
        files = [p for p in d.iterdir() if p.is_file()]
        if not files:
            raise FileNotFoundError(file_id)
        return files[0].resolve()

    def filename_for(self, file_id: str) -> str | None:
        """The original filename for a file_id, or None if unknown. Used to show
        the user what they're approving in the 待审批 panel."""
        try:
            return self.path_for(file_id).name
        except FileNotFoundError:
            return None
