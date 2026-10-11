# 外部智能体与第三方生态接入机制（External Participation）

在 Nimi 的当前核心架构中，外部智能体（External Agents）与第三方外部动作集成属于受控的扩展能力，而非运行基础 LocalAgent 的必要前置。本地模型推理、智能体对话、长期记忆检索、语音合成、SDK 调用、Nimi Home 交互、Avatar 渲染以及普通应用程序的常规能力，均可在无外部集成的纯净环境下稳定运行。

未来若引入第三方生态或外部智能体集成，必须严格遵循 Nimi 的安全准入规范：
- 外部集成仅作为具备显式权限约束的受限安全主体（Scoped Principal），或作为受控的数据订阅者参与；
- 外部集成绝不会晋升为 Realm 中的 Character 实体、Runtime 中的 LocalAgent 实例，更无权接管会话与身份的权威所有权；
- 系统绝不会为了兼容外部系统而引入模糊的全局 `Agent` 概念。

所有外部输入必须通过 Runtime 与 SDK 明确声明的强类型安全边界。第三方大模型的原生私有负载、外部工具 Schema、传输通道凭据与远端执行日志，绝不会仅仅因为前端界面能够渲染展示，就默认成为合法的系统核心数据。

当前阶段，任何常规 Nimi 应用的开发与运行，均无需依赖外部动作执行平面。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
