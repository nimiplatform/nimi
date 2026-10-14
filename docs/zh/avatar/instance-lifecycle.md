# Avatar 实例生命周期

Avatar 实例是一个运行中的独立桌面应用进程，用于呈现经 Runtime 授权绑定的 LocalAgent。启动器也可以重新连接到已有的 Avatar 实例。Agent 的会话连续性与绑定关系由 Runtime 统一管理，Avatar 外壳则负责本地窗口与渲染器的生命周期。

## 启动定位信息

调用方通过正式的 Avatar 宿主接口提交 `AvatarHostHandoffRequest`。其中的 `target` 用于指定当前会话的 Agent，并在需要时指定确切的 Conversation。字段定义如下：

| 字段 | 输入要求 | 用途 |
| --- | --- | --- |
| `agentHandle` | 必填字符串 | 当前会话的 handle，格式为 `agent_ref_` 加 43 位 base64url 字符；需经调用方 App 会话与 Runtime 重新校验 |
| `conversationAnchorId` | 可选字符串或 `null` | 调用方提供时，用于指定确切的对话锚点 |
| `avatarInstanceId` | 必填键；字符串或 `null` | 指向已有 Avatar 实例的非受信提示 |
| `launchSource` | 必填键；字符串或 `null` | 长度受限的来源标记，不具备授权效力 |
| `switchIntentRef` | 必填键；字符串或 `null` | 切换确认请求返回的一次性引用，仅在用户确认后重新提交 |
| `committedPresentationRef` | 必填键；字符串或 `null` | 指向已提交呈现结果的不透明引用 |
| `temporaryCustodyRef` | 必填键；字符串或 `null` | 指向临时托管状态的不透明引用 |

无适用值的可空字段请填写 `null`。在调用方 App 会话与 Runtime 完成重新校验前，所有字段都只是非受信的定位意向。请求中不包含原始 Agent ID（`agentId`）、账号凭据、Realm 地址、会话历史、模型文件、校准参数或本地路径。只有 Desktop 宿主能启动或聚焦原生 Avatar 进程，并授权在受保护数据根目录下解包准备视觉资产。

渲染器会收到一份独立的启动上下文，包含 `agentHandle`、必填的 `conversationAnchorId`，以及可为空的 `avatarInstanceId` 和 `launchSource`，不包含宿主私有目标引用或账号凭据。传入的 handle 仅作为定位提示，不能在 Avatar 自己的 App 会话中直接复用为 Agent 选择器。

## 会话与对话绑定

Runtime 管理 Agent 身份与对话连续性；Desktop 保存原生宿主所需的私有启动与实例信息。Avatar 先验证自身的受保护 App 会话，再使用传入的确切对话锚点解析出签发给当前会话的 Agent handle。后续操作均使用该会话的 handle 及 Runtime 返回的强类型结果。

如果会话、启动上下文或 Runtime 绑定缺失或无效，窗口将阻止产品交互并显示诊断信息，方便调用方恢复会话或重试。

## 就绪条件与本地诊断

Avatar 根据当前会话、驱动、模型及启动先决条件决定窗口展示的视图。可通过当前 App 本地的 `CompositionState` 诊断状态原因：

| 诊断值 | 含义 |
| --- | --- |
| `loading` | 窗口或 Runtime 准备工作尚未完成 |
| `ready` | 会话、驱动与模型条件允许展示产品视图；开启交互还需后端呈现就绪 |
| `fixture_not_verified` | 开发模型可以渲染，但产品就绪状态仍为 false |
| `degraded_reauth_required` | 受保护的 App 会话需要认证或续期 |
| `degraded_cloud_offline` | 所需的 Realm 传输不可用 |
| `degraded_runtime_unavailable` | Runtime 绑定、驱动或模型先决条件不可用，请检查具体诊断原因 |
| `degraded_launch_context_invalid` | 渲染器启动上下文未通过校验 |
| `error_bootstrap_fatal` | 启动失败，且错误不属于已分类的会话、启动或 Runtime 故障 |

当本地组合状态中的 `renderable` 为 true 时，模型视图即可挂载（包括明确标记的开发预览）。但开发预览不接受产品交互，也不能证明 Runtime 绑定有效。产品交互和 Companion 界面还要求基于 Runtime 的组合状态有效且后端呈现就绪。若先决条件不满足，Avatar 会显示对应的诊断视图。

## 典型场景：从 Desktop 启动 Avatar

1. **提交目标**：调用方通过 Avatar 宿主接口发送当前会话的 `agentHandle`，并在需要时附带确切的对话锚点。
2. **重新校验请求**：Desktop 与 Runtime 校验调用方和目标。Desktop 启动或聚焦匹配的实例；若需切换到其他 Agent，必须先经用户确认并附上返回的一次性切换引用。
3. **解析当前会话的 Agent**：Avatar 验证自身的受保护 App 会话，再根据渲染器启动上下文中必填的对话锚点，解析当前会话的 Agent handle。
4. **加载授权资产**：Desktop 宿主授权在受保护数据根目录下准备经 Runtime 校验的视觉资产包。
5. **初始化图形分支**：Avatar 初始化当前激活的图形分支（如 Live2D），并等待首帧渲染完成。
6. **开放交互**：当会话、驱动、模型和后端呈现全部就绪后，窗口开放产品交互。

启动请求与渲染器启动上下文均不携带原始资产文件、私钥或账号令牌。

## 典型场景：Runtime 变为不可用

1. **心跳中断**：Avatar 运行期间，所需的 Runtime 服务连接断开。
2. **显示诊断信息**：当前 Runtime 绑定或驱动变为不可用，产品交互随之停止，窗口显示对应原因。
3. **卸载产品界面**：在组合状态不可渲染期间，模型舞台与 Companion 界面会被卸载。
4. **重试恢复**：Runtime 恢复后，可通过重启操作建立新会话；待绑定与呈现检查全部通过后，产品交互才会恢复。

## 职责归属速查

| 事项 | 归属方 |
| --- | --- |
| LocalAgent 认知执行与连续性 | Runtime |
| Agent handle 与 Conversation 重新校验 | Runtime（经由调用方 App 会话） |
| 原生实例启动、聚焦与资产准备授权 | Desktop 宿主控制面 |
| 渲染器启动上下文校验 | Avatar（使用 Kit 解析器） |
| 桌面窗口生命周期与交互呈现 | Avatar |
| 图形资源编译与销毁 | Avatar 渲染后端分支 |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`kit/features/avatar/src/host-handoff-port.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/host-handoff-port.ts)
- [`kit/features/avatar/src/launch-handoff.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/features/avatar/src/launch-handoff.ts)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
