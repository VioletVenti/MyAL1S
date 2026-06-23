# Plan — P2 UX 迭代：历史常驻 + 会话闸(加载中) + 对话框内审批横条

**Status:** DRAFT（待批准） · **Branch:** `feat/p2-write-ops`（继续在 P2 分支上）
**Relocation note:** 本文件由 plan 模式生成于 `pku3b/quality_reports/plans/`（plan 模式只许写此处）。批准后第一步移到 `project/MyAL1S/quality_reports/plans/2026-06-23_p2-ux-iteration.md`，删 pku3b 副本。

---

## Context（为什么做）

P2 已交付并过 `/review`。本次是三个 UX 迭代 + 一个体验 bug，都围绕**对话框/仪表盘的连接态与审批流**：

1. **历史会话目录要更显眼** —— 现在它是对话框里一个折叠的 `<details>`，用户找不到、回不到历史对话。
2. **未输 OTP 时多个面板同时转圈**（已与用户确认是这种）—— 根因：`useEnvelope` 只在 `status:"ok"` 时写 localStorage 缓存；从未成功登录过 → 缓存恒空 → 每个面板 mount 时 `env=null`，在 pku3b 冷往返检测 `needs_otp` 的几秒里全部显示「加载中」，最后才各自变「请登录」。要的是：未连接时**一个**清晰提示，而非 6 个转圈。
3. **审批横条放到对话框内**（已确认删目录的待审批面板）—— 现在 agent 发起的 pending 审批只能在「目录 → 待审批」里确认，与对话割裂。要的是：对话框输入框上方，需要确认时弹一条横向方块，点 accept/拒绝。

## 已锁决策（grilling/确认）
- 加载中修法 = **全局 session 闸**：`GET /api/session` 一次连接检查；未连接时仪表盘统一显示「未连接，请登录」（不挂载各面板，避免 6 个冷爬转圈）。
- 待审批目录面板 = **删除**；审批只在对话框内横条。
- 历史 = **对话框顶部常驻列表**（当前会话高亮，可切换/删除，可收起）。

## 改动

### 1. 后端：`GET /api/session`（新增，极小，LLM-free）
- 文件：`backend/app/routes/session.py`（已有 `/login`，加 `/session`）。
- 实现：`await gateway.call_tool("login", {})`（无 OTP）。login 工具的复用分支：portal+blackboard 都热 → `{status:ok,data:{portal:true,blackboard:true}}`；否则（无 OTP）→ `needs_otp`。映射成 `{"connected": portal&&blackboard}`。复用既有逻辑、不新增爬虫；pku3b 1h HTTP 缓存使首次后的检查廉价。
- 返回 `{"connected": bool}`。错误当 `connected:false`。

### 2. 前端：会话闸（修「加载中」）
- `api.ts`：加 `fetchSession(): Promise<{connected:boolean}>`（裸 fetch，仿 `fetchPermissions`）。
- `App.tsx`：`connected: boolean|null`（null=检查中）。`checkSession()` on mount + LoginBar `onConnected` 后。传 `connected` 给 `<Dashboard>`。
- `Dashboard.tsx`：`connected===null` → 单条「检查连接…」；`connected===false` → 主界面/目录都渲染**一个**「未连接教学网——请在顶部输入 OTP 登录一次」notice（不挂 Calendar/Todo/NewNotices/各面板，杜绝冷爬转圈）；`connected===true` → 正常。LoginBar 仍在顶部，可从 notice 态直接登录。
- 登录成功 → `checkSession()` → `connected=true` → 面板才 mount+fetch（此时已热，快）。

### 3. 前端：对话框顶部历史常驻列表
- `ChatBox.tsx`：把折叠 `<details className="history">` 改成顶部**常驻**紧凑列表（`.chat-toolbar` 下、`.messages` 上）。当前会话高亮（复用 `.history-list li.active`），点击切换（`openConversation`）、`✕` 删除（`removeConversation`）。列表高时可滚动（`.history-list` 已 `max-height + overflow`）。空列表不渲染该区。复用既有 `.history*` CSS + 微调（去 details 缩进、加个小标题/计数）。
- 逻辑（`conversations`/`openConversation`/`removeConversation`/`refreshConversations`）不变。

### 4. 前端：对话框内审批横条（删目录待审批面板）
- `Dashboard.tsx`：删 `approvals` 目录模块项 + `ApprovalsPanel`/`ApprovalsList`/`ApprovalRow`/`approvalLabel`（移审批渲染到 ChatBox）。保留 `groupLabel`（settings 用）。
- `api.ts`：`fetchApprovals(status?: string)` 加可选 `status` 参数（`/approvals?status=pending`）。
- `ChatBox.tsx`：输入框（`.composer`）上方渲染 **pending 审批横条**：
  - 取数：mount 时 + 每次 `sendChat` 后 + 每次 `decide` 后，`fetchApprovals("pending")`；再加一个慢轮询（如 8s）兜底（跨标签页/延迟）。pending 为空则不渲染。
  - 每条横条：`summary` + `📎 filename` + 「确认执行 / 拒绝」按钮 → `decideApproval(id,"confirm"|"deny")`；`needs_otp` 结果显示「需先登录」。
  - agent 发起 pending：agent 调 submit_assignment → gate 建 pending 行 → 回复；ChatBox 收到回复后 refresh → 横条出现。UI 直交（SubmitButton）不经审批、不产生横条（它是隐式确认）。
- `styles.css`：横条样式（横向卡片、`--warn`/`--lake` 语义色、按钮），复用 `.attach-chip`/`.approval` 既有 token。

### 5. 测试 + 文档
- `tests/App.test.tsx`：删「目录显示待审批模块」用例；加 ①未连接 → 显示「未连接」notice、无面板转圈（`connected:false` fixture）；②pending 审批 → 对话框出现确认/拒绝按钮（`approvals?status=pending` fixture）；③历史常驻列表渲染。
- `tests/fixtures.ts`：加 `session: {connected:false}`；`approvals` 保持 ok+空（横条隐藏用例）；加一条 pending 用的 override。
- 后端：`backend/tests/test_app.py` 或新 `test_session.py` 加 `/api/session` 用例（login 工具 needs_otp → connected:false）。
- 文档：`docs/architecture.md`（会话闸 + 审批改到对话框内，删待审批面板描述）；`README.md`（对话区描述：历史常驻 + 审批横条 + 未连接态）。

## 验证
```bash
cd backend && pytest                                  # +session 用例
cd ../frontend && npm run build && npm test -- --run  # 闸/横条/历史用例
```
- 手动：①不登录开页 → 单条「未连接」、无转圈；登录后 → 面板正常。②对话附文件说「交作业 X」→ 助手回复 + 输入框上方出现横条 → 点确认 → 「已执行」。③顶部历史列表点击可回到旧对话。

## 风险/取舍
- `/api/session` 冷时仍一次 pku3b 往返（~1-2s），但**只有一次**且 1h 缓存，远好于 6 个并发冷爬。可接受。
- 慢轮询（8s）拉 pending：开销极小（单表 SELECT）；event-driven 为主、轮询兜底。
- 审批横条与「最近处理」历史：删面板后不再有审计视图（用户已接受）；如需，P3 可在设置页加只读审计。
