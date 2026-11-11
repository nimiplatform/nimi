<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.platform.governance-release.p-gov-026-supported-completeness"],"sources":["VISION.md","app-tools/package.json","kit/package.json"]} -->

# 当前能力与演进方向

Nimi 从 PC 主 Runtime 和多端消费链路出发，逐步扩展用户可控的 AI 生活环境。产品安装信息见[下载页](https://nimi.ai/download)，源码与公开包的区别见[环境准备](/zh/start/install)。

| 方向 | 当前边界 | 进一步交付所需条件 |
| --- | --- | --- |
| PC 原生 App | 本机受保护会话；包生命周期面向 macOS arm64、Windows x86_64 | 对应制品、签名和真实安装/调用路径验证 |
| Web 消费 | 当前源码提供 HTTPS 来源、官方登录和主 Runtime 直连 | 正式来源、可信证书、协调服务与目标网络验证 |
| Android | Kit Capacitor 与织羽开发入口；Scheme 和 App Link 分开 | 真机、签名、回调及分发路径分别验证 |
| 更多移动终端 | 当前没有通用的其他平台原生工厂 | 平台适配器、回调身份、前后台生命周期与真实消费链路 |
| 嵌入式与智能家居 | 长期方向；当前不据此宣称通用设备控制能力 | 选定真实任务，明确设备角色、资源限制、动作权限、结果反馈与失联行为 |
| 更多 Runtime 主机与联邦 | 当前直接访问一个主 Runtime，不自动跨主机同步 | 单独确定执行归属、数据一致性、网络和故障处理合同 |

Nimi 的长期愿景并不要求每个终端都部署 Runtime，也不会让消费设备自动获得管理权限。在接入与交付过程中，已保存配置、连接成功、请求成功与公开发布各自代表不同阶段的结果，不能混同。

角色长期记忆继续由 Cognition 按 Agent 隔离；Knowledge V1、通用 Workflow、自主世界演化与市场结算各有独立的后续演进边界，不能仅凭路线图中的名称直接调用。开发时请使用当前公开的类型接口，并在遇到不支持的操作或网络条件时展示明确结果。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
