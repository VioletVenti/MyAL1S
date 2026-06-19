# Plan: P0 竖切实现 — pku3b MCP server → FastAPI/PydanticAI → 极简 React web

**Status:** DRAFT（待批准）
**Date:** 2026-06-19
**Repo:** `VioletVenti/MyAL1S`（public）· pku3b 为 git submodule
**上游设计:** `Plan/2026-06-19_campus-assistant-architecture-plan.md`（APPROVED，§6 P0）
**本文件位置说明:** 当前写在 pku3b 子模块内是 plan-mode 的临时落点；**批准后将移动到** `project/MyAgent/Plan/2026-06-19_p0-vertical-slice-implementation-plan.md`（MyAL1S 仓库内），并从子模块删除，避免污染 pku3b。

---

## 1. Context（为什么做这件事）

架构 plan 已锁定全部设计决策，但只是"依赖顺序建议"，无实现。P0 的唯一目的是**打通整条管道的竖切**，用最少的代码证明这条链能跑通：

```
pku3b mcp（几个只读工具，compio + stdio JSON-RPC）
   ↔ FastAPI 后端（PydanticAI agent + MCP stdio client）
   ↔ 极简 React web（仪表盘确定性取数 + 对话框调 agent）
```

成功判据：**(a)** 浏览器仪表盘渲染出真实课表/作业，且该路径**完全不经过 LLM**（架构决策 #3）；**(b)** 对话框问"这周哪些作业按 DDL 排序"，agent 通过 MCP 工具取数并给出回答。跑通即验证了 compio-stdio ↔ Python ↔ agent 的运行时边界与协议互通——这是后续 P1–P4 的全部前提。

P0 **不**追求功能完整，只追求"管道正确"。

---

## 2. Scope

| 级别 | 内容 |
|------|------|
| **MUST** | `pku3b mcp` 子命令；newline JSON-RPC（initialize / tools/list / tools/call）；只读工具 `get_course_table` + `list_assignments`；prompt-free 登录（不阻塞）；FastAPI + `McpGateway`；确定性 endpoint `/api/course-table` `/api/assignments`（不过 LLM）；`/api/chat`（PydanticAI，非流式）；Vite+React 仪表盘 + 对话框；端到端跑通；**开发文档**（`docs/architecture.md` + `docs/development.md`，含"如何新增一个 MCP 工具"）+ `backend/README.md` + `frontend/README.md`；维护顶层 `README.md`；**回写修订原架构 plan**（见 §5.5）|
| **SHOULD** | 工具 `get_grades` + 仪表盘成绩面板（注册表模式建立后边际成本低）；Rust 纯函数单测 + Python 集成测试（带 warm session 时）；pku3b 内 `mcp` 子命令文档（其 README 段落或 `pku3b/docs/mcp.md`）；`docs/mcp-protocol.md`（本仓库实现的 JSON-RPC 方法/分帧约定，供后续工具/客户端依赖）|
| **MAY** | `list_announcements`；`tools/call` 用 MCP `structuredContent`（否则 text-JSON 即可） |

**明确 out-of-scope（属后续阶段，P0 不碰）：**
- 写操作 / 权限矩阵 / 确认回路 / OTP 前端往返编排 →（P2）
- SQLite（收藏 / 大事记 timeline / 对话史）→（P1）
- 树洞 / 课程评测外部数据源 →（P3）
- 凭据加密 / keychain →（P4）
- 流式 chat / WebSocket → P0 用非流式 POST，跑通后再加（fast-follow）

**关键 ASSUMED（可在批准时推翻）：**
- **OTP:** P0 假设 `ua.json` 已有有效会话（用户先用 `pku3b ct` 跑一次登录）。工具遇到需 OTP 时返回**结构化 `needs_otp`** 而非阻塞；完整 OTP 往返延到 P2。但 **prompt-free 登录从第一天就存在**。
- **LLM:** provider-agnostic（PydanticAI model string），默认 `anthropic:claude-opus-4-8`，可经 `.env` 切换（如 `claude-sonnet-4-6` 省成本）；用户自带 `ANTHROPIC_API_KEY`。

---

## 3. 架构与 seam 分解（codebase-design）

整个 P0 围绕 4 个 seam。每个都用**小接口 + 深实现**，并通过"删除测试"和"两个 adapter 才算真 seam"来检验。

### Seam 1 — MCP 工具目录 `ToolRegistry`（系统中心 seam）
架构决策 #3 的落点：**一套工具目录，两个消费者**。
- **Interface（小）:** `fn list() -> Vec<ToolSpec>` + `async fn call(&self, name, args: serde_json::Value) -> Result<serde_json::Value, ToolError>`；`ToolSpec { name, description, input_schema(JSON Schema as Value), read_only: bool }`。
- **Implementation（深，藏起来）:** 全部 pku3b `api::*` 编排（建 client → 登录 → 抓取 → serde 映射）、assignment 多页爬取、错误→`ToolError` 映射。
- **删除测试:** 删掉 registry，这些编排逻辑会同时散落到 transport 循环**和每个测试**里 → 它在挣自己的钱。
- **两个 adapter（真 seam）:** ① stdio transport 调它；② 进程内单测**绕过 transport 直接调它**（接口即测试面）。后续 Python 确定性路径经 MCP 调的也是这同一批工具。

### Seam 2 — Prompt-free 认证 `auth`
解决"OTP 在 stdio 子进程里不能 `inquire` 弹窗"的核心矛盾。
- **关键发现:** 阻塞的 `inquire` 在 **CLI 层**（`src/cli/mod.rs:186`、`src/cli/cmd_course_table.rs:48`），**不在** `Client::blackboard`/`portal` 里——**API 层本就是 prompt-free 的**。
- **Interface（小）:** `async fn ensure_login(client, cfg, service, otp: Option<&str>) -> Result<LoginOutcome>`，`LoginOutcome = Ready(session) | NeedsOtp { mobile_mask: Option<String> }`。把"需要 OTP"作为**数据返回**，永不阻塞（codebase-design 可测性原则 #2：返回结果，不产生副作用）。
- **Implementation（深）:** cookie 预检跳过、IAAA oauth、OTP 探测。**全部复用现有原语**，零修改既有代码：先 `bb_login_require_otp`/`portal_login_require_otp`（`src/api/low_level/{blackboard.rs:32,portal.rs:14}`）；若需 OTP 且未提供 → 返回 `NeedsOtp`（mask 尽力经 `iaaa_is_mobile_authen` 取）；否则照常调 `Client::blackboard`/`portal`（cookie 有效时 `bb_homepage` 预检自动跳过登录，`src/api/blackboard.rs:9-34`）。
- **两个 adapter（真 seam）:** MCP server 要 `NeedsOtp` 数据；CLI 要弹窗 prompt。CLI 的 inquire 包装**原样保留**。

### Seam 3 — Transport（newline JSON-RPC over compio stdio）
- **Interface（极小）:** `async fn run(registry, stdin, stdout) -> Result<()>`。
- **Implementation（薄 adapter，刻意不放领域逻辑）:** 逐行读 stdin、解析 JSON-RPC、路由 `initialize`/`tools/list`/`tools/call`/`notifications/initialized`、写 JSON + `\n` + flush、错误对象。一切领域逻辑都在 registry 之后 → 这层可被任意替换/最薄。

### Seam 4 — `McpGateway`（Python 后端）
- **Interface（小）:** `async def call_tool(name, args) -> dict`（确定性）+ `agent`（绑定同一 MCP toolset 的 PydanticAI Agent）+ `__aenter__/__aexit__`。
- **Implementation（深）:** `MCPServerStdio` 子进程生命周期、MCP 握手、会话复用、错误翻译。
- **确定性保证做成"结构性"而非"靠自觉":** 确定性 route handler **只 import `gateway.call_tool`**，代码里**根本拿不到 `agent`**——"不过 LLM"由模块边界强制，不靠纪律。

---

## 4. 工作分解

> 仅含 P0 涉及的部分（架构 plan 的 B/E 等延后）。`file:line` 为要复用的既有函数锚点。

### A. pku3b MCP server（Rust / compio，**改动落在 submodule 内**）

新增模块（对既有 CLI/功能零破坏，架构 plan A6）：

| 文件 | 角色 |
|------|------|
| `src/mcp/mod.rs` | `pub async fn run(config_path) -> Result<()>`：建 client、装载 registry、起 transport 循环 |
| `src/mcp/tools.rs` | **Seam 1** `ToolRegistry`：`ToolSpec`、`list()`、`call(name,args)`；各工具 = 薄 async fn 包 `api::*` |
| `src/mcp/auth.rs` | **Seam 2** prompt-free 登录 → `LoginOutcome` |
| `src/mcp/transport.rs` | **Seam 3** newline JSON-RPC 循环 |
| `src/cli/cmd_mcp.rs` | `Mcp` 子命令 args，调 `mcp::run` |

接入点（既有文件最小改动）：
- `src/main.rs:3-13` 加 `#[cfg(feature="mcp")] mod mcp;`
- `src/cli/mod.rs:70`(Commands enum) 加 `#[cfg(feature="mcp")] Mcp(cmd_mcp::CommandMcp)`；`:332`(start) 加 match 臂
- `Cargo.toml:78` `[features]` 加 `mcp = []`（**不入 default**，后端用 `--features mcp` 构建；CLI 构建不受影响）

各工具复用链：
- **`get_course_table`**（cheap，单次调用）→ `Client::portal(user,pass,otp)`（`src/api/portal.rs:4`）→ `Portal::get_my_course_table()`（`:27`，返回 raw JSON String，原样塞进结果）。
- **`list_assignments`**（贵，多页爬，验证慢路径 + agent 旗舰用例）→ `Client::blackboard`（`src/api/blackboard.rs:9`）→ `get_courses(only_current=true)`（`:125`）→ 每课 `.get().content_stream() → next_batch() → into_assignment_opt() → get()`（`:454/706/792/983`）→ 取 `title/deadline/deadline_raw/last_attempt`（`:1042-1204`）序列化。**绝不暴露 `submit_file`（`:1084`，唯一写操作）。** 复用 pku3b 内置 TTL 缓存（`cache_ttl`）抵消首调延迟。
- **`get_grades`**（SHOULD）→ `Blackboard::user_info_id()` → `course_detail(id).all_grades()`（`:268`）→ `Vec<GradeRecord{course_name,column_name,score,possible}>`（`:352`）。
- client 构建复用 `build_client` 模式（`src/cli/mod.rs:162-171`）：`Client::builder().cookie_restore_path(Some(utils::default_user_agent_data_path()))`；config 经 `config::read_cfg`（`src/config.rs:135`），路径默认 `utils::default_config_path()`，可被 `cmd_mcp` 的 `--config`/`PKU3B_CONFIG` 覆盖。

JSON-RPC 形态（spec 2025-06-18）：
- `initialize` → `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name:"pku3b",version}}`
- `tools/list` → `{tools:[ToolSpec…]}`（input_schema 用 JSON Schema）
- `tools/call` → `{content:[{type:"text",text:<json 字符串>}], isError}`（结构化数据走 text-JSON，P0 足够；`structuredContent` 列 MAY）
- **stdout 只许写 MCP 消息**；log 走 stderr（pku3b 的 env_logger/indicatif 本就在 stderr，`src/main.rs:23-36`）；`cmd_mcp` **不启 MultiProgress**。

### C. Python 后端（FastAPI + PydanticAI）

```
backend/
  pyproject.toml          # fastapi, uvicorn[standard], pydantic-ai, pydantic-settings, python-dotenv
  .env.example            # ANTHROPIC_API_KEY=  MYAL1S_LLM_MODEL=anthropic:claude-opus-4-8  PKU3B_BIN=../pku3b/target/release/pku3b
  app/
    settings.py           # pydantic-settings 读 .env
    mcp_gateway.py        # Seam 4 McpGateway：MCPServerStdio(PKU3B_BIN, ["mcp"]) 生命周期；call_tool；agent
    agent.py              # PydanticAI Agent(model, toolsets=[server], system_prompt=限定)
    main.py               # FastAPI；lifespan 起/停 gateway；挂 routes + 生产期 StaticFiles(前端 build)
    routes/
      deterministic.py    # GET /api/course-table /api/assignments [/api/grades] —— 只 import gateway.call_tool
      chat.py             # POST /api/chat {message} -> {reply} —— 只 import agent
  tests/test_mcp_gateway.py  # 拉起真 pku3b mcp，断言 list_tools + call_tool（无 warm session 则 skip）
```
- **确定性 endpoint** = `await gateway.call_tool("get_course_table", {})` → 直接返回 JSON。**不 import agent**。
- **chat** = `await agent.run(message)` → `{reply}`。System prompt「限定」：范围限 PKU 校园信息；**事实一律调工具**不得编造；简洁；（P0 只读，无写/确认）。
- LLM provider-agnostic（PydanticAI model string），默认最新 Claude，env 可换厂商/型号；key 经 gitignored `.env`（`.env.example` 入库）。

### D. Web 前端（Vite + React + TS）

```
frontend/  (Vite react-ts 模板)
  src/App.tsx       # 布局：Dashboard + ChatBox
  src/Dashboard.tsx # fetch /api/course-table (+ /api/assignments[/grades]) 渲染（确定性）
  src/ChatBox.tsx   # POST /api/chat，渲染 reply
  vite.config.ts    # dev: proxy /api -> http://127.0.0.1:8000
```
- dev：`vite dev` + `uvicorn` 双进程，`/api` 代理到后端；prod：`vite build` 产物由 FastAPI StaticFiles 托管。
- 样式极简，只为证明管道；真正"自主设计 GUI"在 P1+。

### E. 文档与可维护性（贯穿，不留到最后）

后续维护这套系统的主要动作是**往 registry 加工具**和**理解两条数据路径**，文档围绕这两点写：

| 文件 | 内容 |
|------|------|
| `docs/architecture.md` | 维护者地图：4 个 seam 的接口/实现边界、两条路径（确定性 vs agent）的数据流时序、"不过 LLM"保证如何被模块边界强制 |
| `docs/development.md` | dev 环境搭建（构建 `pku3b --features mcp`、跑 backend、跑 frontend）；**"如何新增一个 MCP 工具"分步指南**（registry 模式 = 最高频维护任务）；测试怎么跑；git/submodule 工作流 |
| `docs/mcp-protocol.md`（SHOULD）| 本仓库 `pku3b mcp` 实现的 JSON-RPC 方法、newline 分帧、`ToolSpec`/结果形态——作为前后端之间的契约 |
| `backend/README.md`、`frontend/README.md` | 各自的配置（`.env`）、运行、测试、构建 |
| 顶层 `README.md` | P0 落地后更新"如何运行整套"；状态从🚧脚手架推进 |
| pku3b 内（SHOULD）| 在 fork 的 README 加一段或 `pku3b/docs/mcp.md` 记录 `mcp` 子命令 |
| 代码内联 | Rust `src/mcp/*` 模块级 `//!` 文档注释；Python `McpGateway`/routes docstring |

文档与代码同批提交（写完一层补一层），避免 drift（MEMORY.md 文档标准）。

---

## 5. 已解决的关键未知（消除架构 plan 的 TBD/风险）

| 未知 | 结论 | 证据 |
|------|------|------|
| MCP stdio 分帧（plan TBD #3） | **newline-delimited JSON-RPC**（一行一条，无内嵌换行），非 LSP Content-Length | MCP spec 2025-06-18 transports（已读原文）|
| compio 能否异步读 stdin | 能：`compio::fs::stdin()` 实现 AsyncRead；`read_exact` 可用 | `compio-fs-0.12.0/src/stdio/`；既有 `fs::stdout().write_all` 已证 compio-fs 编入（`cmd_course_table.rs:132`）|
| 确定性取数能否绕开 LLM | 能：PydanticAI `MCPServerStdio` 支持直接 `call_tool`/`list_tools`（不跑 agent）| PydanticAI MCP client（精确方法名实现时核对安装版本）|
| OTP 阻塞 | API 层本就 prompt-free；新增非阻塞 OTP gate 返回 `NeedsOtp` | inquire 仅在 CLI 层 `cli/mod.rs:186` |

---

## 5.5 维护原架构 plan（把 P0 发现回写）

P0 调研推翻/收敛了原架构 plan 的若干处。**实施期对 `Plan/2026-06-19_campus-assistant-architecture-plan.md` 做少量补充修改**（保持原结构，仅订正 + 标注解决）：

| 原文处 | 问题（"意外情况"）| 修订 |
|--------|------|------|
| **§4 A2** "建议 LSP 风格 Content-Length" | **错**：MCP stdio spec 强制 **newline 分帧**（无内嵌换行），非 Content-Length | 改为 newline-delimited JSON-RPC，注明 spec 2025-06-18 |
| **§7 TBD** "MCP stdio 分帧方式…最终定型" | 已定 | 标 **RESOLVED → newline 分帧** |
| **§7 TBD** "前端框架三选一" | 已定 | 标 **RESOLVED → Vite + React + TS** |
| **§4 A5/A6** OTP | 原文担心子进程无法弹窗，未点明根因 | 补注：阻塞的 `inquire` 只在 **CLI 层**，`api::*` 登录本就 prompt-free → MCP 直接复用 API + 加非阻塞 OTP gate，**零改既有代码** |
| **§4 A2** "compio 内读 stdin…无现成 crate" | 部分过虑 | 补注：`compio::fs::stdin()` 已可用（compio-fs 已编入，stdout 同源已在用）|
| **§4 A4** sideEffect 标注 | 利于 P2 | 补注：`submit_file`（blackboard.rs:1084）是唯一写方法，其余 api 皆只读 |

做法：在原 plan 末尾加一节 `## 8. 实施期修订记录 (P0)` 汇总上述，并在 §4/§7 对应处做内联订正（不重写全文）。这一步本身是 MUST 文档工作。

---

## 6. Git / 仓库工作流（submodule 的后果 + 「及时应用 git」）

- **pku3b 改动**（A 部分）落在 **submodule 仓库**：在 `pku3b/` 内开分支（如 `feat/mcp-server`）→ 提交 → push 到 `VioletVenti/pku3b`。
- **MyAL1S 改动**（C/D + submodule 指针）：在 MyAL1S 开分支 → 提交 backend/frontend → submodule 指针 bump 单独提交。
- 子模块指针只有在 pku3b 提交 push 后再 bump，保证 fresh clone 可解析。
- 增量提交（每层一提交：transport → registry → 2 工具 → gateway → routes → 前端 → E2E），符合「代码修改及时应用 git」。
- **每次提交前重跑 secret 扫描**（public 仓库）：确认无 `cfg.toml`/`ua.json`/`.env`/`*.sqlite` 入库（`.gitignore` 已设，但提交前复检）。

---

## 7. Verification（分层 + 端到端）

1. **Rust 纯单测** `cargo test --features mcp`：`tools/list` schema 正确、JSON-RPC 解析/封帧、错误映射、`read_only` 标注（沿用 pku3b 既有纯函数单测风格，`blackboard.rs:1286`）。*登录/取数涉及网络，不进单测。*
2. **Rust 手动 smoke**（需 warm `ua.json`）：
   ```bash
   cargo build --features mcp
   printf '%s\n%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ./target/debug/pku3b mcp
   # 断言 stdout 两行合法 JSON-RPC 响应；再手动发一条 tools/call 取 course_table
   ```
3. **MCP 互通**：先用官方 `mcp` Python SDK（或 `mcp` dev inspector）连 `pku3b mcp` 跑通 initialize+tools/list+tools/call，**再**接 PydanticAI——隔离"我的 server 不合规"与"PydanticAI 用法"两类问题。
4. **Python 集成** `pytest`：`async with McpGateway() as g: await g.call_tool("get_course_table",{})`（无 warm session 则 `skipif`）。
5. **E2E**：`uvicorn` + `vite dev` → 浏览器仪表盘渲染真实课表（Network 面板确认 `/api/course-table` 命中、未调 LLM）；对话框问"这周作业按 DDL 排序" → 观察 agent 触发 `list_assignments` → 返回排序结果。
6. **质量门 ≥ 80**（CLAUDE.md）后方提交。

---

## 8. Risks（P0 专属）

| 风险 | 等级 | 对策 |
|------|------|------|
| 我手写的 MCP server 不合规，PydanticAI 连不上 | 中 | 先对官方 mcp client 跑通（验证 #3）；严格按 spec 实现 initialize/tools |
| compio stdin 需额外 feature | 低 | stdout 已证 compio-fs 编入；首次构建即验证，必要时加 compio `fs` feature |
| assignment 多页爬取使确定性 endpoint 首调很慢 | 中 | 复用 pku3b TTL 缓存；前端加 loading；P0 接受延迟 |
| `ua.json` 冷启动且需 OTP → 无头登录失败 | 中 | P0 文档要求先 `pku3b ct` 登录一次；工具返回 `needs_otp` 由 UI 提示；完整往返 P2 |
| 会话中途 cookie 过期 | 低 | 预检失败→重登；若需 OTP 则上抛 `needs_otp`，P0 接受 |
| public 仓库泄密 | 高→已控 | `.gitignore` 已屏蔽；每次提交前 secret 扫描 |

---

## 9. Sequencing（依赖顺序）

1. **A**: `mcp` feature + `cmd_mcp` 骨架 → `transport`（先回 echo/最小 initialize）→ `tools` registry（先 `get_course_table`）→ `auth` 接入 → 加 `list_assignments`（+`get_grades` SHOULD）。每步 smoke；同步写 `src/mcp/*` 模块注释 + pku3b `mcp` 文档。
2. 在 pku3b submodule 提交 push，MyAL1S bump 指针。
3. **C**: `McpGateway`（先 `call_tool` 直连，pytest）→ 确定性 routes → `agent` + `/api/chat`；同步写 `backend/README.md`。
4. **D**: Vite React 骨架 → Dashboard（接确定性）→ ChatBox（接 agent）；同步写 `frontend/README.md`。
5. **E2E** 验证 → 写 `docs/architecture.md` + `docs/development.md`（+`docs/mcp-protocol.md` SHOULD）、更新顶层 `README.md` → 质量评分 → 合并。
6. **回写修订原架构 plan**（§5.5）；把本 P0 plan 从子模块移至 `project/MyAgent/Plan/`。
7. 提炼 `[LEARN]` 写入 MEMORY.md（如：MCP stdio = newline 分帧、prompt-free 在 API 层）。

---

## 10. 待批准时确认的点（其余按本文 ASSUMED 执行）

- 工具集：`get_course_table` + `list_assignments`（MUST）、`get_grades`（SHOULD）是否符合预期？
- OTP：P0 用 warm `ua.json` + 结构化 `needs_otp`、往返延 P2，是否接受？
- chat：P0 非流式、流式/WS 列 fast-follow，是否接受？
- LLM 默认 `claude-opus-4-8`（env 可换），是否接受？
- 前端 Vite+React+TS（已选定）。
