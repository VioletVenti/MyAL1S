# Plan: PKU 校园信息终端助手 — 架构与实施计划

**Status:** APPROVED (design locked via /grilling) · 执行由用户另行安排
**Date:** 2026-06-19
**Foundation:** `project/MyAgent/pku3b` (Rust + compio 教学网爬虫, v0.14.0)
**Session log:** `quality_reports/session_logs/2026-06-19_pku3b-crawler-foundation-review.md`

---

## 1. 目标 (Vision)

在 pku3b 这套成熟的 PKU 爬虫之上，构建一个**带 LLM agent 的、自主设计 GUI 的校园信息终端助手**。
相对 pku3b 已有的 CLI 单点查询，本助手要多解决：
- **智能层**：自然语言查询、跨数据源分析/总结、多步规划（如"这周哪几门作业撞 DDL，帮我排优先级"）。
- **聚合层**：把分散的教学网信息 + 外部论坛整合成个人化面板（课表、大事记时间线、收藏的校内资源、论坛收藏）。
- **可控写操作**：交作业 / 选课 / 发帖等副作用操作，受用户配置的权限矩阵约束。

---

## 2. 锁定的设计决策 (Locked Decisions)

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 核心定位 | LLM agent + 自主 GUI | 不只是聚合/TUI；agent 是核心价值 |
| 2 | 集成边界 | pku3b 作为**本地服务**，**纯 MCP** 协议 | 解耦 compio；agent 框架自由选 |
| 3 | MCP 消费模式 | 一套 MCP 工具目录，**两个消费者**：GUI 确定性调用（画面板）+ agent LLM 驱动调用（分析/对话） | 确定性取数（课表/成绩/作业/公告）**绝不经 LLM** |
| 4 | 数据源 | 教学网（pku3b 已有）+ **北大树洞**（IAAA 复用）+ 课程评测/其他（新爬虫） | 树洞走 IAAA → 复用认证护城河 |
| 5 | GUI | **浏览器 web 前端**（React/Vue/Svelte） | 自主设计自由度最高 |
| 6 | 后端 | **Python (FastAPI)** 托管 agent + MCP 客户端 + LLM + 登录态 | agent 生态成熟 |
| 7 | agent 权限 | **用户逐操作配权限矩阵**（自动/需确认/禁止），默认需确认 | 上限=全自主，默认=安全；契合"加限定" |
| 8 | agent 框架 | **PydanticAI**（现成 OSS） | 原生 MCP 客户端、类型安全、内置工具审批/human-in-the-loop |
| 9 | MCP server 形态 | **stdio 子进程**：后端拉起 `pku3b mcp`，MCP over stdio | 最标准；compio 内手写 JSON-RPC，不引 rmcp/tokio |
| 10 | LLM 提供方 | **云端默认 Claude + provider-agnostic 可换** | 工具调用最可靠；PydanticAI 易换厂商；用户自带 key |
| 11 | 凭据存储 | **MVP 复用 pku3b 的 cfg.toml + ua.json** | 最快跑通；密码沿用明文落盘，后续再加密 |
| 12 | 持久化 | **SQLite**（单文件嵌入式） | 单用户本地；收藏/大事记/对话史可 SQL 查询 |

---

## 3. 目标架构 (Target Architecture)

```
┌─────────────────────────────────────────────────────────┐
│  浏览器前端 (React/Vue/Svelte) — 自主设计 UI               │
│   · 仪表盘: 课表 / 作业 DDL / 成绩 / 公告 (确定性渲染)      │
│   · 大事记时间线 · 收藏 · 论坛收藏                          │
│   · 对话框 (agent)  · 权限矩阵设置页                        │
└───────────────┬─────────────────────────────────────────┘
                │ HTTP (REST 取数) + WebSocket (agent 流式/确认回路)
┌───────────────▼─────────────────────────────────────────┐
│  Python 后端 (FastAPI)                                    │
│   · MCP 客户端 (连 pku3b mcp 子进程)                       │
│   · PydanticAI agent (工具=MCP 工具, 含权限闸)             │
│   · LLM 调用 (Claude 默认, provider-agnostic)             │
│   · 登录态/OTP 编排 · SQLite (收藏/大事记/对话史)          │
│   · 确定性数据 endpoint (直转 MCP 工具, 不过 LLM)          │
└───────────────┬─────────────────────────────────────────┘
                │ MCP over stdio (JSON-RPC 2.0)
┌───────────────▼─────────────────────────────────────────┐
│  pku3b MCP server (Rust + compio, 新增 `pku3b mcp` 子命令) │
│   · 工具: 课表/作业/成绩/公告/回放 (复用现有 api::*)       │
│   · 工具: 树洞/课程评测 (新增爬虫)                         │
│   · 写工具: 交作业/选课/发帖 (标注 side-effect)            │
│   · 登录态: 复用 ua.json cookie 缓存                        │
└──────────────────────────────────────────────────────────┘
```

**运行时张力的化解**：compio (pku3b) 与 tokio (Python 无关，但若未来 Rust 侧用 rmcp 会冲突) 的矛盾，
通过**进程边界**消除——pku3b MCP server 是独立子进程，stdio 通信，内部纯 compio。

---

## 4. 工作分解 (Work Breakdown)

### A. pku3b MCP server (Rust / compio)
- **A1.** 新增 `src/cli/cmd_mcp.rs` + `Commands::Mcp` 子命令；`pku3b mcp` 进入 stdio JSON-RPC 循环。
- **A2.** 手写最小 MCP 实现（无 rmcp）：
  - `initialize` 握手、`tools/list`、`tools/call`、错误对象。
  - JSON-RPC over stdin/stdout，逐行或按 Content-Length 分帧（建议 LSP 风格 Content-Length）。
  - 在 compio 运行时内读 stdin（`compio::fs`/异步 stdin）。
- **A3.** 工具登记表：把 `api::Blackboard` / `Course` / `CourseAssignment` / `Portal` / `Syllabus` 现有方法
  包装成 MCP 工具，输入/输出用 serde JSON。复用现有结构体（`GradeRecord` 等）。
- **A4.** 工具元数据：每个工具标注 `readOnly` vs `sideEffect`（供后端权限矩阵识别）。
- **A5.** 登录态：沿用 `cookie_restore_path` → `ua.json`；首次/失效时触发 IAAA 登录。
  **OTP**：MCP 工具需暴露"需要 OTP"信号（结构化 error/中间态），不能在子进程里 `inquire` 阻塞。
- **A6.**（可选）保留 binary CLI 不动，`mcp` 只是新增子命令——对现有功能零破坏。

### B. 新增爬虫 (Rust / compio, 在 pku3b 内)
- **B1. 北大树洞**：走 IAAA（appid 待调研）→ 复用 `LowLevelClient` + `iaaa_oauth_login`。
  工具：列表/详情/我的关注收藏/搜索。
- **B2. 课程评测/其他**：认证与结构逐个调研（**TBD**，列为后续插件式数据源）。

### C. Python 后端 (FastAPI + PydanticAI)
- **C1.** MCP 客户端：用 PydanticAI 的 MCP 支持（或 `mcp` 官方 Python SDK）作为 stdio client，拉起 `pku3b mcp`。
- **C2.** agent：PydanticAI Agent，工具 = MCP 工具集；系统提示加"限定"（范围、安全、确定性取数走直连不走我）。
- **C3.** **权限闸**：拦截 `sideEffect` 工具调用 → 查权限矩阵 → 自动/弹确认(human-in-the-loop, 经 WS)/拒绝。
- **C4.** 确定性数据 API：`/api/coursetable` `/api/assignments` `/api/grades` 等，直接转 MCP 工具，**不经 LLM**。
- **C5.** 对话 API：`/api/chat`（WebSocket，流式 + 确认回路）。
- **C6.** OTP 编排：MCP 报"需 OTP" → 后端经 WS 向前端要 → 回传子进程。
- **C7.** LLM 配置：provider-agnostic，默认 Claude（最新 Claude 模型），用户自带 key。
- **C8.** SQLite 层：收藏、大事记 timeline、对话史、缓存。

### D. Web 前端 (React/Vue/Svelte)
- **D1.** 仪表盘（确定性取数渲染）：课表、作业 DDL、成绩、公告。
- **D2.** 大事记时间线（作业 DDL + 成绩变动 + 公告，后端聚合）。
- **D3.** 收藏 / 论坛收藏视图。
- **D4.** 对话框（agent，流式 + 确认弹窗）。
- **D5.** 权限矩阵设置页（逐操作：自动/需确认/禁止）。

### E. 横切关注点
- **E1. 权限矩阵**模型（操作类别 × 权限级别），后端枚举 sideEffect 工具自动生成默认项。
- **E2. 大事记聚合**：确定性代码（非 agent），定时或按需把多源数据归并成时间线。
- **E3.（后续）凭据加密**：从 MVP 的明文 cfg.toml 迁移到 OS keychain。

---

## 5. 关键技术风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| compio 内手写 MCP/stdio | A2 是新代码，无现成 crate | MCP 协议本身简单（JSON-RPC + 3 个方法）；先做最小握手+tools 跑通 |
| OTP 在 stdio 子进程无法交互弹窗 | 登录可能卡死 | 工具层把 OTP 需求结构化上抛，由后端→前端→回传（C6/A5） |
| 公告解析是 HTML 启发式 | 教学网改版易碎 | 成绩走 REST API 最稳；公告解析做容错+降级 |
| 树洞/课程评测认证&结构未知 | B1/B2 工作量不确定 | 列为调研项；树洞优先（IAAA 可复用），课程评测插件式后接 |
| 密码明文落盘 (MVP) | 安全隐患 | 明确标注为 MVP 临时；E3 后续 keychain |
| 写操作不可逆（误交/误选） | 严重 | 权限矩阵默认"需确认"；sideEffect 工具显式标注 |

---

## 6. 建议的分期路线 (Roadmap — 供参考，执行由用户另定)

> 用户表示后续执行另有计划，以下仅为依赖顺序建议，非强制。

- **P0 竖切（打通管道）**：`pku3b mcp`（几个只读工具）→ FastAPI+PydanticAI+MCP client → 极简 web（仪表盘+对话框）。验证 compio-stdio ↔ Python ↔ agent 整条链。
- **P1 数据面板**：教学网全部只读能力 + 大事记聚合 + SQLite 收藏。
- **P2 写操作 + 权限矩阵**：sideEffect 工具 + 权限闸 + 确认回路 + 设置页 + OTP 编排。
- **P3 外部论坛**：树洞爬虫（B1）接入；课程评测（B2）调研后接入。
- **P4 加固**：凭据加密（keychain）、错误降级、缓存策略调优。

---

## 7. 待定项 (Open / TBD)

- [ ] 北大树洞的 IAAA appid 与接口结构（需抓包调研）。
- [ ] 课程评测/其他站点的认证与数据结构。
- [ ] MCP stdio 分帧方式（Content-Length vs 行分隔）最终定型。
- [ ] 前端框架三选一（React / Vue / Svelte）——未在 grilling 中收敛。
- [ ] 大事记"变动检测"的触发方式（定时轮询 vs 打开时拉取）。
- [ ] 权限矩阵的操作类别粒度（按工具 vs 按语义分组）。
