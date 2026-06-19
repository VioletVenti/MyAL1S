import ChatBox from "./ChatBox";
import Dashboard from "./Dashboard";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>MyAL1S</h1>
        <span className="subtitle">PKU 校园信息终端助手</span>
      </header>
      <main className="layout">
        <Dashboard />
        <aside className="sidebar">
          <h2>对话</h2>
          <ChatBox />
        </aside>
      </main>
    </div>
  );
}
