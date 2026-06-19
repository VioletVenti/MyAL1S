# MyAL1S

> PKU 校园信息终端助手 —— 在成熟的教学网爬虫 [`pku3b`](https://github.com/VioletVenti/pku3b) 之上，构建一个**带 LLM agent、自主设计 GUI** 的校园信息终端助手。

**状态：** ✅ **P0 竖切已打通**（`pku3b mcp` → FastAPI/PydanticAI → React 仪表盘 + 对话框）。后续 P1–P4（持久化、写操作+权限矩阵、外部论坛、加固）见 roadmap。

---

## 这是什么

`pku3b` 已经能在命令行单点查询教学网（课表 / 作业 / 成绩 / 公告 / 回放）。MyAL1S 在它之上多做三件事：

- **智能层** — 自然语言查询、跨数据源分析与总结、多步规划（如「这周哪几门作业撞 DDL，帮我排优先级」）。
- **聚合层** — 把分散的教学网信息整合成个人化面板（课表、大事记时间线、收藏）。
- **可控写操作** — 交作业 / 选课 / 发帖等副作用操作，受用户配置的权限矩阵约束（默认「需确认」）。

## 目标架构（简）

```
浏览器前端 (React/Vue/Svelte)
      │  HTTP 取数 + WebSocket（agent 流式/确认回路）
Python 后端 (FastAPI + PydanticAI)
      │  · 确定性取数 endpoint（直转 MCP 工具，不过 LLM）
      │  · agent（工具=MCP 工具，含权限闸）
      │  MCP over stdio (JSON-RPC 2.0)
pku3b MCP server (Rust + compio，新增 `pku3b mcp` 子命令)   ← 本仓库的 pku3b 子模块
```

核心解耦原则：**确定性数据（课表/成绩/作业/公告）绝不经过 LLM**；agent 只负责分析、对话与多步规划。compio (pku3b) 与后端之间通过**进程边界 + stdio** 通信，互不污染运行时。

设计文档：
- 架构与决策（全局）：[`Plan/2026-06-19_campus-assistant-architecture-plan.md`](Plan/2026-06-19_campus-assistant-architecture-plan.md)
- P0 实施计划：[`Plan/2026-06-19_p0-vertical-slice-implementation-plan.md`](Plan/2026-06-19_p0-vertical-slice-implementation-plan.md)
- 维护者地图（seam / 数据路径）：[`docs/architecture.md`](docs/architecture.md)
- 开发与「如何新增一个 MCP 工具」：[`docs/development.md`](docs/development.md)
- MCP 协议契约：[`docs/mcp-protocol.md`](docs/mcp-protocol.md)

## 快速开始（3 个终端）

```bash
# 1) 构建 MCP server 并登录一次（预热 ua.json，P0 假设会话已热）
cd pku3b && cargo build --release --features mcp && ./target/release/pku3b init && ./target/release/pku3b ct
# 2) 后端
cd ../backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && cp .env.example .env  # 填 ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
# 3) 前端
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

详见 [`docs/development.md`](docs/development.md)。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `pku3b/` | **git 子模块** → [VioletVenti/pku3b](https://github.com/VioletVenti/pku3b)（Rust + compio 教学网爬虫 + 新增 `pku3b mcp` server） |
| `backend/` | Python FastAPI + PydanticAI：MCP 客户端、确定性取数 endpoint、agent 对话 |
| `frontend/` | Vite + React + TS：确定性仪表盘 + 对话框 |
| `docs/` | 架构 / 开发 / MCP 协议文档 |
| `Plan/` | 架构与各阶段实现计划 |

## 克隆（注意子模块）

```bash
git clone --recurse-submodules https://github.com/VioletVenti/MyAL1S.git
# 已经 clone 过：
git submodule update --init --recursive
```

## 安全须知

本仓库公开。MVP 阶段沿用 pku3b 的 `cfg.toml`（**明文**学号/密码）与 `ua.json`（登录 cookie）。这些文件已在 `.gitignore` 中屏蔽，**切勿**提交任何凭据、`.env`、SQLite 数据库或 cookie 缓存。

## 致谢

数据基座 [`pku3b`](https://github.com/sshwy/pku3b) by Weiyao Huang，MIT License。
