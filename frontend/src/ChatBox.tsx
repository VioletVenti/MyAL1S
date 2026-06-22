// Agent chat (the LLM path), upgraded in P1:
//   - model picker (dropdown from /api/models, passed per request)
//   - collapsible 工具调用/思考 trace per assistant turn
//   - 新对话 (start a fresh thread) + 历史会话 (reopen a past conversation)
// Multi-turn history is persisted backend-side (message_history=); this box
// holds the local message list for the current conversation.

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type ChatTraceEntry,
  type ConversationSummary,
  deleteConversation,
  getConversation,
  getModels,
  listConversations,
  sendChat,
} from "./api";

interface Msg {
  role: "user" | "assistant";
  text: string;
  trace?: ChatTraceEntry[];
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [models, setModels] = useState<{ label: string; model: string }[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      /* keep stale list */
    }
  }, []);

  // Load the model picker once; default to the first entry.
  useEffect(() => {
    getModels()
      .then((r) => {
        setModels(r.models);
        if (r.models.length > 0) setModel(r.models[0].model);
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await sendChat(text, { model: model ?? undefined, conversation_id: conversationId ?? undefined });
      setConversationId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", text: res.reply, trace: res.trace }]);
      void refreshConversations();
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `出错了：${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  };

  const newConversation = () => {
    setMessages([]);
    setConversationId(null);
  };

  const openConversation = async (id: string) => {
    try {
      const { messages: hist } = await getConversation(id);
      setConversationId(id);
      setMessages(hist.map((m) => ({ role: m.role, text: m.content ?? "" })));
    } catch (err) {
      setMessages([{ role: "assistant", text: `加载历史失败：${String(err)}` }]);
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      if (id === conversationId) {
        setConversationId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch (err) {
      setMessages([{ role: "assistant", text: `删除失败：${String(err)}` }]);
    }
  };

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <select
          className="model-picker"
          value={model ?? ""}
          onChange={(e) => setModel(e.target.value)}
          title="选择模型"
        >
          {models.length === 0 && <option value="">（模型列表为空）</option>}
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={newConversation} title="开始新对话">
          + 新对话
        </button>
      </div>

      {conversations.length > 0 && (
        <details className="history">
          <summary>历史会话（{conversations.length}）</summary>
          <ul className="history-list">
            {conversations.map((c) => (
              <li key={c.id} className={c.id === conversationId ? "active" : ""}>
                <button className="ghost history-item" onClick={() => void openConversation(c.id)}>
                  {c.title ?? "(未命名)"}
                </button>
                <button
                  className="ghost danger hist-del"
                  title="删除该会话"
                  onClick={() => void removeConversation(c.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="messages">
        {messages.length === 0 && (
          <p className="muted">问点什么，例如「这周有哪些作业，按 DDL 排序」</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            {m.trace && m.trace.length > 0 && <TraceView trace={m.trace} />}
          </div>
        ))}
        {busy && <div className="msg assistant muted">思考中…</div>}
      </div>

      <form className="composer" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="向校园助手提问…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}

/** Collapsible 工具调用 / 思考 trace for one assistant turn. */
function TraceView({ trace }: { trace: ChatTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="trace" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>工具调用 / 思考（{trace.length}）</summary>
      <ul className="trace-list">
        {trace.map((t, i) => (
          <li key={i} className={`trace-${t.type}`}>
            <span className="trace-tool">{t.type === "tool_call" ? "→ 调用" : "← 返回"} {t.tool}</span>
            {t.args !== undefined && <pre>{typeof t.args === "string" ? t.args : JSON.stringify(t.args)}</pre>}
            {t.content !== undefined && <pre>{t.content}</pre>}
          </li>
        ))}
      </ul>
    </details>
  );
}
