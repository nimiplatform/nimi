# 可用性与能力限制

依赖功能前，核对确切能力、实现、包组合和执行模式。Provider 名称、目录条目、构建成功或窗口可见，都不能单独证明请求受支持。

## 常见误解

| 假设 | 应检查什么 |
| --- | --- |
| 模型已安装，AI 就可用 | 选中的 Loadout、资源与环境、owner AIConfig、权限及实际执行 |
| 云连接支持全部操作 | 确切目标的 Runtime 能力与功能选项 |
| Job 事件显示完成，输出就已保存 | 完整终态 Get、正式结果读取及 App 自有存储 |
| 本地导入等于目录批准 | 本地导入与 Registry 准入各自的来源和信任规则 |
| 仓库中有版本号，就能公开安装 | 组件实际发布状态；开发时使用完整本地包 |
| 切换 App 或设备会自动共享全部记忆 | 同一已授权 LocalAgent、Conversation 与 Cognition 的 Agent 私有记忆边界 |
| 本地优先不需要账号或网络 | 当前账号、受保护会话、来源获取及具体操作前提 |

强类型 unavailable、blocked 或 failed 都有实际含义。不要替换成示例成功、静默切换实现或绕过受保护宿主。另见 [兼容性](/zh/reference/compatibility-posture)、[App 开发环境](/zh/start/install) 与 [Job 观察](/zh/runtime/streaming)。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
