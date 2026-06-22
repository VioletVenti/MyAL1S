// Custom to-do items (e.g. from a course WeChat group that can't sync from the
// teaching network). Exports:
//   - <CustomItemForm>   create form (title/due/course/source/note)
//   - <CustomTodoRow>    one row over a /api/todo custom item: done / edit / delete
// Custom items always appear in 待办 + on the calendar at their due date;
// marking one done removes it from 待办 (the item is retained).

import { type FormEvent, useState } from "react";
import type { TodoItem } from "./api";
import { createCustomItem, deleteCustomItem, updateCustomItem } from "./api";

/** Create form. Calls onCreated after a successful create so the parent refreshes. */
export function CustomItemForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [course, setCourse] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await createCustomItem({
        title: title.trim(),
        due: due || null,
        course: course || null,
        source: source || null,
        note: note || null,
      });
      setTitle(""); setDue(""); setCourse(""); setSource(""); setNote("");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="custom-form" onSubmit={submit}>
      <input
        className="cf-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="新增自定义待办（如：交报告、微信群通知）"
        disabled={busy}
      />
      <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="截止 (如 2026-06-30)" disabled={busy} />
      <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="课程（可选）" disabled={busy} />
      <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="来源（如 微信群）" disabled={busy} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" disabled={busy} />
      <button type="submit" disabled={busy || !title.trim()}>{busy ? "…" : "添加"}</button>
    </form>
  );
}

/** One custom-item row (over a /api/todo TodoItem): mark-done, inline edit, delete. */
export function CustomTodoRow({
  item,
  onChanged,
}: {
  item: TodoItem;
  onChanged: () => void;
}) {
  const id = item.custom_id;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [due, setDue] = useState(item.date ?? "");
  const [course, setCourse] = useState(item.course ?? "");
  const [source, setSource] = useState(item.source ?? "");
  const [note, setNote] = useState(item.note ?? "");

  if (id === undefined) return null;

  async function save() {
    if (id === undefined) return;
    setBusy(true);
    try {
      await updateCustomItem(id, {
        title: title.trim() || undefined,
        due: due || null,
        course: course || null,
        source: source || null,
        note: note || null,
      });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function markDone() {
    if (id === undefined) return;
    await updateCustomItem(id, { done: true });
    onChanged();
  }

  async function del() {
    if (id === undefined) return;
    await deleteCustomItem(id);
    onChanged();
  }

  if (editing) {
    return (
      <li className="custom-edit">
        <input className="cf-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="截止" disabled={busy} />
        <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="课程" disabled={busy} />
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="来源" disabled={busy} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注" disabled={busy} />
        <button onClick={() => void save()} disabled={busy}>保存</button>
        <button className="ghost" onClick={() => setEditing(false)} disabled={busy}>取消</button>
      </li>
    );
  }

  return (
    <li>
      <span className="cal-item-kind">自定义{item.source ? ` · ${item.source}` : ""}</span>
      <span className="title">{item.title}</span>
      <span className="muted">{item.course}</span>
      <span className="ddl">{item.date ?? ""}</span>
      <span className="row-actions">
        <button className="ghost" onClick={() => void markDone()} title="标记完成">✓</button>
        <button className="ghost" onClick={() => setEditing(true)} title="编辑">✎</button>
        <button className="ghost danger" onClick={() => void del()} title="删除">✕</button>
      </span>
    </li>
  );
}
