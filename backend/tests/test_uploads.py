"""Tests for the Uploads helper (P2 write-ops): save → path_for round-trip,
original-filename preservation, path-traversal defusing, unknown-file_id error."""

from __future__ import annotations

import pytest

from app.uploads import Uploads


@pytest.fixture
def uploads(tmp_path):
    return Uploads(tmp_path / "uploads")


def test_save_returns_file_id_and_round_trips(uploads):
    file_id = uploads.save(b"hello bytes", "report.pdf")
    assert isinstance(file_id, str) and len(file_id) > 0
    path = uploads.path_for(file_id)
    assert path.read_bytes() == b"hello bytes"
    # The original filename is preserved (pku3b submits under it).
    assert path.name == "report.pdf"
    assert uploads.filename_for(file_id) == "report.pdf"


def test_save_preserves_only_basename_defusing_traversal(uploads):
    # A malicious/accidental path-y filename must collapse to its basename so the
    # stored file can't escape uploads_dir and the title stays clean.
    file_id = uploads.save(b"x", "../../etc/passwd")
    path = uploads.path_for(file_id)
    assert path.name == "passwd"
    assert path.parent.parent.name == "uploads"  # still inside uploads/<file_id>


def test_path_for_unknown_file_id_raises(uploads):
    with pytest.raises(FileNotFoundError):
        uploads.path_for("nope-not-there")
    assert uploads.filename_for("nope-not-there") is None


def test_two_uploads_get_distinct_ids(uploads):
    a = uploads.save(b"a", "a.txt")
    b = uploads.save(b"b", "b.txt")
    assert a != b
    assert uploads.path_for(a).read_bytes() == b"a"
    assert uploads.path_for(b).read_bytes() == b"b"
