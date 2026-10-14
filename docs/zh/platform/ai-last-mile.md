# AI 执行链路（AI Execution Last Mile）

LocalAgent 的 AI 执行链路涵盖了从已授权意图提交、Runtime 本地智能体（LocalAgent）编排与推理，到最终向消费应用返回结构化只读投影的完整端到端闭环。

在分层架构中：
- **Runtime** 统一管理 LocalAgent 会话生命周期、记忆路由、本地与云端模型调度、底层驱动选择、安全校验、Token 预算控制以及应用访问授权；
- **SDK** 提供受控、类型安全的公共调用接口；
- **App** 负责自身的产品交互与渲染呈现，不管理底层执行状态，亦不持有私有凭据。

## 核心调用链路

1. **意图提交**：用户或应用通过 SDK 提交结构化的操作意图（Intent）。
2. **会话鉴权**：Runtime 从当前活跃的安全会话中解析用户账号、调用方 App 身份、授权范围以及对目标 LocalAgent 的访问权限。
3. **能力评估与配置锁定**：Runtime 评估意图所需能力、授权策略、资源配额与预算，并在任务提交时锁定本地模型配置（Local Loadout）或指定的云端模型参数。
4. **安全校验与提交**：Runtime 在提交智能体会话历史或更新本地状态前，严格校验模型输出的安全性与格式规范。
5. **视图返回**：调用方仅接收到经过结构化处理的只读业务视图，完成本次交互。

大模型服务商 API Key、解析器底层日志、内部鉴权凭证及智能体私有上下文均被严格限制在 Runtime 内核中，绝不泄漏至应用层。

## 受控的外部扩展能力

系统支持单独接入受控的外部操作（External Actions），但该扩展并不属于上述核心对话链路的前置依赖。即便外部工具或扩展操作不可用，基础的智能体对话、记忆检索、语音合成与普通 AI 推理依然稳定运行。

关于该安全边界的详细设计，请参阅 [受控委派能力](/zh/runtime/delegated-capability)。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
