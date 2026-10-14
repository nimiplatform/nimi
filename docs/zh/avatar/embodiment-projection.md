# 具身呈现转换

Avatar 通过内置转换层，将准入的 Agent 语义映射到所选图形后端。它是 Avatar 内部的衔接层，不是面向创作者的脚本 API。

## 输入与本地处理

| 输入 | Avatar 本地处理 |
| --- | --- |
| 活动与情绪 | 校验当前目标，映射到受支持的动作路由或表情 |
| 语义姿态 | 执行准入的后端专属呈现，不改变 Agent 状态定义 |
| 有界语音时序与最终语音产物 | 关联本地音频播放，并在本地计算口型同步 |
| 后端尺寸与碰撞区域 | 计算角色窗口占比与本地指针交互区域 |

当前渲染分支为 `live2d` 或 `vrm`。路由是否受支持取决于模型能力配置及可选的 mapping sidecar。无效或不受支持的输入会直接拦截（fail closed）；当前 Avatar 不执行 NAS 创作者脚本，也不提供注入式 ctx 接口。

## 后端扩展

只有在收窄后端类型后，Avatar 内置转换层才能访问对应分支的专用扩展。Live2D 参数 ID 仅属于后端层面的定义，不是公共 APML 标签或 Runtime 活动标识；VRM 分支无法调用 Live2D 扩展。

## 本地观察

当前映射流程通过 `avatar.activity.start`、`avatar.activity.end`、`avatar.activity.cancel` 和 `avatar.expression.change` 报告本地执行结果。本地渲染结果不会提交 Conversation 轮次，也不会成为 Agent 的权威状态。具体事件来源见[Avatar 事件](/zh/avatar/avatar-events)。

## 相关文档

- [后端无关架构](/zh/avatar/host-agnostic-architecture)
- [模型能力配置](/zh/avatar/model-capabilities)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
