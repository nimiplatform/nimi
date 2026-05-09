# Agent Script（NAS）

NimiAgentScript（NAS）是一套基于约定的 JS 处理器系统，由它驱动 Avatar 的具身化表现。Avatar 包作者把 JS 文件放到约定路径下，Runtime 自动注册；Tauri notify watcher 负责热加载。

## 三类处理器

| 类别 | 路径 | 触发时机 |
| --- | --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` | 某次活动被请求时 |
| Event | `<model>/runtime/nimi/event/<name>.js` | 强类型事件发生时（例如点击身体某区域） |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` | 准入条件成立期间，持续运行 |

另有 `lib/` 目录用于共享代码。

## 约定优先于配置

| 属性 | 值 |
| --- | --- |
| 基于路径的注册 | 是。文件放在约定路径下就是一个已注册处理器 |
| 是否需要 manifest | 否。约定路径已经足够 |
| 热加载 | 是，由 Tauri notify watcher 监听 |
| 作用域 | 按模型隔离 |

作者不需要写"注册这个处理器"的调用。**路径本身就是注册**。

## 处理器可用的 API

| API | 用途 |
| --- | --- |
| Motion | 触发动作序列 |
| Expression | 设置表情 |
| Pose | 设置姿态 |
| Lookat | 设置视线方向 |
| Params | 驱动准入的 Live2D 参数（或宿主无关的等价参数） |
| Wait | 等待准入的时序原语 |

NAS 处理器通过具身化语义层访问这些 API。它不会直接调用 Live2D / VRM 内部接口；语义层就是那道强类型边界。

## 类型收窄后才可用的后端扩展

Live2D 专用处理器在类型收窄之后可以用 `live2dExtension`。VRM 上线后，VRM 专用处理器也会有自己的扩展，使用前同样要先做类型收窄。跨后端的处理器只用宿主无关 API。

## 场景：Activity 处理器播放挥手动画

某个包作者希望 Agent 在 `wave` 活动触发时挥手。

1. **写处理器**：放在 `<model>/runtime/nimi/activity/wave.js`，处理器签名同时获取 Runtime 上下文与准入的 API。
2. **自动注册**。Runtime 扫描约定路径，发现该文件后自动注册。
3. **活动触发**：当 `runtime.agent.activity.wave` 被发出时，处理器开始执行。
4. **处理器执行**：调用 motion API 触发挥手；调用 expression API 切到微笑；调用 wait 让姿态保持一会；最后调用 expression 回到中性。
5. **具身化渲染**：Live2D 后端把整段动画呈现出来。

作者只是把一个 JS 文件放到约定路径下，剩下的交给系统。

## 场景：Event 处理器响应点击

某个包作者希望 Agent 在头部被点击时有反应。

1. **写处理器**：放在 `<model>/runtime/nimi/event/onClickHead.js`。
2. **声明命中区域**：Avatar 包内用 alpha 蒙版描述 "head" 的命中边界。
3. **用户点击头部**：命中检测发出 `avatar.user.click` 事件，附带区域信息。
4. **处理器执行**：触发一个害羞表情，加上一段轻量音效。

整个过程作者没有显式订阅事件，约定路径已经够用。

## 场景：Continuous 处理器维持呼吸

某个包作者希望 Agent 持续呼吸。

1. **写处理器**：放在 `<model>/runtime/nimi/continuous/breathe.js`。
2. **自动注册为持续型**：Runtime 在准入的持续时序原语下调用它。
3. **持续运行**：驱动呼吸参数（Live2D 的 `ParamBreath`）。
4. **可与其它处理器叠加**：Activity 处理器叠加上来时不会打断呼吸。

环境氛围层的细微行为，正是通过 continuous 处理器一层层叠加而互不冲突。

## 开发期的热加载

| 工具 | 行为 |
| --- | --- |
| Tauri notify watcher | 监听文件系统变更 |
| 自动重注册 | 新增或修改的处理器即时生效 |
| 删除处理 | 删除文件即注销处理器 |
| 错误处理 | 强类型重载错误不会影响当前会话 |

作者迭代处理器时不需要重启 Avatar。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| 处理器发现 | `<model>/runtime/nimi/` 下的约定路径 |
| 处理器 API | 具身化语义层方法 |
| 后端扩展 | 类型收窄后的后端专属扩展 |
| 热加载 | Tauri notify watcher |

## Source Basis

- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
