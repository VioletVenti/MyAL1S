# Session Log — 2026-06-21 — P1 联调起栈 (stack smoke)

**Plan:** `quality_reports/plans/replicated-waddling-garden.md`
**Branches:** MyAL1S `feat/p1-dashboard-frontend` (stack run from working tree)

## Goal
起 3 终端栈（pku3b mcp → FastAPI → Vite），对 P1 的关键链路做真实端到端
联调，重点验证 review 修复（calendar 留存语义、chat trace、对话持久化）在
真实 LLM relay 调用下成立。

## 栈配置（本地，未提交任何凭据）
- **pku3b**: 重编译 release `--features mcp`（旧二进制早于 Increment A）→
  `tools/list` = login + 6 只读工具（含 announcements/materials/videos）。
- **backend `.env`**（gitignored）: 用户已有的 evomap relay key + base_url。
  发现并修正：模型串 `evomap-deepseek-v4-flash` 无 provider 前缀。探测确认
  `api.evomap.ai` 同时支持 Anthropic `/v1/messages` 与 OpenAI `/v1/models`，
  且无前缀时 llm.py 默认按 Anthropic 走 `/v1/messages`——**实际能通**。
  追加了 `MYAL1S_CHAT_MODELS`（6 个 relay 上真实模型：DeepSeek-flash/GPT-5.5/
  GLM-5.1/Kimi-K2.6/Gemini-3.1/Claude-Opus-4.7）+ `MYAL1S_SQLITE_PATH`。

## 验证结果（curl 端到端，后端 :8000 + vite :5173 代理）
1. **确定性工具未登录降级**：course-table/announcements/materials/videos 均
   正确返回 `needs_otp`，不崩。
2. **星标 CRUD 往返**：star assignment a1 + announcement n1 → GET /stars 2 条。
3. **自定义待办 CRUD**：create → patch done=true → 往返正确。
4. **todo = undone-only**：done 的自定义项**不在** todo；星标项未登录时用快照
   渲染（live=false）。✅ 符合 review 修的语义。
5. **calendar = 星标留存视图（review #1 核心）**：W26 同时显示星标 a1、星标 n1、
   **done 自定义项**；而 todo 不显示 done 项。**todo 与 calendar 语义正确解耦**。
   （首测 W25 空——是测试周选错：W25=06-15..21，而数据 date 在 06-22 之后。）
6. **新到通知**：未登录→空（`{assignment:[],announcement:[]}`），mark-seen ok。
7. **chat 端到端（evomap relay 真实调用）**：
   - 自我介绍 → 回复符合系统提示（北大校园助手）；trace=0（无工具调用）。
   - 多轮：带 conversation_id 第二轮 → 历史持久化；GET /conversations + /{id}
     正确还原全部 user/assistant 交替消息。
   - 查课表 → **trace=2**（get_course_table 的 tool_call + tool_result），agent
     正确把 needs_otp 翻译成"请先登录"回复。✅ review 修的 trace 提取（从
     all_messages() 抽 ToolCallPart/ToolReturnPart）在真实 LLM 调用下成立。
8. **前端 dev server**：title 正确、main.tsx 服务、`/api` 代理到 :8000 通。

## 遗留（需用户用浏览器 + OTP 手动验证，无凭据无法代劳）
- 登录条输 OTP → 真实课表/作业/公告渲染。
- 星标按钮交互、日历点日展开、chat trace 折叠、历史侧栏切换/删除按钮。

## 结论
P1 三层链路（pku3b mcp ↔ Python ↔ React）在真实 relay 下端到端通；review 修复
（calendar 留存、trace、对话持久化）经真实 LLM 调用验证成立。栈运行于后台进程
（backend pid + vite pid）；收尾时停。
