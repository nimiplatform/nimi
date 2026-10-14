# 活动映射

Avatar 通过内置映射层，将准入的 Runtime 活动与情绪转换为当前渲染后端的画面表现。模型创作者只需配置后端能力与名称映射；将 JavaScript 文件放入模型目录不会注册自定义处理器。

## 当前输入路径

1. 受保护的 App 会话读取已授权的 Agent 与 Conversation。
2. SDK 驱动将准入的具身（embodiment）更新转换为 Avatar 本地输入，包括 `runtime.agent.presentation.activity_requested` 和 `runtime.agent.state.emotion_changed`。
3. Avatar 校验目标，并通过内置 adapter 完成映射。
4. 当前渲染后端执行受支持的输出，或直接返回失败；不支持的行为不会用待机动画替代后再报告成功。

活动标识与语义由 Runtime 统一定义。Avatar 的 route ID 来自生成动作路由目录，不会新增 Runtime 活动标识或公共 APML 标签。

## 模型配置

请通过经校验的能力配置声明模型支持与不支持的路由及物理限制。需要映射模型特定名称时，请使用受控的 mapping sidecar，详见[模型能力配置](/zh/avatar/model-capabilities)与[生成动作提供器](/zh/avatar/generated-motion-provider)。

Live2D 参数扩展仅供 Avatar 内置转换层在收窄后端类型后调用，不是创作者脚本 API。当前 Avatar 不提供 NAS 创作者加载器、沙盒、ctx 注入或目录热重载。

## 本地观察事件

Avatar 使用 `avatar.activity.start`、`avatar.activity.end` 及取消事件表示本地处理结果。这些观察事件不会提交对话轮次，也不会改变 Runtime 语义，详见[Avatar 事件](/zh/avatar/avatar-events)。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
