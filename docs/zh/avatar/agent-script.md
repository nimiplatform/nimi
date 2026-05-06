# Agent Script

NimiAgentScript（NAS）是基于约定的 JS 处理器系统，驱动形体化。形体化包创作者把 JS 文件写在约定路径；runtime 自动注册；通过 Tauri notify watcher 热重载。

## 三种处理器

| 种类 | 路径 | 触发时机 |
| --- | --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` | Activity 被请求 |
| Event | `<model>/runtime/nimi/event/<name>.js` | 类型化事件发生（比如用户点身体区域） |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` | 持续，准入条件成立时 |

加 `lib/` 放共享代码。

## 约定优于配置

| 性质 | 值 |
| --- | --- |
| 路径式注册 | 是 — 文件在约定路径 = 已注册处理器 |
| 需要 manifest？ | 否 — 约定路径就够 |
| 热重载 | 是 — Tauri notify watcher 检测变化 |
| 范围 | 按 model |

作者**不**写「注册这个处理器」调用。路径**就是**注册。

## 可用的处理器 API

| API | 用途 |
| --- | --- |
| Motion | 触发动作序列 |
| Expression | 设表情 |
| Pose | 设姿势 |
| Lookat | 设凝视方向 |
| Params | 驱动准入 Live2D 参数（或后端无关等价物） |
| Wait | 等准入计时基础协议 |

NAS 处理器经形体化呈现 API 消费这些。它们**不**直接调 Live2D / VRM 内部；呈现层是类型化接缝。

## 类型窄化时的后端特定扩展

Live2D 特定处理器在类型窄化后能用 `live2dExtension`。VRM 特定处理器（VRM 上线时）将在自己类型窄化后用一个独立扩展。跨后端处理器留在后端无关 API。

## 阅读场景：Activity 处理器播 wave 动画

某包作者想让 Agent 在 `wave` activity 触发时挥手。

1. **写处理器。** 在 `<model>/runtime/nimi/activity/wave.js`。处理器签名暴露 runtime 上下文加准入 API。
2. **自动注册。** Runtime 扫描，发现约定路径下的文件，注册它。
3. **Activity 触发。** `runtime.agent.activity.wave` 发出时，处理器跑。
4. **处理器跑。** 调 motion API 触发 wave；调 expression API 设笑脸；调 wait 保持姿势；调 expression 回到 neutral。
5. **形体化渲染。** Live2D 后端渲染序列。

作者写了一个文件在某路径；其余自动。

## 阅读场景：Event 处理器响应点击

某包作者想让 Agent 在头被点时反应。

1. **写处理器。** 在 `<model>/runtime/nimi/event/onClickHead.js`。
2. **声明命中区域。** 形体化包里，「头」区域用 alpha-mask 边界声明。
3. **用户点头。** 命中区域检测发出 `avatar.user.click` 事件带区域信息。
4. **处理器跑。** 触发害羞表情和小音效。

处理器**不**必订阅；约定路径就够。

## 阅读场景：Continuous 处理器让 Agent 一直呼吸

某包作者想让 Agent 持续呼吸。

1. **写处理器。** 在 `<model>/runtime/nimi/continuous/breathe.js`。
2. **自动注册为 continuous。** Runtime 在准入持续计时基础协议下调用处理器。
3. **处理器持续跑。** 驱动呼吸参数（Live2D `ParamBreath`）。
4. **其他处理器组合。** Activity 处理器能在不停呼吸的情况下叠加。

Continuous 处理器是细微环境行为如何叠加而不互相打架的方式。

## 开发期间热重载

| 工具 | 行为 |
| --- | --- |
| Tauri notify watcher | 检测文件系统变化 |
| 自动重新注册 | 新 / 更新处理器被拾起 |
| 移除 | 删的文件取消注册处理器 |
| 错误 | 类型化重载错误**不**让 session 崩 |

包作者迭代处理器**不**必重启 Avatar。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 处理器发现 | `<model>/runtime/nimi/` 下约定路径 |
| 处理器 API | 形体化呈现方法 |
| 后端扩展 | 类型窄化后的后端特定扩展 |
| 热重载 | Tauri notify watcher |

## 来源

- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
