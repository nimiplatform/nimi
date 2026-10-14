# 产品规划与技术演进方向

Nimi 致力于将本地与云端 AI 算力、交互应用以及具备深度认同感的 AI 角色，融合为一个由用户自主掌控的个人产品。客户端与功能下载状态请参阅[下载中心](https://nimi.ai/download)，源码开发与工具链配置请参阅[开发环境安装](/zh/start/install)。

## 基于稳定接口开展开发

当前平台开发接口将应用 AI 配置（App AIConfig）、本地推理后端配置（Loadouts）、受保护应用会话与 Runtime 执行内核清晰解耦。智能体对话依赖 Runtime 内核维护的上下文连续性与可选的 Cognition 长期记忆；Knowledge V1 知识库接口当前暂未对外开放。

应用开发、本地包导入、官方审核目录分发与产品公开发布属于不同的生命周期阶段。具体前置条件与系统限制请参阅 [应用开发与分发指南](/zh/start/#三种运行与分发形态)。仅实现代码逻辑或本地编译成功，并不代表已达到公开发布的标准。

## 面向未来的演进能力

通用的工作流编排（Workflow）、自主世界演化（World Evolution）、分布式算力联邦、数字资产市场结算以及未经验证的实验性协议适配器，不会因为出现在架构规划中便直接成为可用 API。这些远期能力的暂缓引入，绝不影响当前核心功能的稳定可用，路线图中的规划提及也不代表确切的上线排期或自动激活。

在开发具体功能时，建议优先通过 [SDK](/zh/sdk/) 现有的类型安全接口开展集成。如果某个能力或底层实现的特定组合暂不可用，应当按规范捕获清晰的错误响应，并关注后续版本迭代，待其正式发布后再行集成。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
