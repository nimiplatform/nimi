# Token 验证

Bearer JWT 验证仅适用于准入此认证路径的操作，不能证明受保护 Local App 来源。正式 Nimi App 使用验证过的 Host 会话，不接收 Realm bearer；见[账号与会话](/zh/runtime/account-and-session)。

## 承载令牌输入模型

| 规则 | 值 |
| --- | --- |
| 头部键 | gRPC 元数据 `authorization`（HTTP `Authorization` 在此处标准化） |
| 令牌格式 | 仅 `Bearer <jwt>` |
| 无头部 | 匿名（不是错误） |
| 头部存在但格式错误 | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`（不降级为匿名） |

格式错误的令牌**绝不会**被视为匿名。运行时会以类型化的原因拒绝请求，而不会默默地丢弃身份。

## 必需声明

领域 JWT 最小强制声明：

| 声明 | 目的 |
| --- | --- |
| `iss` | 发行者 |
| `aud` | 受众 |
| `sub` | 主体 |
| `exp` | 过期时间 |
| `iat` | 发行时间 |
| `nbf`（当存在时） | 必须在时间窗口验证中得到尊重 |

## 算法和头部约束

| 规则 | 值 |
| --- | --- |
| 允许的算法 | 仅 `RS256`，密钥形状遵循生成的 Realm JWKS 契约 |
| `alg=none` | 拒绝 |
| 缺少 `kid` | 拒绝 |

`alg=none` 是一个已知的 JWT 漏洞向量。运行时无条件拒绝。

## JWKS 缓存和刷新

| 规则 | 值 |
| --- | --- |
| 读取姿态 | 缓存优先；缓存未命中或 `kid` 未命中触发单次刷新 |
| 刷新失败 | 不得降级为匿名；返回 `UNAUTHENTICATED` |
| 失败回退 | 短 TTL 窗口可能继续使用最近成功的快照用于已命中的 `kid` |
| `auth.jwt.jwksUrl` | 运行时验证公钥的唯一许可来源 |
| `publicKeyPath` | 不是有效的验证来源 |
| 默认方案 | HTTPS；仅当主机是回环地址 (`localhost` / `127.0.0.0/8` / `::1`) 时允许 HTTP，用于本地开发 |

## 时钟偏移

| 规则 | 值 |
| --- | --- |
| 偏移窗口 | 固定 `±60s` |
| 超出窗口 | 令牌无效；没有软容忍度 |

在偏移窗口内的令牌会被验证。超出窗口则不会。运行时不进行协商。

## 会话撤销检查

签名验证通过后，如果会话域可用，运行时仍会检查会话撤销。

| 规则 | 值 |
| --- | --- |
| 已撤销/过期的会话 | `UNAUTHENTICATED` + `SESSION_EXPIRED`；需要重新认证，不可重试 |
| 无法判断撤销状态 | `UNAVAILABLE` + `AUTH_REVOCATION_UNAVAILABLE`；可重试，不能回退为匿名或有效会话 |
| 自省端点 | `auth.jwt.revocationUrl` |
| 自省所需的声明 | `sid` |
| 缺少配置 (`issuer` / `audience` / `jwksUrl` / `revocationUrl`) | 承载 JWT 路径关闭 |

自省合同是固定的：向 `revocationUrl` 发送 `POST` 请求，JSON 正文包含 `session_id`、`subject_user_id`、`issuer`、`audience`、`issued_at`、`expires_at`。响应正文必须包含 `active: boolean`、`revoked: boolean`，可选 `expires_at`。`revoked=true` 或 `active=false` 都算作已撤销。网络错误、非 2xx 或非法响应返回 `UNAVAILABLE` 与 `AUTH_REVOCATION_UNAVAILABLE`，**不得**降级为匿名或有效会话。

## 认证与授权

这两个阶段是不同的，并按固定顺序执行：

| 阶段 | 问题 | 失败代码 |
| --- | --- | --- |
| 认证 (AuthN) | “令牌和会话是否有效？” | 无效令牌：`AUTH_TOKEN_INVALID`；会话已撤销/过期：`SESSION_EXPIRED`；撤销状态未知：`AUTH_REVOCATION_UNAVAILABLE`，状态码见上表 |
| 授权 (AuthZ) | “这个主体被允许这样做吗？它是否拥有它声称要修改的内容？” | `PERMISSION_DENIED` + 类型化的授权原因 |

混淆这两个阶段是一个常见的错误模式。有效的令牌并不意味着拥有权。缺少令牌并不是授权失败。

## 授权所有权姿态

授权所有权规则管理哪种主体拥有哪种类型的资源。主体类型包括：

| 主体类型 | 来源 |
| --- | --- |
| 第一方 Nimi 用户 | `RuntimeAccountService` |
| 准入的第一方应用 | 第一方范围绑定 |
| 本地第一方机器行为者 | 运行时内部权限 |
| 外部主体 (ExternalPrincipal) | `K-DELEG-*` 委托提供者网关 |

每种主体类型都有准入的授权域。跨域访问关闭；外部主体不能直接修改第一方账户拥有的资源。建议的修改从外部主体通过委托能力网关和输出防火墙路由。

认证通过不代表受保护 App 来源或操作授权。Bearer 被拒绝后，不能回退为匿名执行，也不能绕过原生 Host 边界。

## 来源依据

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
