# 关键源路由

> 状态：运行中 (Running). 关键源路由 (`K-KEYSRC-001..K-KEYSRC-004`) 是用于 AI 请求的凭证路由表面。

当 AI 请求到达运行时，运行时将使用的凭证必须来自两个已准入路径之一：**托管连接器**（推荐）或**内联元数据**（逃生舱口）。混合使用这两种方式是被拒绝的；如果两者都缺失，则会回退到运行时配置默认值。

## 两个已准入路径

| 路径 | 凭证保管 | 推荐？ |
| --- | --- | --- |
| `connector_id` | `RuntimeConnectorService` (`K-CONN-001`: 保管者，非分发者) | 推荐 |
| `inline` (`x-nimi-key-source=inline` + 内联元数据) | 调用者（gRPC 元数据直接传递） | 逃生舱口 |

托管连接器路径是生产路径。内联路径仅适用于以下狭窄场景。

## 托管连接器认证形状

托管远程连接器支持两种认证形状：

| 认证形状 | 有效载荷 |
| --- | --- |
| `API_KEY` | 连接器保管持有 API 密钥 |
| `OAUTH_MANAGED` | 连接器保管持有提供商定义的密封密钥 + `tables/connector-auth-profiles.yaml` 中的 `provider_auth_profile` |

这两种形状都将凭证保留在连接器保管下。调用者只提交 `connector_id` —— 永远不提交原始密钥。

`OAUTH_MANAGED` 连接器必须保持 **用户所有**。如果运行时发现机器或系统所有的 `OAUTH_MANAGED` 记录，托管路径将因 `NOT_FOUND` 而关闭。

本地连接器在第一阶段不是 AI 消费执行入口；它们仅作为本地类别目录/探针外观 (`K-LOCAL-004`)。

## 内联路径定位（逃生舱口）

内联路径仅适用于以下狭窄场景：

- **开发/调试：** 开发者使用自己的 API 密钥进行测试，无需预先配置连接器
- **外部代理直接连接：** 第三方代理通过 SDK 直接连接到运行时，绕过桌面连接器管理 UI
- **一次性/临时调用：** 不需要持久化凭证的场景

桌面 (`D-SEC-009`) 始终使用托管连接器路径；渲染器从不接触原始 API 密钥。内联凭证的安全性由调用者负责 —— 运行时应用审计删除 (`K-AUDIT-005`, `K-AUDIT-017`)，但不对内联凭证提供额外的秘密保护。

## 互斥

`connector_id` 和任何内联凭证字段一起使用是 **被拒绝** 的：

| 组合 | 结果 |
| --- | --- |
| 仅 `connector_id` | 托管路径 |
| 仅内联元数据 | 内联路径 |
| 两者都有 | `AI_REQUEST_CREDENTIAL_CONFLICT` |
| 都没有 | 运行时配置/匿名本地默认路径 |

不存在“使用连接器但内联覆盖密钥”的模式。

## 第一阶段元数据键

| 键 | 用途 |
| --- | --- |
| `x-nimi-key-source` | `inline` 或 `managed` |
| `x-nimi-provider-type` | 提供商名称（来自目录的标准名称） |
| `x-nimi-provider-endpoint` | 端点 URL |
| `x-nimi-provider-api-key` | 内联 API 密钥（内联路径） |
| `x-nimi-app-id` | 用于管理 RPC 审计 |

## 评估顺序

AI 消费请求按固定顺序评估：

1. 解析正文和元数据（空 `connector_id` 规范化为“未提供”）
2. JWT 验证（如果存在）
3. `app_id` 非空检查
4. 密钥源 + 互斥检查
5. 加载连接器
6. 所有者/状态/凭证检查
7. 远程端点安全检查
8. 内联端点安全检查

步骤 6 解密凭证并将其注入请求范围的执行上下文（例如，`nimillm.RemoteTarget`）。下游执行模块（例如，nimiLLM）从执行上下文中读取凭证；它们 **不** 直接访问凭证存储。

## 读者场景：通过托管连接器的生产调用

1. **应用程序通过桌面的连接器管理 UI 获取 `connector_id`**（该 UI 与 `RuntimeConnectorService` 通信）。
2. **应用程序调用 AI 消费**，仅使用 `connector_id` —— 不使用 `x-nimi-provider-api-key`。
3. **运行时评估。** 步骤 4 看到托管路径；步骤 5 加载连接器；步骤 6 将凭证解密到执行上下文中。
4. **提供商调用。** nimiLLM 从执行上下文中读取凭证，调用提供商，返回响应。

渲染器/应用程序从未看到原始密钥。连接器保管是唯一的拥有者。

## 读者场景：外部代理使用内联

第三方代理通过 SDK 连接到运行时，并希望使用其自己的提供商 API 密钥。

1. **SDK 调用。** 包含 `x-nimi-key-source: inline`、`x-nimi-provider-type: ...`、`x-nimi-provider-endpoint: ...`、`x-nimi-provider-api-key: ...`。
2. **运行时评估。** 步骤 4 看到内联路径。步骤 8 验证内联端点安全性。
3. **提供商调用。** 内联凭证仅针对此请求注入执行上下文；不会持久化。
4. **审计。** 审计日志根据 `K-AUDIT-005` / `K-AUDIT-017` 删除凭证。

第三方代理的凭证安全性由其自己负责。运行时确保凭证不会通过审计泄露，但不提供进一步的秘密保护。

## 读者场景：冲突

调用者同时提交了 `connector_id` 和 `x-nimi-provider-api-key`。

1. **运行时评估。** 步骤 4 检测到互斥。
2. **拒绝。** `AI_REQUEST_CREDENTIAL_CONFLICT`。
3. **无静默优先级。** 调用者必须选择一个路径。

## 边界总结

| 关注点 | 拥有者 |
| --- | --- |
| 路径选择规则 + 互斥 | `K-KEYSRC-001..K-KEYSRC-002` |
| 元数据键形状 | `K-KEYSRC-003` |
| 评估顺序 | `K-KEYSRC-004` |
| 连接器保管 | `RuntimeConnectorService` (`K-CONN-001`) |
| 内联凭证安全性 | 调用者 |

## Source Basis

- [`.nimi/spec/runtime/kernel/key-source-routing.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/key-source-routing.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)