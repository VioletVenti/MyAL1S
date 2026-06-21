// A top-level React error boundary. WITHOUT one, a thrown error in any
// component unmounts the whole tree (React 19 has no default boundary) — the
// app goes to a blank background with no clue why. This boundary catches render
// errors and shows a visible message + the error, so the next crash is
// diagnosable instead of invisible. (This is exactly what the P1 blank-page bug
// lacked: a contract mismatch in NewNoticesPanel unmounted everything silently.)
//
// Intentionally a class component — React still requires classes for boundaries.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface server-side (if ever SSR) and in the browser console.
    console.error("[ErrorBoundary] render crash:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app error-boundary">
          <header className="app-header">
            <h1>MyAL1S</h1>
            <span className="subtitle">渲染出错</span>
          </header>
          <main className="layout">
            <div className="panel">
              <div className="panel-body">
                <p className="error">页面渲染时崩溃了（未导致整个界面消失）。</p>
                <p className="muted small">错误：{String(this.state.error.message)}</p>
                <pre>{this.state.error.stack}</pre>
                <button onClick={() => this.setState({ error: null })}>重试</button>
              </div>
            </div>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}
