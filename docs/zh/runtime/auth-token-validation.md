# 认证令牌验证

> 状态：运行中 (Running)。承载令牌验证表面 (`K-AUTHN-*`) 和授权所有权规则已发布。

运行时会验证每个传入的 `K-AUTHN-*` 下的承载 JWT，并将验证后的身份绑定到授权所有权规则。**认证 (AuthN)** 询问“这是谁？”；**授权 (AuthZ)** 询问“这个主体被允许拥有/修改什么？”。这两者是故意分开的。

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
| 允许的算法 | 允许列表（阶段 1: `RS256` / `ES256`） |
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
| 偏移窗口 | 固定（阶段 1: `±60s`） |
| 超出窗口 | 令牌无效；没有软容忍度 |

在偏移窗口内的令牌会被验证。超出窗口则不会。运行时不进行协商。

## 会话撤销检查

签名验证通过后，如果会话域可用，运行时仍会检查会话撤销。

| 规则 | 值 |
| --- | --- |
| 已撤销/过期的会话 | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID` |
| 自省端点 | `auth.jwt.revocationUrl` |
| 自省所需的声明 | `sid` |
| 缺少配置 (`issuer` / `audience` / `jwksUrl` / `revocationUrl`) | 承载 JWT 路径关闭 |

自省合同是固定的：向 `revocationUrl` 发送 `POST` 请求，JSON 正文包含 `session_id`、`subject_user_id`、`issuer`、`audience`、`issued_at`、`expires_at`。响应正文必须包含 `active: boolean`、`revoked: boolean`，可选 `expires_at`。`revoked=true` 或 `active=false` 都算作已撤销。网络错误/非 2xx/格式错误的响应**不得**降级为匿名；它们关闭。

## 认证与授权

这两个阶段是不同的，并按固定顺序执行：

| 阶段 | 问题 | 失败代码 |
| --- | --- | --- |
| 认证 (AuthN) | “这个令牌有效吗？它代表谁？” | `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID` |
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

## 读者场景：有效的令牌访问领域数据

1. **应用调用领域数据 API**，带有运行时发布的短寿命令牌在 `authorization: Bearer <jwt>` 中。
2. **运行时验证。** 头部解析。算法在允许列表中。`kid` 通过 JWKS 缓存解析。签名有效。声明 (`iss`, `aud`, `sub`, `exp`, `iat`) 都检查通过；时钟偏移在窗口内。
3. **撤销检查。** 会话处于活动状态。
4. **认证通过。** 身份绑定到请求。
5. **授权运行。** 数据操作根据绑定主体的所有权规则进行检查。
6. **授权通过。** 操作继续。

## 读者场景：带有 `alg=none` 的令牌

1. **应用发送头部。** JWT 有 `alg=none`。
2. **认证拒绝。** `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。
3. **无回退。** 运行时不会降级为匿名；应用看到类型化的拒绝。

## 读者场景：已撤销的会话

1. **令牌验证通过。** 签名 OK；声明 OK。
2. **自省发现会话已撤销。** `revoked: true`。
3. **运行时拒绝。** `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。
4. **应用通过 `RuntimeAccountService` 重新认证来恢复。**

## 令牌验证不做的事情

- 它不会从调用者提供的数据中发明 `subject_user_id`。
- 它不会在头部格式错误时默默地丢弃身份。
- 它不接受 `alg=none`。
- 它不允许 JWKS 刷新失败降级为匿名。
- 它不允许自省失败降级为匿名。

## 来源依据

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`docs/authority/runtime-security-core-rationale.md`](https://github.com/nimiplatform/nimi/blob/main/docs/authority/runtime-security-core-rationale.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)