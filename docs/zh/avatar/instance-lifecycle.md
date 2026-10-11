# Avatar 实例生命周期

Avatar 实例是一个运行中的独立 Avatar 桌面进程，负责呈现一个经 Runtime 鉴权绑定的 LocalAgent。启动时系统支持恢复已有的活跃实例。智能体的会话绑定关系与对话连续性由底层 Runtime 集中管理，Avatar 仅负责本地桌面外壳与前端图形渲染的生命周期。

## 启动定位信息

调用方通过正式的 Avatar 宿主接口提交 `AvatarHostHandoffRequest`。其中的 `target` 指定当前会话的 Agent，也可以指定确切的对话。字段如下：

| 字段 | 输入要求 | 用途 |
| --- | --- | --- |
| `agentHandle` | 必填字符串 | 当前会话的 Agent handle，格式为 `agent_ref_` 加 43 位 base64url 字符；由调用方 App 会话与 Runtime 重新校验 |
| `conversationAnchorId` | 可省略，也可为字符串或 `null` | 调用方需要指定对话时，填写确切的对话锚点 |
| `avatarInstanceId` | 必须包含此字段；值为字符串或 `null` | 提示希望定位的已有 Avatar 实例，本身不代表授权 |
| `launchSource` | 必须包含此字段；值为字符串或 `null` | 有长度限制的来源标记，不授予操作权限 |
| `switchIntentRef` | 必须包含此字段；值为字符串或 `null` | 切换确认请求返回的一次性引用，只能在用户确认后重新提交 |
| `committedPresentationRef` | 必须包含此字段；值为字符串或 `null` | 指向已提交呈现结果的不透明引用 |
| `temporaryCustodyRef` | 必须包含此字段；值为字符串或 `null` | 临时托管的不透明引用 |

没有适用值的可空字段填写 `null`。所有字段都只是待校验的定位意向，必须经过调用方 App 会话与 Runtime 重新校验。启动请求不携带原始 Agent ID（`agentId`）、账号凭据、Realm 地址、会话历史、模型文件、校准参数或本地路径。只有 Desktop 宿主负责启动或聚焦原生 Avatar 进程，并授权在受保护的数据目录下准备视觉资产。

渲染器收到的是另一份启动上下文：`agentHandle`、必填的 `conversationAnchorId`，以及可为空的 `avatarInstanceId` 和 `launchSource`。其中不包含宿主私有的目标引用或账号凭据。传入的 handle 仍是定位提示，不能直接用来选择 Avatar 自己的 App 会话中的 Agent。

## 会话与对话绑定

Runtime 管理 Agent 身份与对话连续性；Desktop 保管原生宿主所需的私有启动和实例信息。Avatar 不保管账号凭据；它先确认自己的受保护 App 会话有效，再通过传入的确切对话锚点解析该会话可用的 Agent handle。后续操作使用这个会话的 handle，并读取 Runtime 返回的结构化结果。

如果会话、启动上下文或 Runtime 绑定缺失或无效，产品交互不会开放。窗口会显示对应的诊断信息，帮助调用方恢复会话或重试。

## 就绪条件与本地诊断

Avatar 根据当前会话、驱动、模型和启动条件选择窗口内容。排查 App 时，可以参考当前实现中的 `CompositionState`：

| 诊断值 | 含义 |
| --- | --- |
| `loading` | 窗口或 Runtime 的准备工作尚未完成 |
| `ready` | 会话、驱动和模型条件已满足；开放交互还需要后端呈现就绪 |
| `fixture_not_verified` | 开发预览可以显示模型，但不表示产品已就绪 |
| `degraded_reauth_required` | 受保护的 App 会话需要认证或续期 |
| `degraded_cloud_offline` | 所需的 Realm 传输不可用 |
| `degraded_runtime_unavailable` | Runtime 绑定、驱动或模型条件不满足，需要查看具体诊断原因 |
| `degraded_launch_context_invalid` | 渲染器启动上下文未通过校验 |
| `error_bootstrap_fatal` | 启动失败，错误不属于已分类的会话、启动参数或 Runtime 问题 |

模型视图能否挂载取决于 `renderable`，其中包括明确标注的开发预览。开发预览不开放产品交互，也不能证明 Runtime 绑定有效。产品交互和 Companion 面板还需要有效的 Runtime 绑定、驱动、模型条件与已就绪的后端呈现。条件不足以显示模型时，Avatar 展示对应的诊断界面。

## 典型场景：从主桌面端唤起 Avatar

1. **提交定位意向**：调用方通过 Avatar 宿主接口提交当前会话的 `agentHandle`，需要指定对话时同时提供确切的对话锚点。
2. **重新校验请求**：Desktop 和 Runtime 校验调用方与目标，Desktop 随后启动或聚焦对应实例。切换到另一位 Agent 时，必须获得用户确认并重新提交返回的一次性切换引用。
3. **解析本会话的 Agent**：Avatar 确认自己的受保护 App 会话有效，再通过渲染器启动上下文中的必填对话锚点解析该会话的 Agent handle。
4. **准备授权资产**：Desktop 宿主授权在受保护的数据目录下准备经 Runtime 校验的确切视觉包。
5. **初始化渲染引擎**：Avatar 初始化适配的渲染分支（如 Live2D），等待图形管线完成首帧输出。
6. **开放交互**：会话、驱动、模型和后端呈现均满足要求后，窗口才开放产品交互。

启动请求和渲染器启动上下文不携带模型文件本体、私钥或账号凭据。

## 典型场景：Runtime 服务暂时中断

1. **异常状态捕获**：Avatar 运行期间检测到底层 Runtime 心跳断开。
2. **显示诊断原因**：当前 Runtime 绑定或驱动变为不可用，产品交互停止，窗口显示具体原因。
3. **卸载产品界面**：当前条件不允许渲染时，模型舞台和 Companion 面板卸载。
4. **重试**：Runtime 恢复可用后，使用重启操作建立新的会话。绑定与呈现检查通过后，交互才会恢复。

## 权责所有权速查

| 核心事项 | 归属所有者 |
| --- | --- |
| LocalAgent 认知执行与对话状态机 | Runtime |
| Agent handle 与对话的重新校验 | 调用方 App 会话与 Runtime |
| 原生实例的启动、聚焦与资产准备授权 | Desktop 宿主控制面 |
| 渲染器启动上下文校验 | Avatar 使用 Kit 解析器完成 |
| 桌面窗口生命周期与前端交互展示 | Avatar |
| 引擎图形资源解算与平滑释放 | Avatar 各渲染后端分支 |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`kit/features/avatar/src/host-handoff-port.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/host-handoff-port.ts)
- [`kit/features/avatar/src/launch-handoff.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/launch-handoff.ts)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
