# MyAL1S

> PKU 校园信息终端助手 —— 在成熟的教学网爬虫 [`pku3b`](https://github.com/VioletVenti/pku3b) 之上，构建一个**带 LLM agent、自主设计 GUI** 的校园信息终端助手。

**状态：** ✅ **P0 竖切 + P1 数据面板已打通**。P1 = 周历 + 待办 + 新到通知 + 课程通知/材料/回放 + 星标/自定义待办 + 对话升级（模型选择、思考可见、历史会话），持久化于 SQLite。后续 P2–P4（写操作+权限矩阵、外部论坛、加固）见 roadmap。

---

## 这是什么

`pku3b` 已经能在命令行单点查询教学网（课表 / 作业 / 成绩 / 公告 / 回放）。MyAL1S 在它之上多做三件事：

- **智能层** — 自然语言查询、跨数据源分析与总结、多步规划（如「这周哪几门作业撞 DDL，帮我排优先级」）。
- **聚合层** — 把分散的教学网信息整合成个人化面板（课表、大事记时间线、收藏）。
- **可控写操作** — 交作业 / 选课 / 发帖等副作用操作，受用户配置的权限矩阵约束（默认「需确认」）。

**P1 数据面板** 在聚合层之上加了「个人化日程」视角：

- **主界面（极简）** — 周历 + 课表（干净课名，点击日期展开当天星标/待办）+ 待办 + 新到通知 + 对话侧栏。顶部「主界面 / 目录」切换。
- **目录视图** — 左侧栏点选模块、右侧一次只看一个（作业 / 课程通知 / 课程材料 / 课程回放 / 成绩 + 四个「待接入（P3）」面板），列表分页。
- **登录即初始化 + 重启留存** — 输一次 OTP 后后台预热全部数据源；后端快照缓存让**重启后端/未登录时仍显示上次内容**（标「离线缓存」角标），前端 localStorage 让刷新瞬间显示。
- **待办** — 把「重要却未做」的内容（被 ☆ 星标的作业/公告 + 自定义待办）按 DDL 汇总；已交作业 / 已完成项自动移出。
- **新到通知** — 自上次访问以来新增的作业 + 课程公告（基于已读 id 差集），可一键标记已读。
- **星标 / 自定义待办** — ☆ 任意作业/公告即加入待办与日历；自定义待办（如微信群通知）可手动增删改、关联课程与来源。
- **对话升级** — 模型选择（Claude / Kimi / OpenAI 兼容等）、每轮可折叠的「工具调用 / 思考」、新对话、历史会话。
- **数据清洗** — 前后端协作把原始爬取数据变成干净展示：材料类型显示中文（文档/文件/文件夹…）、课表 blob 解析出课名+教室+教师、日期格式化（`6/27 周六 11:59`）、长公告摘要截断。
- **浅色彩色卡片 UI** — 暖白底 + 按类别语义色（作业橙 / 通知蓝 / 材料青 / 回放紫 / 成绩绿…）+ 柔和阴影。

P1 持久化（星标 / 自定义待办 / 已读 id / 对话历史）落在单文件 SQLite。

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
- 维护者地图（seam / 数据路径）：[`docs/architecture.md`](docs/architecture.md)
- 开发与「如何新增一个 MCP 工具」：[`docs/development.md`](docs/development.md)
- MCP 协议契约：[`docs/mcp-protocol.md`](docs/mcp-protocol.md)

## 快速开始

**一键（推荐）。** 只要装了 `tmux` / `cargo` / `python3` / `npm`，一条命令搞定——自动编译 pku3b、建后端 venv、装前端依赖，再用 tmux 起三个窗口分别跑 pku3b 预热 / 后端 / 前端：

```bash
./run.sh            # 起：tmux 会话 myal1s，3 窗口；首次会自动补依赖、可能要几分钟
# 进入后 Ctrl+b 0/1/2 切窗口（pku3b / backend / frontend），Ctrl+b d 断开（保持运行）
./run.sh stop       # 停栈 + 拆会话 + 释放端口
./run.sh attach     # 重新接入正在跑的会话
./run.sh restart    # stop + start
```

- 前端：<http://localhost:5173>　·　后端健康检查：<http://localhost:8000/api/health>
- 首次需在后端 `backend/.env` 填 `ANTHROPIC_API_KEY`（或 relay key，见 `.env.example`），并跑一次 `pku3b init` 配置学号/密码（`run.sh` 会在缺这两项时提示）。

**手动（3 个终端）。** 不想用 tmux 时，分别开三个终端各跑一条：

```bash
# 1) 构建 MCP server（后端会拉起它）并配置学号/密码
cd pku3b && cargo build --release --features mcp && ./target/release/pku3b init
# 2) 后端
cd ../backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && cp .env.example .env  # 填 ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
# 3) 前端
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

**登录：一次 OTP 双连。** 在前端顶部登录条**输一次手机令牌 (OTP)** 即可同时连上门户(课表)与教学网(作业/成绩)——OTP 花在门户登录、并把本设备标记为「常用设备」(IAAA `remTrustChk`)，教学网随后**免二次 OTP**；会话写入 `ua.json`，后续运行复用、通常无需再输。（命令行用户也可 `./target/release/pku3b ct` 预热。）

详见 [`docs/development.md`](docs/development.md)。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `pku3b/` | **git 子模块** → [VioletVenti/pku3b](https://github.com/VioletVenti/pku3b)（Rust + compio 教学网爬虫 + 新增 `pku3b mcp` server） |
| `backend/` | Python FastAPI + PydanticAI：MCP 客户端、确定性取数 endpoint、agent 对话 |
| `frontend/` | Vite + React + TS：确定性仪表盘 + 对话框 |
| `docs/` | 架构 / 开发 / MCP 协议文档 |

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
