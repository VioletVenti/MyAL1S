// Agent chat (the LLM path), upgraded in P1:
//   - model picker (dropdown from /api/models, passed per request)
//   - collapsible 工具调用/思考 trace per assistant turn
//   - 新对话 (start a fresh thread) + 历史会话 (reopen a past conversation)
// Multi-turn history is persisted backend-side (message_history=); this box
// holds the local message list for the current conversation.

import { type FormEvent, type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type Approval,
  type ChatTraceEntry,
  type ConversationSummary,
  type UploadResult,
  decideApproval,
  deleteConversation,
  fetchApprovals,
  getConversation,
  getModels,
  listConversations,
  sendChat,
  uploadAttachment,
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
  // P2: a chat-attached file. Held until sent; the agent gets its opaque file_id
  // (never a path) so it can pass it to submit_assignment.
  const [attachment, setAttachment] = useState<UploadResult | null>(null);
  const [attaching, setAttaching] = useState(false);
  const attachRef = useRef<HTMLInputElement>(null);
  // Pending write approvals — surfaced as inline banners above the composer.
  // The agent path creates them (agent.run ends); the user confirms here, in the
  // chat, where the request originated. UI-direct submits don't create these.
  const [pending, setPending] = useState<Approval[]>([]);

  const refreshPending = useCallback(async () => {
    try {
      const env = await fetchApprovals("pending");
      setPending(env.status === "ok" ? env.data.approvals : []);
    } catch {
      /* keep stale */
    }
  }, []);

  async function onAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setAttaching(true);
    try {
      setAttachment(await uploadAttachment(file));
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `附件上传失败：${String(err)}` }]);
    } finally {
      setAttaching(false);
    }
  }

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

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  // Slow poll for pending approvals: the agent run that creates one has already
  // ended, and a pending may also arrive from another tab. Event-driven refresh
  // (after send / after decide) is primary; this 8s tick is the backstop.
  useEffect(() => {
    const id = setInterval(refreshPending, 8_000);
    return () => clearInterval(id);
  }, [refreshPending]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await sendChat(text, {
        model: model ?? undefined,
        conversation_id: conversationId ?? undefined,
        attachment_file_id: attachment?.file_id,
      });
      setConversationId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", text: res.reply, trace: res.trace }]);
      setAttachment(null); // one-shot: the file_id was handed to the agent this turn
      void refreshConversations();
      void refreshPending(); // the agent may have just created a pending approval
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `出错了：${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  };

  // Per-approval message shown on its banner (e.g. a confirm whose execution hit
  // needs_otp — the session expired between request and approve). Cleared on a
  // successful refresh. Keyed by approval id.
  const [approvalMsg, setApprovalMsg] = useState<Record<string, string>>({});

  const decide = async (approvalId: string, decision: "confirm" | "deny") => {
    try {
      const res = await decideApproval(approvalId, decision);
      const status = (res as { status?: string }).status;
      // A confirm that dispatches but the session expired → needs_otp. The row
      // stays pending (not executed), so without surfacing this the banner just
      // silently redraws and the user is left guessing. Tell them to log in.
      if (decision === "confirm" && status === "needs_otp") {
        setApprovalMsg((m) => ({ ...m, [approvalId]: "需先登录教学网（顶部 OTP 登录一次）再确认执行。" }));
      } else {
        setApprovalMsg((m) => {
          if (!(approvalId in m)) return m;
          const next = { ...m };
          delete next[approvalId];
          return next;
        });
      }
    } catch {
      setApprovalMsg((m) => ({ ...m, [approvalId]: "确认失败，请重试。" }));
    } finally {
      void refreshPending();
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
        <div className="history-always">
          <span className="history-head">
            <span className="history-clock" aria-hidden>🕒</span> 历史会话（{conversations.length}）
          </span>
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
        </div>
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

      {pending.length > 0 && (
        <div className="approval-banners">
          {pending.map((a) => (
            <div key={a.id} className="approval-banner">
              <div className="approval-banner-main">
                <span className="approval-banner-title">{a.summary}</span>
                {a.filename && <span className="approval-banner-file">📎 {a.filename}</span>}
                {approvalMsg[a.id] && <span className="approval-banner-msg">{approvalMsg[a.id]}</span>}
              </div>
              <span className="approval-banner-actions">
                <button onClick={() => void decide(a.id, "confirm")}>确认执行</button>
                <button className="ghost danger" onClick={() => void decide(a.id, "deny")}>
                  拒绝
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <input ref={attachRef} type="file" hidden onChange={onAttach} />
        <button
          type="button"
          className="ghost"
          title="添加附件（交作业时用）"
          disabled={busy || attaching}
          onClick={() => attachRef.current?.click()}
        >
          {attaching ? "…" : "📎"}
        </button>
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
      {attachment && (
        <div className="attach-chip">
          📎 {attachment.filename}
          <button type="button" className="linkish" onClick={() => setAttachment(null)} title="移除附件">
            ✕
          </button>
        </div>
      )}
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
