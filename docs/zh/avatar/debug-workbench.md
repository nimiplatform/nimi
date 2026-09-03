# 调试工作台

## 状态：已准入平台方向

调试工作台以契约形式定义，横跨 Avatar（接入与后端证据）和 Runtime（探测信封与回放）。面向用户的工作台工具是已确定的方向，当前不是公开应用 API。

## 调试工作台是什么

工作台是开发者**探测** Avatar 实例的地方——问一句"这个后端支持生成式动作吗？""这条语音链路带口型同步吗？""这个命中区域解析得出来吗？"——然后拿到一份强类型、可回放的结果。

探测的职责被有意拆开，答案才可信：

- **Runtime** 定义探测请求、结果和回放的语义。一次探测就是一个 Runtime 强类型信封，Runtime 先验证调用者有没有权限，再把探测发出去。
- **Avatar** 负责后端证据。探测问到后端相关的内容时（能力配置验证、生成式动作路由支持、载体诊断），由 Avatar 产出证据引用。
- **桌面端**负责工作台布局，也就是最终发起探测、展示结果的界面。

## 探测请求包 (Runtime 拥有)

| 字段 | 必需? | 备注 |
| --- | --- | --- |
| `probe_id` | 是 | 每个探测唯一 |
| `agent_id` | 是 | 授权的代理目标 |
| `conversation_anchor_id` | 是 | 锚点范围 |
| `probe_kind` | 是 | 固定在 `tables/avatar-debug-probe-events.yaml` 中 |
| `requested_at` | 是 | ISO-8601 格式 |
| `requested_by` | 是 | 请求者身份 |
| `turn_id` / `stream_id` / `avatar_instance_id` / `runtime_replay_ref` | 可选 | 追踪字段 |

探测请求中禁止包含：

- 包描述符 / 包路径 (Desktop 不得注入这些内容)
- 原始 APML / MCP / A2A 提供者负载
- 令牌、账户 ID、用户 ID、Realm URL、认证材料
- 后端命令字符串

## 探测结果包 (Runtime 拥有)

| 字段 | 必需? | 备注 |
| --- | --- | --- |
| `probe_id` | 是 | 与请求匹配 |
| `agent_id` | 是 | — |
| `probe_kind` | 是 | — |
| `status` | 是 | `passed` / `failed` / `unsupported` / `blocked` / `invalid` |
| `observed_at` | 是 | ISO-8601 格式 |
| `evidence_refs` | 是 | Avatar 契约准入的 Avatar 拥有的证据引用 |
| `reason_code` | 是 | 类型化 |

`passed` 需要具体证据。`unsupported` / `blocked` / `invalid` 是终结性诊断结果。结果绝不暴露原始后端负载。

## Avatar 后端证据

Avatar 为以下内容生成证据：

- 包描述符解析器执行
- 后端加载结果
- 后端能力配置文件验证
- 生成式动作路由支持
- 情感 / 表情支持
- 语音 / 唇形同步支持
- 载体诊断和命中区域证据

证据形状由 `tables/avatar-debug-session.schema.yaml` 固定。Avatar 在授权的运行时 / SDK 映射后执行解析器——Desktop 仅存储不透明引用；Runtime 拥有授权；SDK 携带类型化引用和方法。

## 回放密钥

Runtime 拥有 Avatar 调试探测的回放密钥。密钥集固定在 `tables/avatar-debug-replay-keys.yaml` 中。回放记录必须保留类型化请求包、授权上下文以及 Avatar 拥有的证据引用，以便后续审计员能够确定性地重现结果。

## 读者场景：探测生成式动作路由支持

1.  **开发者发起探测。** 工作台界面发出一个运行时探测请求：`probe_kind: generated_motion_route_support`，目标 `agent_id`，可选 `avatar_instance_id`。
2.  **Runtime 授权 + 映射。** 验证请求者，将探测映射到 `runtime.agent.*` 映射空间。
3.  **Avatar 评估。** 解析包描述符，验证后端能力配置文件，对照 `tables/generated-motion-routes.yaml` 检查路由 ID，生成描述后端支持内容的证据引用。
4.  **Runtime 返回结果包。** `status: passed` 并附带证据引用，或者如果此后端不准入该路由，则返回 `unsupported` 并附带原因码。
5.  **审计员回放。** Runtime 回放重现结果，无需重新询问实时后端；证据引用作为证明的锚点。

## 读者场景：.vrma 文件并非调试成功证明

1.  **探测期望后端执行证据。**
2.  **发现一个 `.vrma` 文件。** 交换 / 创作证据——有用，但并非运行时支持证明。
3.  **Runtime / Avatar 闭环失败。** `.vrma` 不能将探测标记为 `passed`。结果为 `unsupported`（或后端实际支持情况），并附带类型化原因码。

契约是明确的，因为创作产物在未实际执行运行时路径的情况下，常常看起来像是成功。工作台旨在拒绝这种替代。

## 工作台不做什么

- 它不拥有 SDK 方法形状——SDK 仅携带类型化引用。
- 它不拥有 Desktop 产品布局——这是 Desktop 的职责。
- 它不拥有 APML 公共线路——runtime 拥有线路权威。
- 它不拥有委托的提供者访问权限——提供者集成是独立准入的。
- 它不会通过空闲回退或静态图像回退，将 `unsupported` 能力静默报告为成功。

## 边界总结

| 关注点 | 拥有者 | 界面 |
| --- | --- | --- |
| 探测请求/结果包 + 回放 | Runtime | `avatar-debug-projection-contract.md` (K-AGCORE-054..060) |
| 后端证据 | Avatar | `avatar-debug-session-contract.md` |
| 工作台用户体验 | Desktop | 当前不是公开应用 API |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
