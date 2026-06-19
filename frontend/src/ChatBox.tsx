import { type FormEvent, useState } from "react";
import { sendChat } from "./api";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const reply = await sendChat(text);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `出错了：${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="messages">
        {messages.length === 0 && (
          <p className="muted">问点什么，例如「这周有哪些作业，按 DDL 排序」</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
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
