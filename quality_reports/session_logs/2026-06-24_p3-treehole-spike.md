# Session Log — 2026-06-24 — P3 树洞认证 spike（Increment S，硬门）

**Branch:** MyAL1S `feat/p3-treehole` · pku3b `feat/treehole`

## Goal
P3 Increment S：证明北大树洞认证在 pku3b（无头、不执行 JS）下可行——拿到 API 访问
令牌并拉到真实 hole/list 数据。这是 P3 的硬门，spike 失败则整个树洞延后。

## 结果：✅ 达成
`hole/list_comments` 返 **11475 字节真实帖子 JSON**。完整认证链跑通。

## 诊断历程（用 diagnosing-bugs 的紧反馈环 + 两份 HAR）
真实认证链（每步实测，非猜测，详见 memory `myal1s-p3-treehole-protocol`）：
1. IAAA OTP（appid=`PKU Helper`，复用 pku3b oauthlogin.do，trusted-device 常免二次 OTP）。
   redirUrl 用 cas_iaaa_login（**根路径**）+ uuid 尾 12 位 hex。
2. GET `/cas_iaaa_login?uuid=<tail12>&plat=web&token=<IAAA>` → 跟随重定向 →
   `/web/iaaa_success?token=<HS256 JWT>`。从 `res.url()` query 取 JWT。
3. API（`/chapi/api/v3/*`）鉴权：`Authorization: Bearer <JWT>` + `uuid` 头 +
   `userAgent: pku_web` 头。
4. 令牌验证门（API 返 code=40002）：GET `/api/title-otp`（提示）→ POST
   `/api/login_iaaa_check_token {code}` → success。

## 关键坑（避免重蹈）
- **路径 base 有三套**：登录链走根 `/`、OTP 类走 `/api/`、业务 API 走 `/chapi/api/v3/`。
  早期用 `/chapi/cas_iaaa_login` → 「验证失败」918B error 页。
- **40002「请手机短信验证」字面误导**——实为 IAAA 令牌验证，不是短信；端点是
  `login_iaaa_check_token`，不是 `jwt_msg_verify`。
- **HAR 的 Cookie 头被浏览器脱敏**——别据它判鉴权头（一度误判「无 Authorization」，
  实为 Bearer JWT；401 body `Token not provided` 才是铁证）。
- **bundle 主体压缩抓不到调用点**——OTP 流程在独立 chunk `assets/otp-*.js`（可读）。
- **uuid 两段式**：完整 `Web_PKUHOLE_2.0.0_WEB_UUID_<v4hex>` 作 uuid 头，但 IAAA
  redirectUrl + cas_iaaa_login 的 `?uuid=` 用其尾 12 位。
- pku3b `send()` 跟随重定向只采最终响应 Set-Cookie（中间 302 丢）——但 Bearer JWT
  够用，不依赖 session cookie。

## 现状
- pku3b `feat/treehole`：`low_level/treehole.rs`（auth + api_get/post）、`api/treehole.rs`
  （Client::treehole + list/send/verify）、`cli/cmd_treehole.rs`（probe/verify 子命令）。
  23 cargo 测试过。
- 接下来 Increment A：把 spike 收敛成 6 个只读 MCP 工具 + 后端 deterministic 路由 +
  前端 TreeholePanel（替换 DeferredPanel 占位）。
