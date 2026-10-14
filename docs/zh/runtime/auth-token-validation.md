# 身份令牌（Token）校验与授权规范

在 Nimi 的网络边界上，公开 API 与远程调用采用标准 JWT 令牌校验机制；受保护的桌面端应用则通过本地验证的宿主会话与 Runtime 通信，详情请参阅[账号与会话](/zh/runtime/account-and-session)。

## 承载令牌（Bearer Token）传输规范

| 规范项目 | 约定规则 | 异常处理说明 |
| --- | --- | --- |
| **传输头部** | gRPC 元数据 `authorization` 或 HTTP Header `Authorization` | 统一规范化读取 |
| **令牌格式** | 严格遵循 `Bearer <jwt>` 格式 | 缺少前缀视为格式错误 |
| **匿名访问** | 允许公开接口在未携带头部时以匿名访客模式执行 | 仅限于公开接口 |
| **格式错误处理** | 返回 `UNAUTHENTICATED` 并携带 `AUTH_TOKEN_INVALID` 原因代码 | 格式错误的令牌不会被当作匿名用户降级放行 |

## JWT 必需声明（Claims）

合法的 Realm 身份 JWT 必须包含以下核心声明：

- `iss`（Issuer）：令牌签发方域名（必须与 `auth.jwt.issuer` 一致）；
- `aud`（Audience）：目标受众服务（令牌 `aud` 必须等于配置的 `auth.jwt.audience`，或在其 audience 数组中包含该配置值）；
- `sub`（Subject）：持有该凭证的用户或主体的唯一标识；
- `exp`（Expiration Time）：令牌到期时间（在固定的 `±60 秒` 时钟偏移窗口内校验）；
- `iat`（Issued At）：令牌签发时间戳；
- `nbf`（Not Before）：生效时间（若存在则执行时间窗口校验）；
- `sid`（Session ID）：会话标识符，在验签通过后用于会话撤销状态校验。

## 签名算法与密钥发现（JWKS）

- **算法约束**：严格限定为 `RS256` 算法，禁止其他未声明算法、对称密钥签名、`alg=none` 或未携带 `kid` 标头的令牌；
- **公钥发现与缓存**：Runtime 定期从配置的官方 `auth.jwt.jwksUrl` 端点拉取并缓存验签公钥集。当遇到未识别的 `kid` 时，触发一次安全刷新；
- **时钟偏移容忍**：对 `exp` 与 `nbf` 应用固定的 `±60 秒` 容忍窗口，窗口之外不提供弹性容差。

## 会话撤销检查与失败原因分类

Bearer 认证的生效依赖 `auth.jwt.revocationUrl`、`auth.jwt.issuer`、`auth.jwt.audience` 与 `auth.jwt.jwksUrl` 作为一个原子配置组完整存在。

- **撤销状态校验**：JWT 签名与声明校验通过后，Runtime 向配置的 `auth.jwt.revocationUrl` 发送包含 `session_id`、`subject_user_id`、`issuer`、`audience`、`issued_at`、`expires_at` 的 JSON POST 请求。撤销端点必须返回 HTTP 200 及包含 `active: boolean` 和 `revoked: boolean` 的 JSON。若 `revoked: true` 或 `active: false`，则判定会话已撤销。
- **认证失败原因码分类**：
  - 格式错误、签名无效、缺少必需声明、未声明算法或时间窗口越界，返回 `UNAUTHENTICATED` 并携带原因码 `AUTH_TOKEN_INVALID`；
  - 已确认撤销或已过期的会话，返回 `UNAUTHENTICATED` 并携带原因码 `SESSION_EXPIRED`；
  - 撤销检查无法确定（网络故障、非 2xx 响应、非 JSON 载荷等），返回 `UNAVAILABLE` 并携带原因码 `AUTH_REVOCATION_UNAVAILABLE`（提示重试）；绝不降级为活跃或匿名状态放行。

## 认证（AuthN）与授权（AuthZ）的清晰分离

- **认证（Authentication）**：“你是谁？令牌是否真实有效、会话是否存活？”——校验签名完整性、声明约束、有效期及会话撤销状态；
- **授权（Authorization）**：“你是否有权操作该资源？”——在认证通过后，根据调用方主体身份与其声明的权限范围判定是否允许执行操作。

二者分工明确：认证成功仅证明调用方身份可信，具体业务操作仍需通过严格的权限范围校验。

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
