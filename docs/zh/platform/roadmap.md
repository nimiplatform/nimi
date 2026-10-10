# 产品方向与可用性

Nimi 把本地与云端 AI、App 和 AI 角色组织成个人产品。产品可用性见[下载状态](https://nimi.ai/download)，当前源码工具链见[开发环境](/zh/start/install)。

## 按当前接口开发

当前开发接口将 App AIConfig、机器 Loadout、受保护 App 会话与 Runtime 执行分别管理。Agent 对话使用 Runtime 连续性和可选 Cognition Memory；Knowledge V1 没有活动公共路径。

App 开发、本地包导入、验证目录分发与产品公开发布是不同阶段。前提和平台限制见 [App 开发与分发](/zh/start/#本地开发与对外分发)。已有实现或本地构建成功，都不能单独证明公开发布就绪。

## 未来能力

通用 Workflow、World Evolution、算力联邦、市场结算和未准入协议适配器，不会仅因进入架构方向就成为可用 API。它们缺失不应阻塞无关的已准入能力，路线图提及也不代表交付日期或自动启用。

需要某项能力时，先查看 [SDK](/zh/sdk/) 当前强类型接口。操作或具体实现组合不可用，就保留真实失败，并关注对应组件变更后再依赖它。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
