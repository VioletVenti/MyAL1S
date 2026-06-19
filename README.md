# MyAL1S

> PKU 校园信息终端助手 —— 在成熟的教学网爬虫 [`pku3b`](https://github.com/VioletVenti/pku3b) 之上，构建一个**带 LLM agent、自主设计 GUI** 的校园信息终端助手。

**状态：** 🚧 脚手架阶段。目前仓库只含基础（pku3b 子模块）与设计文档；P0 竖切尚未实现。

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

完整设计与决策记录见 [`Plan/2026-06-19_campus-assistant-architecture-plan.md`](Plan/2026-06-19_campus-assistant-architecture-plan.md)。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `pku3b/` | **git 子模块** → [VioletVenti/pku3b](https://github.com/VioletVenti/pku3b)（Rust + compio 教学网爬虫，本助手的数据/MCP 基座） |
| `Plan/` | 架构与实施计划、各阶段实现计划 |

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
