# 会话能力投影

> 状态：现已可用。桌面端会显示你当前打开的这段对话有哪些能力可用。

这个界面把 Runtime 返回的结果，和一小组针对当前对话的控件组合在一起。它不定义能力集合，不参与实现选择，也不给 Conversation 留下任何持久状态。

## 为什么是每一会话

你可能想在这段对话里开语音播放、加附件，而不影响另一段对话。把控件限定在当前对话上，一次随手的选择就不会变成 Agent 的全局设置。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 临时控件和可用性渲染 | Conversation anchor 与连续性（Runtime） |
| 类型化不可用与设置 UI | 语音、媒体、工具、具体实现、Quota 与 Budget 决策（Runtime） |
| 提交前的附件选择 | 已提交附件与 Turn Truth（Runtime） |

桌面端为了显示速度可以缓存界面状态，但缓存不是真实状态，也不能证明下一次操作一定能执行。

## 读者场景：用户为一次会话切换语音

1. **用户请求语音。** Desktop 为当前 Runtime Conversation anchor 提交类型化意图。
2. **Runtime 评估请求。** 当前能力意图、授权、Quota、Budget 与具体实现可用条件决定结果。
3. **Desktop 渲染投影。** 其他 Conversation anchor 不受影响。

## Runtime 持有的语义

这些控件与 LocalAgent 的呈现配置和参与配置互不相干。语音、媒体、工具、实现和授权语义都留在 Runtime。界面上的开关和缓存，永远不会改写 Conversation 或 LocalAgent 本身。

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
