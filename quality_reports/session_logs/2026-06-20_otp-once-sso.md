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

## PIVOT（线上验证后）
- **oauth.jsp SSO 坐实走不通**：日志显示热会话后 `GET oauth.jsp?appID=blackboard` = `200 / 0 跳 / saw_token=false`；抓 PKU 公开 `OAuthLogin.js` 确认 oauth.jsp 是 JS 登录页、每次都带 OTP 发 `oauthlogin.do`，无免 OTP 会话捷径。
- **改用 `remTrustChk`（"记住常用设备"）**：`iaaa_oauth_login` 加 `remTrustChk=true`；`login` 改为 portal 花一次 OTP（信任设备）→ blackboard 空 OTP 登录；新增纯 GET 的 `blackboard_warm()` 避免冷启动空 OTP 尝试（防 E21 锁定）；删 `iaaa_sso_login`/`bb_sso_login`/`try_blackboard_sso`/`extract_js_redirect`。
- 验证：fmt✓ / build✓ / test 17 通过 / clippy 零新增 / release 重编含 remTrustChk。**待用户 1 次 OTP 线上验证**（关键未知：信任能否同会话内立刻对第二个 app 生效）。

## 假阳性修复（第一次 trusted-device 测试后）
- **现象**：login 回 `{portal:true, blackboard:true}`，但 `/api/assignments` 回 `needs_otp` → blackboard 是假连。
- **根因（我引入的 bug）**：① `blackboard_warm` 用 `bb_homepage`，course.pku 对未登录返回 200 游客页 → 假阳性 true；② 假阳性短路了 trusted 登录 → **remTrustChk 路径从未真正执行过**；③ `Client::blackboard` 内部预检同样假阳性会跳过 bb_login。
- **修复**：`blackboard_courses_ok`（真 `get_courses` 校验）替掉 `bb_homepage` warm 检查；`try_blackboard` 对空 OTP 也**强制** `bb_login`（绕过预检）。这才是**首个真正测试 remTrustChk 的构建**。
- 验证：fmt✓/build✓/test 17 通过/clippy 零新增/release 重编。子模块 `50f1b68`。**待用户再测一次（谨慎，防 E21）**。



