# 会话日志 2026-06-20 — 一次 OTP 登录（IAAA SSO）

**计划:** `quality_reports/plans/zesty-growing-clarke.md`（APPROVED）
**分支:** MyAL1S `feat/otp-once-sso`；子模块 pku3b `experiment/iaaa-sso`

## 目标
登录只输一次 OTP 即连上 Portal(课表) + Blackboard(作业/成绩)。现状两次 OTP。

## 方法 / 理由
- 根因：两服务各打 IAAA 凭据端点 `oauthlogin.do`（必带 OTP）。
- 修复：第一次登录(Portal)花掉唯一 OTP 并热身 IAAA 会话；第二个服务(Blackboard)改打**授权端点** `oauth.jsp`(GET)，靠单一共享 cookie jar 的热会话拿 token，免第二次 OTP（SSO）。
- 上一次"login once"失败是因为用空 OTP 打 `oauthlogin.do`（凭据端点不做 SSO）；新方案改打 `oauth.jsp`。

## 关键决策（用户）
- 我只做编译/clippy/纯逻辑单测；**用户线上单次-OTP 测试确认成功后再 merge**。
- SSO 若线上不成立 → **弃分支回 main**，不另设回退。

## 关键上下文
- 单一 `cyper::Client`+`cookie_store(true)`（`pku3b/src/api/low_level.rs`）→ IAAA 会话跨服务可见，SSO 前提成立。
- 深模块：硬化 `iaaa_sso_login`（诚实成败 + JS 重定向 token），抽纯函数 `extract_js_redirect` 进单测。

## 进展
- [x] 建分支、计划置 APPROVED
- [x] 硬化 iaaa.rs（`iaaa_sso_login`：`saw_token && final_ok` 诚实判定 + JS/meta 重定向）
- [x] 纯函数 `extract_js_redirect` 放入 `low_level.rs`（`extract_redirect_url` 旁），+3 单测
- [x] tools.rs/blackboard.rs 文档措辞收敛（逻辑无需改）
- [x] VERIFY：fmt ✓ / build --features mcp ✓ / test 20 通过(含 3 新)・1 既有需凭据 live 测试失败(无关) / clippy 零新增警告 / backend pytest 8 passed
- [ ] 提交两分支 + 交接线上单次-OTP 测试

## 验证细节
- `test_sb_login`（syllabus）读 `PKU3B_TEST_USERNAME/PASSWORD` 环境变量，既有 live 测试，我分支未改动 → 与本次无关。
- clippy 3 个 `Arc` 警告全在未触碰的 `src/cli/cmd_*.rs`，diff 新增 0 处 Arc。
- 设计微调：纯函数落点改到 `low_level.rs`（与 `extract_redirect_url` 同homes，更自然/可复用），非计划里写的 iaaa.rs。

