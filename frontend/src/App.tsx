import { type FormEvent, useCallback, useEffect, useState } from "react";
import ChatBox from "./ChatBox";
import Dashboard from "./Dashboard";
import { login } from "./api";
import { StarProvider } from "./stars";

/** One-time login: enter the OTP once at startup; the session is then reused. */
function LoginBar({ onConnected }: { onConnected: () => void }) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = otp.trim();
    if (!code || busy) return;
    setBusy(true);
    setMsg(null);
    const env = await login(code);
    setBusy(false);
    setOtp("");
    if (env.status === "ok") {
      const { portal, blackboard } = env.data;
      if (portal && blackboard) {
        setMsg({ kind: "ok", text: "已全部连接（课表 + 作业/成绩）✓" });
      } else if (portal) {
        setMsg({ kind: "info", text: "课表已连接 ✓ 作业/成绩请再输一次新令牌 (OTP)。" });
      } else if (blackboard) {
        setMsg({ kind: "info", text: "作业/成绩已连接 ✓ 课表请再输一次新令牌 (OTP)。" });
      } else {
        setMsg({ kind: "err", text: "未连接，请重试。" });
      }
      onConnected();
    } else if (env.status === "needs_otp") {
      setMsg({ kind: "info", text: "请输入手机令牌 (OTP)" });
    } else {
      setMsg({ kind: "err", text: `登录失败：${env.message}` });
    }
  }

  return (
    <form className="loginbar" onSubmit={submit}>
      <span className="loginbar-label">连接教学网（开启时输一次手机令牌 OTP，之后免输）：</span>
      <input
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        placeholder="OTP 6 位码"
        inputMode="numeric"
        disabled={busy}
      />
      <button type="submit" disabled={busy || !otp.trim()}>
        {busy ? "登录中…" : "登录"}
      </button>
      {msg && <span className={`loginmsg ${msg.kind}`}>{msg.text}</span>}
    </form>
  );
}

export default function App() {
  // Bumping refreshKey makes the dashboard panels + calendar re-fetch.
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(bump, 60_000); // pku3b caches 1h, so repeated calls are cheap
    return () => clearInterval(id);
  }, [autoRefresh, bump]);

  return (
    <StarProvider onChange={bump}>
      <div className="app">
        <header className="app-header">
          <h1>MyAL1S</h1>
          <span className="subtitle">PKU 校园信息终端助手</span>
          <span className="toolbar">
            <button
              className={autoRefresh ? "" : "ghost"}
              onClick={() => setAutoRefresh((v) => !v)}
              title="每 60 秒自动刷新面板"
            >
              {autoRefresh ? "自动刷新：开" : "自动刷新：关"}
            </button>
          </span>
        </header>
        <LoginBar onConnected={bump} />
        <main className="layout">
          <Dashboard refreshKey={refreshKey} bump={bump} />
          <aside className="sidebar">
            <h2>对话</h2>
            <ChatBox />
          </aside>
        </main>
      </div>
    </StarProvider>
  );
}
