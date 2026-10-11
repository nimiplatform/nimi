# 具身呈现转换

Avatar 的内置转换将获准消费的 Agent 语义映射到所选图形后端。这是 Avatar 内部的连接层，不是创作者脚本 API。

## 输入与本地处理

| 输入 | Avatar 本地处理 |
| --- | --- |
| 活动与情绪 | 校验当前目标，映射到受支持的路由或表情 |
| 语义姿态 | 执行已准入的后端呈现，不重新定义 Agent 状态 |
| 有界语音时序与最终语音产物 | 关联本地播放，并在本地派生口型 |
| 后端尺寸与碰撞区域 | 计算角色窗口范围及本地指针行为 |

当前分支为 `live2d` 或 `vrm`。模型能力配置及可选的 mapping sidecar 决定路由是否受支持。无效或不支持的输入会被阻断；当前 Avatar 不执行 NAS 创作者文件或注入的 ctx 接口。

## 后端扩展

只有 Avatar 自有转换能在确认类型后访问分支专用扩展。Live2D 参数 ID 仍是后端事实，不是公共 APML 标签或 Runtime 活动标识；VRM 分支不能调用 Live2D 扩展。

## 本地观察

当前映射使用 `avatar.activity.start`、`avatar.activity.end`、`avatar.activity.cancel` 和 `avatar.expression.change` 表示对应的本地结果。渲染结果不会提交 Conversation 轮次，也不会成为 Agent 权威状态，具体 producer 见[Avatar 事件](/zh/avatar/avatar-events)。

## 相关文档

- [后端无关架构](/zh/avatar/host-agnostic-architecture)
- [模型能力配置](/zh/avatar/model-capabilities)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
