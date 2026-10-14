# 产品愿景与设计哲学

Nimi 的核心理念非常纯粹：你的个人 AI，应当真正属于你自己。它应当在你身边的设备上运行，深度理解并记住对你重要的事物，全心对你负责，而非受控于任何中心化平台的意志。

正因如此，Nimi 坚定选择**本地优先（Local-First）**路线：
- 它是安装在你本地设备上的软件，你所对话的智能体运行在你自己的机器上，由你自由指定本地模型或按需调用云端服务；
- 无论角色和世界如何延展，它们的身份认同都保持连贯统一；
- 系统的各个子模块各司其职，没有哪一个部分会越界成为所有数据的绝对主宰——角色是谁（身份）、它如何决策（运行态执行）、它在屏幕上如何呈现（具身渲染），被清晰划分为三道明确的职责边界。

对普通用户而言，这意味着拥有一位真正私密、值得托付且属于自己的数字伙伴；对开发者而言，这意味着一套边界稳定、契约清晰且可安心在其上构建创新的技术底座。

## 持久身份，本地执行

与用户朝夕相伴的 AI 角色，是由 Realm 维护的持久化身份：无论用户造访哪一个数字世界，它都是同一个角色。当开启新对话时，Runtime 会基于 Realm 提供的角色描述定义，在本地设备上实例化出专属的 LocalAgent。一个角色定义可以派生出多种多样的本地交互体验，而每个 LocalAgent 都在用户设备上独立维护其运行状态与上下文。

## 严格受控的用户授权

应用通过 SDK 以标准化、强类型的接口发起调用请求。Runtime 依据当前活跃的安全会话，严格核验用户身份、调用发起方应用以及被请求的操作权限范围。第三方应用无法获取用户的 Realm 凭证、模型服务商 API 密钥，也无法获取 Runtime 内部的会话令牌。

## 结构化投影与视图共享

对话流、长期记忆检索、知识关联、语音合成与形体呈现均由 Runtime 与相关子系统统一调度。其他应用和展示层仅能获取经过精细授权、结构化的只读视图。Avatar 能够生动细腻地呈现角色的表情、视线与动作，而无需接管背后的 LocalAgent 决策循环。

## 渐进式架构演进

当前 Nimi 稳定运行的核心闭环，不依赖复杂的通用工作流编排（Workflow）、外部协议扩展（MCP）、自主世界演化（World Evolution）、公共市场分发或商业结算。未来更强大的系统能力将在各自清晰的边界内逐步引入，且绝不破坏「角色在本地实例化为 LocalAgent 执行」这一底层核心基石。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
