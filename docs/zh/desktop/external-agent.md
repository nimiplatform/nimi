# 外部 Agent 接入控制

> **功能状态**：预留 / 开发中。桌面端目前在「高级与诊断 → 权限与访问」中提供外部 Agent 接入的状态展示。在 Runtime 动作注册中心（Action Registry）与外部网关基础设施开放前，令牌签发与外部调用保持禁用。

外部 Agent 接入（External Agent Access）用于支持 IDE 插件、外部 AI 助手及自动化工作流等第三方工具，通过限定权限范围（Scopes）与有效期的访问凭证（Token）与 Nimi 交互。

关于平台侧的完整协议与安全模型，请参阅[平台 → 外部 Agent 接入](/zh/platform/agents/external-agents)。

## 桌面端当前行为

| 控制维度 | 当前行为 | 作用 |
| --- | --- | --- |
| **服务状态** | 显示 Runtime 外部接入网关的就绪状态 | 便于确认本地网关服务是否可连接 |
| **动作注册表（Action Registry）** | 当动作注册中心为空（`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`）时，保持令牌签发禁用 | 执行默认关闭（fail-closed）策略，避免在无可授权动作时签发凭证 |
| **凭证账本（Token Ledger）** | 显示令牌状态投射及当前暂不签发的原因 | 说明外部访问当前不可用的具体原因 |
| **吊销契约** | 在规范中将吊销接口定义为默认关闭控制项 | 为后续开放签发后的即时撤销预留协议能力 |

## 规划中的安全边界

当外部凭证签发与网关调用开放后，接入层遵循以下三项安全约束：

- **最小权限**：每个签发的凭证仅限调用指定动作（Actions）与数据范围。
- **有界本地审计**：外部调用、参数载荷与授权决策记录在脱敏且有界的本地审计事件中。
- **网关默认拦截**：未列入动作注册表的操作由网关直接拒绝。

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
