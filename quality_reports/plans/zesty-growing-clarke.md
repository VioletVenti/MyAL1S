# 计划：一次 OTP 完成登录（IAAA SSO 免第二次手机令牌）

**Status:** APPROVED — 实施中
**Date:** 2026-06-20
**Branch（子模块 pku3b）:** `experiment/iaaa-sso`（已存在，含未提交草稿）
**Branch（MyAL1S 主仓）:** `feat/otp-once-sso`（待建）

---

## Context（为什么做这件事）

当前 Web 端登录要用户输**两次** OTP：一次连门户 Portal（`portal.pku.edu.cn`，课表），一次连教学网 Blackboard（`course.pku.edu.cn`，作业/成绩）。根因是两个服务各自走 IAAA 的**凭据端点** `oauthlogin.do`（POST，必带 `otpCode`）：

- `src/api/low_level/iaaa.rs::iaaa_oauth_login` → POST `oauthlogin.do`，返回 `{success, token}`。
- Portal 与 Blackboard 各调一次（`portal.rs::portal_login`、`blackboard.rs::bb_login`）→ 各花一个 OTP。

上一次"login once"尝试（git `c1bb139`，后被 `61a3bb0` 回退为"一服务一 OTP"）失败的原因：它用 `bb_login(..., otp="")`（空 OTP 仍打 `oauthlogin.do`）试图复用——但 `oauthlogin.do` 只校验凭据、**不做 SSO**。

**正确思路（"OSS" = SSO，IAAA 单点登录）**：IAAA 是 CAS 式 SSO。第一次登录（Portal，花掉唯一的 OTP）会**热身 IAAA 会话**；之后第二个服务应改打**授权端点** `oauth.jsp`（GET），靠这条热会话直接拿 token、**免第二次 OTP**。关键前提已具备：`LowLevelClient::create()`（`src/api/low_level.rs`）建的是**单一 `cyper::Client` + `cookie_store(true)`**，被 `Arc<ClientInner>` 共享，所以第一次登录在 `iaaa.pku.edu.cn` 留下的会话 cookie 对第二个服务可见。

**预期结果**：用户输一次 OTP → `login` 工具返回 `{portal:true, blackboard:true}` → 前端直接显示成功、不再提示"再输一次"。

> ⚠️ **不可由我线上验证**：我没有校园网/学号密码/手机令牌，无法对 PKU 线上 IAAA 确认 SSO 是否真的免第二次 OTP。我只能验证编译 + fmt/clippy + 纯逻辑单测。**线上单次-OTP 测试由用户完成，确认成功后再 merge**（见下）。若线上证明 SSO 不成立，则**弃用本分支、回到 main**（main 现状两次-OTP 已可用），不另做回退设计。

---

## 设计（codebase-design：深模块）

### 外部 seam：`iaaa_sso_login(appid, app_name, redir) -> Result<()>`（`iaaa.rs`）
极小接口（3 个 `&str`），深实现，隐藏：`oauth.jsp` GET、重定向链跟随、**JS 重定向 token 提取**、**诚实的成败判定**。删除测试：删掉它，两次-OTP 问题会在每个调用方重现 → 它挣得其位。

现状草稿的两个缺陷，本计划修复：
1. **假阳性**：冷会话下 `oauth.jsp` 返回 200 登录页（无重定向）时，现版 `ensure!(status.is_success())` 仍返回 `Ok(())`。深模块不应对自己的成败撒谎。
2. **只处理 HTTP 3xx**：真实 IAAA 可能用 **JS 重定向**（200 HTML 内嵌 `window.location=...token=...`）下发 token，现版会漏掉。

**硬化后的算法**（以 `token=` 出现与否作为**与主机无关**的成功信号）：
```
res = GET oauth.jsp?appID=appid&appName=app_name&redirectUrl=redir
saw_token = false
loop (hops ≤ 12):
  若 res 为 3xx 且有 Location:
      url = Location; saw_token |= url.contains("token=")
      res = get_by_uri(url); continue
  若 res 为 2xx:
      若 body 命中 JS 重定向 URL (纯函数 extract_js_redirect):
          url = 该 URL; saw_token |= url.contains("token="); res = get_by_uri(url); continue
      否则 break        // 终端页面
  否则 break
// 成功 = 确实拿到并投递了 token，且最终 2xx
ensure!(saw_token && res.status().is_success(),
        "IAAA SSO 未认证（多半是冷会话/登录页，需要 OTP）")
Ok(())
```
- 冷会话：`oauth.jsp` 返回 200 登录页、链路中无 `token=` → `saw_token=false` → **Err**（诚实）。
- 热会话：`oauth.jsp` 302 → `redir?token=...`（离开 iaaa）→ 跟随 → 2xx → **Ok**。
- 复用既有原语：`extract_redirect_url`、`get_by_uri`、`convert_uri`（均在 `src/api/low_level.rs`）。日志已脱敏（按 `?` 截断，不打 token）。

### 内部 seam（可单测的纯函数）
- `fn extract_js_redirect(body: &str) -> Option<String>`：正则抓 `(?:window|document|top).location(.href)? = '…'`。**已有先例**：`blackboard.rs::bb_course_content_file_uri` 用 `document.location = '(.*?)';` 抓 URL。可单测（"接受输入、返回结果"）。
- token 判定内联 `url.contains("token=")`（必要时也抽成纯函数）。
> 这是"内部 seam / 接口即测试面"：网络路径按项目惯例不进单测（见 `Plan/2026-06-19_p0-vertical-slice-implementation-plan.md`），但纯解析逻辑进单测。

### 编排 seam：`ToolRegistry::login(otp)`（`src/mcp/tools.rs`）— 基本沿用草稿
隐藏"Portal 花 OTP、Blackboard 走 SSO"的决策；后端/前端只调一次。冷启动顺序：`portal_warm()` → `try_blackboard_sso()`（诚实化后冷会话快速返回 false，不再做无谓的 `get_courses` 验证）→ 提供 OTP 则 `login_portal(otp)` 热身 IAAA → 再 `try_blackboard_sso()`（免第二次 OTP）。`try_blackboard_sso` 仍以 `auth::login_blackboard(None)` + `get_courses(true)` 真验证（防假会话）。
- **保留**既有 `try_blackboard(otp)` 直连兜底（继承自 main，零新增成本，保证分支不劣于 main）；**不新增**额外回退逻辑。
- `bb_sso_login()`（`blackboard.rs`）作为命名特化保留（绑定 blackboard 的 appid/`教学网`/`OAUTH_REDIR`，调用处可读性好）。

### MyAL1S 主仓改动（极小、可逆）
- `frontend/src/App.tsx`：**无需改逻辑**——`{portal:true,blackboard:true}` 已被当作完整成功（line 23）；现有"再输一次"分支（line 25-29）自然成为 SSO 失败时的兜底提示。
- backend：**不改**（`routes/session.py` 只转发 `login` 工具信封）。
- 仅**bump 子模块指针**到 `experiment/iaaa-sso` 的提交。
- `main` 在用户线上确认前**保持不动** → 失败即弃分支、零回滚成本。

---

## 待修改文件
| 文件 | 改动 |
|------|------|
| `pku3b/src/api/low_level/iaaa.rs` | 硬化 `iaaa_sso_login`（诚实成败 + JS 重定向）；新增纯函数 `extract_js_redirect` + 其 `#[cfg(test)]` 单测 |
| `pku3b/src/api/low_level/blackboard.rs` | 保留 `bb_sso_login` 薄封装（草稿已在） |
| `pku3b/src/mcp/tools.rs` | `login` / `try_blackboard_sso` 编排微调（草稿已在，配合诚实化收敛） |
| `pku3b`（子模块）| 提交到 `experiment/iaaa-sso` |
| MyAL1S `feat/otp-once-sso` | bump 子模块指针；（前端 App.tsx 文案可选微调，逻辑不变） |

---

## 执行顺序（orchestrator）
1. MyAL1S 建并切到 `feat/otp-once-sso`；子模块已在 `experiment/iaaa-sso`。
2. 实现 `iaaa.rs` 硬化 + 纯函数单测；按需收敛 `tools.rs`。
3. **VERIFY（我能做的）**：在 `pku3b/` 下
   - `cargo fmt --all`（或 `--check`）
   - `cargo clippy --features mcp -- -D warnings`（至少不引入新告警）
   - `cargo build --features mcp`
   - `cargo test --features mcp`（含新单测）
   - `cd ../backend && pytest`（登录类测试本就跳过线上）
4. 修复 → 重验，直至干净。
5. 子模块提交；MyAL1S 提交（含子模块指针 + 本计划/会话日志）。
6. **停在分支**，把下面的线上测试交给用户。

---

## 线上验证（用户执行 → 决定是否 merge）
> 目的：用**一次** OTP 走真实冷启动路径，确认 Blackboard 经 SSO 免第二次令牌。

1. `cd pku3b && cargo build --release --features mcp`（首次需 `./target/release/pku3b init` 配学号/密码）。
2. **强制冷会话**：删除持久化会话文件（`utils::default_user_agent_data_path()`，实现时我会在交接说明里给出确切路径，通常是 `ua.json`）。否则热会话会直接返回、测不到 SSO。
3. 起后端 + 前端（见 `backend/README.md`），在登录条**只输一次** OTP。
4. **判定**：
   - ✅ 成功：显示"课表 + 作业/成绩 已连接"，**没有**"再输一次"提示。
   - ❌ 失败：一次 OTP 后只回 `{portal:true, blackboard:false}`，UI 提示"作业/成绩请再输一次"。
5. **看日志**（已有标记）：`[mcp] login: portal_warm=false sso_blackboard=true/false`、`[sso] authorize ...`、`[sso] hop N -> <host>`、`[sso] final status=...`。`sso_blackboard=true` 即 SSO 成功。
6. **回报**：
   - 成功 → 我把 `experiment/iaaa-sso` 合到子模块 `master`、`feat/otp-once-sso` 合到 MyAL1S `main`（含指针 bump）。
   - 失败 → 弃用分支、回到 `main`，保留诊断日志供后续。

---

## 风险
- **IAAA 可能根本不经 `oauth.jsp` 做免 OTP 的 SSO**（需其它 cookie，或对每服务强制 OTP）→ 分支失败 → 按约定弃用回 main。诚实化的 `iaaa_sso_login` + `[sso]` 日志使其**可诊断**。
- **相对 Location** 经 `convert_uri` 可能被错误补成 `course.pku.edu.cn`；故成功信号用**与主机无关的 `token=`** 判定，日志里 `[sso] hop` 主机可佐证。
- **JS 重定向 HTML 形态多样**：正则可能需按真实 IAAA 页面微调；纯函数单测 + `[sso]` 日志让迭代廉价。
