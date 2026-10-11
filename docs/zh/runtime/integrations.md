# 外部服务与平台集成（Integrations）

通过 SDK 中的 `client.integration` 接口，Nimi 应用可以发现并调用已获授权的外部服务（如即时通讯机器人、开发工具）或其他 Nimi App 提供的能力。集成操作（Integration Operation）属于确定性的服务动作，区别于大模型自然语言生成，调用过程清晰高效。

## 连接建立与权限授权

用户可在 Nimi Home 的「集成」工作区中统一管理连接与授权凭证：

- **账号绑定与凭据托管**：用户在此绑定外部服务账号（如 Telegram Bot、飞书开放平台应用或 MCP 服务端）。敏感的 Token 和密钥由 Runtime 托管在受保护的本地存储中，前端界面仅能读取脱敏的连接摘要。
- **常设授权管理**：用户在 Nimi Home 的「集成」工作区中为特定应用预先授予调用目标和操作的常设权限。若调用缺少必要权限，Runtime 返回 `INTEGRATION_PERMISSION_REQUIRED`，由应用引导用户前往管理界面授权后再执行。
- **支持的协议范畴**：目前平台已支持 Model Context Protocol（MCP）、主流即时通讯接口适配器（如 Telegram、飞书等）。具体功能支持取决于该服务提供的能力 Schema。

## 调用的标准工作流

1. **服务发现**：应用调用 `client.integration.listCatalog()` 或 `client.integration.listConnections()` 获取可用集成连接器、连接实例及其支持的操作；
2. **发起调用**：调用 `client.integration.invoke()` 传入目标标识、操作名及符合参数校验规则的入参；
3. **状态监听**：接口返回任务引用，应用可通过 `getCall` 轮询或监听回调，处理完成、等待确认或异常中断；
4. **结果归档**：将获得的执行结果安全整合至当前应用的业务逻辑中。

## 异常处理与幂等性

- **外发操作的不可逆性**：对于向外部平台发送消息等产生外部副作用的操作，若发生网络超时，建议先检查调用状态而非盲目自动重试，避免重复发送多条消息；
- **优雅降级**：若外部服务暂时离线或凭据过期，系统将返回明确的错误说明，指导用户前往控制面板重新授权或检查网络。

## Source Basis

- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-integration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-integration.ts)
