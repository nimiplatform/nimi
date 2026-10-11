# Avatar 后端诊断

Avatar 的本地诊断检查当前模型、能力配置、路由及呈现结果，不授予额外 Runtime 权限。它是 Avatar 内部工具，不是第三方 App 的独立诊断 API。

## 当前返回结果

内部 factory 返回 AvatarDebugSession，而不是 DiagnosticSessionResult：

| 字段 | 含义 |
| --- | --- |
| `debugSessionId` | 本地诊断会话标识 |
| `probeId`、`probeKind` | 这次检查的标识与类型 |
| `avatarInstanceId` | 可空的当前实例引用 |
| `avatarPackageRef` | 可空的资源包引用 |
| `backendCapabilityProfileRef` | 可空的能力配置引用 |
| `backendKind` | live2d 或 vrm |
| `observedAt` | 观察时间 |
| `evidence` | 一个 AvatarDebugEvidence 对象，不是数组 |

Evidence 含 evidenceId、evidenceKind、status、source、可空 reasonCode 和有界 refs。status 为 passed、failed、unsupported 或 invalid。消费者读取单个 evidence，不调用 evidence.map；后端字段名为 backendKind，不是 backend。

## 结果含义

诊断可以检查包描述、后端加载、能力配置、路由支持、生成动作、表情、口型或载体结果。每次结果只证明它实际检查的对象与条件。结构或本地诊断通过不证明真实 App 会话、任意模型或另一后端已经验收。

失败时保留当前 reasonCode 和对应引用，先修复所指的模型或配置问题；不把 unsupported 转为成功待机。实际返回类型与工厂实现见下方源码。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts)
- [`apps/avatar/src/shell/renderer/avatar-debug/contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/contract.ts)
