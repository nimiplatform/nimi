# 外部 Agent 接入控制

> **功能状态**：预留 / 开发中。桌面端在「高级与诊断 → 权限与访问」中为外部 Agent 接入预留了管理展示界面。在底层动作注册中心（Action Registry）与网关基础设施就绪前，令牌签发与外部调用保持禁用。

外部 Agent 接入（External Agent Access）旨在支持第三方外部 AI 工具（例如 IDE 插件、自动化工作流智能体）在安全可控的前提下接入 Nimi 体系。通过为外部主体签发具有明确权限范围（Scopes）与时效限制的访问凭证（Token），用户可以放心地让外部工具与本地或云端资源进行受限交互。

关于外部 Agent 的整体安全模型与接入规范，请参阅[平台 → 外部 Agent 接入](/zh/platform/agents/external-agents)。

## 当前支持状态与安全机制

| 控制维度 | 当前行为 | 设计意图 |
| --- | --- | --- |
| **状态读取** | 桌面端支持查询 Runtime 外部接入网关的就绪状态 | 明确掌握当前服务的连接与运行情况 |
| **动作注册表（Action Registry）** | 底层动作注册中心尚未就绪时（`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`），令牌签发保持禁用 | 严格执行默认关闭的安全策略，防止无约束操作 |
| **凭证账本（Token Ledger）** | 展示当前令牌状态及签发被延迟的原因 | 提供透明的权限管理展示，避免提前签发无效凭证 |
| **吊销契约** | 吊销接口作为预留安全控制已定义在规范中 | 为后续正式开放后的即时撤销提供协议保障 |

## 安全保障设计

为了保障用户的本地数据与数字资产安全，Nimi 在外部接入层面遵循严格的安全红线：

- **权限最小化**：每个签发的凭证均严格限定其能够调用的动作（Actions）与数据边界。
- **透明审计**：外部 Agent 发起的调用与关键决策均记录在受管、脱敏且有界的本地审计事件中。
- **防越权拦截**：未在动作注册表中明确授权的敏感操作，会被网关层直接拒绝。

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
