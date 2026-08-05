# 会话能力投影

> 状态：当前运行。Desktop 为当前由 Runtime 拥有的会话锚点投影能力可用性。

该投影把 Runtime 返回的 typed operation result，同当前会话范围内的有限
Desktop 控件组合起来。它不定义能力集合、参与配置、具体实现选择或持久
Conversation Truth。

## 为什么是每一会话

用户可以只为当前会话选择语音播放或附件，而不改变其他会话。把控件绑定到
Runtime Conversation anchor，可以防止临时 UI 选择变成全局 LocalAgent 状态。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 临时控件和可用性渲染 | Conversation anchor 与连续性（Runtime） |
| 类型化不可用与设置 UI | 语音、媒体、工具、具体实现、Quota 与 Budget 决策（Runtime） |
| 提交前的附件选择 | 已提交附件与 Turn Truth（Runtime） |

Desktop 可以为渲染缓存投影状态，但该缓存不是 Runtime 或 Realm Truth，也不能证明下一次操作可以执行。

## 读者场景：用户为一次会话切换语音

1. **用户请求语音。** Desktop 为当前 Runtime Conversation anchor 提交类型化意图。
2. **Runtime 评估请求。** 当前能力意图、授权、Quota、Budget 与具体实现可用条件决定结果。
3. **Desktop 渲染投影。** 其他 Conversation anchor 不受影响。

## Runtime 持有的语义

该投影与 LocalAgent presentation 和 participation profile 保持分离。语音、媒体、工具、具体实现与 authorization 语义都由 Runtime 持有。UI 与缓存状态不会成为 Conversation 或 LocalAgent Truth。

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
