# NAS 处理器编写指南

> 状态：运行中 (Running)。NimiAgentScript (NAS) 1.0 是已发布的处理器约定；自动发现和热重载功能已上线。

NimiAgentScript (NAS) 遵循**约定优于配置**的原则：具身包的作者只需将 JS 文件放入固定的目录结构中，Avatar 运行时便会自动发现它们。无需清单文件。文件路径即注册方式。

## 目录结构

```
<model>/runtime/nimi/
├── activity/      # one file per activity id
├── event/         # one file per event name
├── continuous/    # ambient handlers
└── lib/           # shared code
```

| 类型 | 路径 | 触发时机 |
| --- | --- | --- |
| 活动 | `<model>/runtime/nimi/activity/<id>.js` | 运行时请求特定类型的活动时 |
| 事件 | `<model>/runtime/nimi/event/<name>.js` | 发生已准入事件时（例如，`avatar_user_click`） |
| 持续 | `<model>/runtime/nimi/continuous/<name>.js` | 在已准入条件持续满足时，持续触发 |
| 库 | `<model>/runtime/nimi/lib/*.js` | 供上述处理器使用的共享导入 |

文件名规范化规则适用。活动 ID 和事件名称映射到文件名（代理脚本参考中允许使用 kebab-case/snake-case 形式）。

## 处理器结构

每个处理器都通过 `export default` 导出一个至少包含一个入口点的对象：

```js
export default {
  async run(ctx) {
    await ctx.motion.play('wave');
    await ctx.expression.set('smile');
    await ctx.wait.seconds(1);
    await ctx.expression.set('neutral');
  }
};
```

`ctx` 是由投影层提供的 API。处理器消费此 API；它们不直接导入后端库。这使得处理器能够保持与后端无关。

## 可用 API 接口

| API | 用途 |
| --- | --- |
| `ctx.motion` | 触发已准入的动作序列 |
| `ctx.expression` | 设置/清除表情 |
| `ctx.pose` | 设置/清除姿势 |
| `ctx.lookat` | 控制注视方向 |
| `ctx.params` | 控制已准入参数（首先是与后端无关的参数，类型收窄后是后端特定的参数） |
| `ctx.wait` | 等待已准入的时序原语 |
| `ctx.event` | 订阅处理器内部事件（有限） |

不在投影 API 接口中的任何内容都不可调用。基于 Worker 的能力 RPC 是沙盒边界；处理器无法逃逸此边界。

## 类型收窄后的后端扩展

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

`requires` 声明了能力依赖。在非 Live2D 后端上，处理器会被注册但跳过执行（或调用已准入的备用方案）。一旦 VRM 分支发布，VRM 处理器也将以同样的方式声明 `requires: ['vrm-extension']`。

## 读者场景：编写一个 `wave` 活动

1.  **创建文件。** `mychar/runtime/nimi/activity/wave.js`。
2.  **使用 `run(ctx)` 导出默认对象。** 使用 `ctx.motion`、`ctx.expression`、`ctx.wait`。
3.  **保存。** Tauri 通知监视器检测到更改；运行时重新注册处理器。无需重启。
4.  **触发。** 当运行时为驱动此具身的代理发出 `runtime.agent.activity.wave` 时，处理器运行。

作者在指定路径编写了一个 JS 文件。其余工作由平台完成。

## 读者场景：响应点击区域

1.  **声明点击区域。** 根据具身包的定义，`head` 区域在包清单中声明了 alpha 蒙版边界。
2.  **编写事件处理器。** `mychar/runtime/nimi/event/onClickHead.js`。
3.  **用户点击头部。** 点击区域检测触发 `avatar.user.click` 并附带区域信息。约定路径将处理器绑定到该事件。
4.  **处理器运行。** 触发害羞表情，播放短音效，然后恢复中性表情。

无需订阅调用。路径即订阅。

## 读者场景：持续呼吸

1.  **编写处理器。** `mychar/runtime/nimi/continuous/breathe.js`。
2.  **自动注册为持续处理器。** 运行时根据已准入的时序原语（每帧或按间隔，依据契约）进行调用。
3.  **与活动分层。** 一个 `wave` 活动可以与呼吸动作叠加，而不会禁用它；两者同时运行。

持续处理器是实现微妙环境行为分层而不相互覆盖的方式。

## 开发期间的热重载

| 工具 | 行为 |
| --- | --- |
| Tauri 通知监视器 | 检测 `<model>/runtime/nimi/**` 下的文件系统更改 |
| 自动重新注册 | 无需重启即可识别新的/更新的处理器 |
| 移除 | 删除文件会注销其处理器 |
| 错误 | 类型化的重载错误会在开发控制台中显示；会话保持运行 |

重载时的处理器错误不会导致 Avatar 崩溃。前一个已准入的处理器会保持活动状态，直到新文件被干净地解析。

## NAS 的定位

*   **不是声明式 DSL。** 没有 YAML，没有模式验证器，没有 CEL 规则引擎——它是 JS 处理器，提供完整的可编程接口。
*   **不是 SDK API。** SDK 适用于应用程序开发者。NAS 适用于具身包作者的 `<model>/runtime/nimi/`。
*   **不是承载语义真相的地方。** 处理器消费运行时语义事件。它们不创造代理状态。
*   **不是后端逃逸舱口。** 后端特定调用受 `requires` + 类型收窄的保护。

## 来源依据

- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)