# Avatar 后端诊断

Avatar 的本地诊断用于检查当前模型、能力配置、路由及呈现结果，不授予额外的 Runtime 权限。该机制属于 Avatar 内部工具，而非面向第三方 App 的独立诊断 API。

## 当前返回结果

内部工厂返回 `AvatarDebugSession`，而非 `DiagnosticSessionResult`：

| 字段 | 含义 |
| --- | --- |
| `debugSessionId` | 本地诊断会话标识 |
| `probeId`、`probeKind` | 这次检查的标识与类型 |
| `avatarInstanceId` | 可空的当前实例引用 |
| `avatarPackageRef` | 可空的资源包引用 |
| `backendCapabilityProfileRef` | 可空的能力配置引用 |
| `backendKind` | `live2d` 或 `vrm` |
| `observedAt` | 观察时间戳 |
| `evidence` | 单个 `AvatarDebugEvidence` 对象，非数组 |

`evidence` 包含 `evidenceId`、`evidenceKind`、`status`、`source`、可空的 `reasonCode` 以及有界的 `refs`。`status` 取值为 `passed`、`failed`、`unsupported` 或 `invalid`。消费者应直接读取单个 `evidence` 对象，不要调用 `evidence.map`；后端判别字段名为 `backendKind`，而非 `backend`。

## 结果含义

诊断可针对包描述符、后端加载、能力配置、路由支持、生成动作、表情、口型或载体验收结果进行检查。每次评估仅能证明其实际检查的对象与特定条件。结构或本地诊断通过，并不代表真实 App 会话已建立、任意模型均受支持，或另一后端已完成验收。

诊断失败时应保留返回的 `reasonCode` 与对应引用，优先修复所指出的模型或能力配置问题；严禁将 `unsupported` 静默转换为成功的待机动作。实际返回类型与工厂实现详见下方源码引用。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts)
- [`apps/avatar/src/shell/renderer/avatar-debug/contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/contract.ts)
