"""The persistence layer (**Seam 5**) — a single embedded SQLite file.

Holds five domains behind one async connection:

- **stars** — a user-curated promotion: an assignment or announcement the user
  flagged as important/undone, so it surfaces in the 待办 module and on the
  calendar. Keyed by `(source, item_id)`; stores a **snapshot** (title/course/
  date) so a starred item still renders if it drops off the live list. `date` is
  the calendar/sort anchor — an assignment's deadline or an announcement's
  publish time.
- **custom_items** — user-created to-dos (e.g. from a course WeChat group that
  can't sync from the teaching network). Richer shape (title/due/note/course/
  source); always shown in 待办 + calendar.
- **seen_ids** — the watermark for the 新到通知 panel. `new` = a live id not in
  this set; `mark_seen` merges the current live ids in.
- **conversations / messages** — persisted multi-turn chat history. Each message
  row carries the serialized pydantic-ai `ModelMessage` list slice so a thread
  can be resumed exactly via `message_history=`.
- **snapshots** — a generic key→envelope cache. The deterministic routes write a
  snapshot on every successful live fetch and read it back as a **stale
  fallback** when the live call returns `needs_otp` / `error` — so the dashboard
  still shows the last good data after a backend restart or when not logged in.

**Why one wide module, not four tiny ones:** the deep core — one connection, one
schema-init, one file path — is shared. Splitting into StarStore / ItemStore /
SeenStore / ConversationStore would create four shallow modules each repeating
the connection lifecycle. One Store with grouped methods keeps that lifecycle in
exactly one place. The wide surface is the price; the alternative is worse.

The Store knows nothing about live teaching-network data — the seen-id *diff* is
the Composer's job (Seam 6), not the Store's. The connection is owned by the app
lifespan (`main.py`); tests pass a temp file and use the Store as an async
context manager.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from pydantic_ai.messages import ModelMessage, ModelMessagesTypeAdapter

# The four star-able / diff-able sources. Kept as plain strings (not an enum) so
# the DB schema and wire shapes stay stringly-typed and forward-compatible.
SOURCE_ASSIGNMENT = "assignment"
SOURCE_ANNOUNCEMENT = "announcement"


_SCHEMA = """
CREATE TABLE IF NOT EXISTS stars (
    source     TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    title      TEXT,
    course     TEXT,
    date       TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source, item_id)
);

CREATE TABLE IF NOT EXISTS custom_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    due        TEXT,
    note       TEXT,
    course     TEXT,
    source     TEXT,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_ids (
    source  TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (source, item_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
    key        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT,
    pydantic_json   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
"""


def _now() -> str:
    """UTC timestamp as ISO-8601. (timezone-aware; stable across runs.)"""
    return datetime.now(timezone.utc).isoformat()


def _serialize_model_messages(msgs: list[ModelMessage]) -> str:
    """Serialize a pydantic-ai message list for exact round-trip replay."""
    return ModelMessagesTypeAdapter.dump_json(msgs).decode("utf-8")


def _deserialize_model_messages(raw: str) -> list[ModelMessage]:
    """Inverse of `_serialize_model_messages`."""
    return ModelMessagesTypeAdapter.validate_json(raw)


class Store:
    """Async persistence over one SQLite file.

    Construct with a path; `connect()` (or the async context manager) opens the
    connection and idempotently applies the schema. The same Store instance is
    reused for the app lifetime (the connection is held open).
    """

    def __init__(self, path: str) -> None:
        self._path = path
        self._db: aiosqlite.Connection | None = None

    # ---- lifecycle --------------------------------------------------------

    async def connect(self) -> None:
        self._db = await aiosqlite.connect(self._path)
        # Cascade-delete messages when a conversation is deleted, and keep the
        # file tidy across the long-lived connection.
        await self._db.execute("PRAGMA foreign_keys = ON")
        await self._db.executescript(_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def __aenter__(self) -> "Store":
        await self.connect()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    @property
    def _c(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("Store not connected — call connect() or use it as an async context manager")
        return self._db

    # ---- stars ------------------------------------------------------------

    async def star(
        self,
        source: str,
        item_id: str,
        *,
        title: str | None = None,
        course: str | None = None,
        date: str | None = None,
    ) -> None:
        """Record (or refresh the snapshot of) a starred item. Idempotent.

        `date` is the calendar/sort anchor: an assignment's deadline or an
        announcement's publish time (RFC3339 string, or None).
        """
        await self._c.execute(
            """INSERT INTO stars (source, item_id, title, course, date, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(source, item_id) DO UPDATE SET
                 title = excluded.title,
                 course = excluded.course,
                 date = excluded.date""",
            (source, item_id, title, course, date, _now()),
        )
        await self._db.commit()

    async def unstar(self, source: str, item_id: str) -> None:
        await self._c.execute(
            "DELETE FROM stars WHERE source = ? AND item_id = ?",
            (source, item_id),
        )
        await self._db.commit()

    async def list_stars(self, source: str | None = None) -> list[dict]:
        """Starred items. If `source` is given, filter to it."""
        if source is None:
            cur = await self._c.execute(
                "SELECT source, item_id, title, course, date, created_at FROM stars"
            )
        else:
            cur = await self._c.execute(
                "SELECT source, item_id, title, course, date, created_at FROM stars WHERE source = ?",
                (source,),
            )
        rows = await cur.fetchall()
        return [
            {"source": r[0], "item_id": r[1], "title": r[2], "course": r[3], "date": r[4], "created_at": r[5]}
            for r in rows
        ]

    async def is_starred(self, source: str, item_id: str) -> bool:
        cur = await self._c.execute(
            "SELECT 1 FROM stars WHERE source = ? AND item_id = ?", (source, item_id)
        )
        return (await cur.fetchone()) is not None

    # ---- custom items -----------------------------------------------------

    async def add_item(
        self,
        *,
        title: str,
        due: str | None = None,
        note: str | None = None,
        course: str | None = None,
        source: str | None = None,
    ) -> int:
        """Create a custom to-do item; return its id."""
        cur = await self._c.execute(
            """INSERT INTO custom_items (title, due, note, course, source, done, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)""",
            (title, due, note, course, source, _now()),
        )
        await self._db.commit()
        return cur.lastrowid or 0

    async def update_item(
        self,
        item_id: int,
        *,
        title: str | None = None,
        due: str | None = None,
        note: str | None = None,
        course: str | None = None,
        source: str | None = None,
        done: bool | None = None,
    ) -> bool:
        """Patch a custom item. Only provided fields are changed. Returns
        whether a row was updated."""
        sets: list[str] = []
        vals: list[Any] = []
        for col, val in (("title", title), ("due", due), ("note", note), ("course", course), ("source", source)):
            if val is not None:
                sets.append(f"{col} = ?")
                vals.append(val)
        if done is not None:
            sets.append("done = ?")
            vals.append(1 if done else 0)
        if not sets:
            return False
        vals.append(item_id)
        cur = await self._c.execute(
            f"UPDATE custom_items SET {', '.join(sets)} WHERE id = ?", vals
        )
        await self._db.commit()
        return cur.rowcount > 0

    async def delete_item(self, item_id: int) -> bool:
        cur = await self._c.execute("DELETE FROM custom_items WHERE id = ?", (item_id,))
        await self._db.commit()
        return cur.rowcount > 0

    async def list_items(self) -> list[dict]:
        cur = await self._c.execute(
            "SELECT id, title, due, note, course, source, done, created_at FROM custom_items ORDER BY id"
        )
        rows = await cur.fetchall()
        return [
            {
                "id": r[0],
                "title": r[1],
                "due": r[2],
                "note": r[3],
                "course": r[4],
                "source": r[5],
                "done": bool(r[6]),
                "created_at": r[7],
            }
            for r in rows
        ]

    # ---- seen ids ---------------------------------------------------------

    async def seen_ids(self, source: str) -> set[str]:
        """The set of item ids already seen for a source (the diff baseline)."""
        cur = await self._c.execute("SELECT item_id FROM seen_ids WHERE source = ?", (source,))
        rows = await cur.fetchall()
        return {r[0] for r in rows}

    async def mark_seen(self, source: str, ids: list[str]) -> None:
        """Merge the given ids into the seen set for a source. Idempotent."""
        if not ids:
            return
        await self._c.executemany(
            "INSERT OR IGNORE INTO seen_ids (source, item_id) VALUES (?, ?)",
            [(source, i) for i in ids],
        )
        await self._db.commit()

    # ---- snapshots (cached envelopes) -------------------------------------
    # A generic key→envelope cache. The deterministic routes write a snapshot on
    # every successful live fetch and read it back as a stale fallback when the
    # live call returns needs_otp / error — so the dashboard still shows the
    # last good data after a backend restart or when not logged in. The Store
    # treats payloads as opaque JSON blobs; it knows nothing about their shape.

    async def put_snapshot(self, key: str, payload: Any) -> None:
        """Upsert a cached envelope under `key`. `payload` is JSON-serialized."""
        import json as _json

        await self._c.execute(
            """INSERT INTO snapshots (key, payload, fetched_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 payload = excluded.payload,
                 fetched_at = excluded.fetched_at""",
            (key, _json.dumps(payload, ensure_ascii=False), _now()),
        )
        await self._db.commit()

    async def get_snapshot(self, key: str) -> dict | None:
        """Return `{payload, fetched_at}` for a cached key, or None if absent.
        `payload` is the parsed envelope (a dict)."""
        import json as _json

        cur = await self._c.execute(
            "SELECT payload, fetched_at FROM snapshots WHERE key = ?", (key,)
        )
        row = await cur.fetchone()
        if row is None:
            return None
        raw, fetched_at = row
        try:
            payload = _json.loads(raw)
        except (ValueError, TypeError):
            return None
        return {"payload": payload, "fetched_at": fetched_at}

    async def snapshot_keys(self) -> list[str]:
        """All cached keys (handy for a health glance / debugging)."""
        cur = await self._c.execute("SELECT key FROM snapshots ORDER BY key")
        return [r[0] for r in await cur.fetchall()]

    # ---- conversations ----------------------------------------------------

    async def create_conversation(self, *, title: str | None = None) -> str:
        """Create a new conversation; return its id."""
        cid = uuid.uuid4().hex
        now = _now()
        await self._c.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (cid, title, now, now),
        )
        await self._db.commit()
        return cid

    async def list_conversations(self) -> list[dict]:
        cur = await self._c.execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        )
        rows = await cur.fetchall()
        return [
            {"id": r[0], "title": r[1], "created_at": r[2], "updated_at": r[3]}
            for r in rows
        ]

    async def conversation_exists(self, cid: str) -> bool:
        cur = await self._c.execute("SELECT 1 FROM conversations WHERE id = ?", (cid,))
        return (await cur.fetchone()) is not None

    async def touch_conversation(self, cid: str, *, title: str | None = None) -> None:
        """Bump a conversation's updated_at (and optionally its title)."""
        if title is not None:
            await self._c.execute(
                "UPDATE conversations SET updated_at = ?, title = ? WHERE id = ?",
                (_now(), title, cid),
            )
        else:
            await self._c.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?", (_now(), cid)
            )
        await self._db.commit()

    async def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str | None,
        pydantic_messages: list[ModelMessage],
    ) -> int:
        """Append a message row (role + display content + the serialized
        pydantic-ai message slice). Returns the row id."""
        cur = await self._c.execute(
            """INSERT INTO messages (conversation_id, role, content, pydantic_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (conversation_id, role, content, _serialize_model_messages(pydantic_messages), _now()),
        )
        await self._db.commit()
        return cur.lastrowid or 0

    async def get_history(self, conversation_id: str) -> list[ModelMessage]:
        """Concatenate every message's pydantic slice into one replay list, in
        order — exactly what `Agent.run(message_history=...)` expects."""
        cur = await self._c.execute(
            "SELECT pydantic_json FROM messages WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cur.fetchall()
        history: list[ModelMessage] = []
        for (raw,) in rows:
            history.extend(_deserialize_model_messages(raw))
        return history

    async def get_messages(self, conversation_id: str) -> list[dict]:
        """Display-shaped messages (role + content), no pydantic internals."""
        cur = await self._c.execute(
            "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cur.fetchall()
        return [
            {"id": r[0], "role": r[1], "content": r[2], "created_at": r[3]}
            for r in rows
        ]

    async def delete_conversation(self, cid: str) -> bool:
        cur = await self._c.execute("DELETE FROM conversations WHERE id = ?", (cid,))
        await self._db.commit()
        return cur.rowcount > 0

    # ---- introspection (tests / debugging) --------------------------------

    async def counts(self) -> dict[str, int]:
        """Row counts per table — handy for tests and a health glance."""
        out: dict[str, int] = {}
        for table in ("stars", "custom_items", "seen_ids", "snapshots", "conversations", "messages"):
            cur = await self._c.execute(f"SELECT COUNT(*) FROM {table}")
            out[table] = (await cur.fetchone())[0]
        return out
