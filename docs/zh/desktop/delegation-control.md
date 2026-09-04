# 委托控制

## 状态：已准入契约；Desktop 拥有的 surface

委托控制是桌面端的界面，在内核层定义（`canonical/desktop/agent-projection.authority.yaml`）。你看到的审批与隔离 UI 属于 Desktop 本身，不是应用各自用 SDK 搭出来的。

## 什么是委托控制

委托控制是**你说了算**的地方。外部 AI 提出一个动作建议时，审批提示出现在这里；输出被隔离时，你在这里查看证据。批还是不批，由你决定——没有你点头，什么都不会替你执行。

运行时一侧（网关 + 输出防火墙 + 裁决）见[运行时→委托能力](/runtime/delegated-capability)。本页讲的是把这些裁决呈现给你的桌面端控制面。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 审批提示渲染与决策捕获 | 防火墙裁决（运行时） |
| 隔离证据显示 | 隔离语义（运行时） |
| 面向用户的理由文本 | 理由代码语义（运行时） |
| 每个用户的审批默认策略偏好 | 信任层级准入（运行时） |

这个界面负责呈现情况和记下你的决定。裁决和隔离逻辑本身来自 Runtime。

## 读者场景：审批提示

外部 AI 提议一个工具调用；防火墙裁决为 `APPROVAL_REQUIRED`。

1. **运行时发出需要审批的事件。** 包含类型化的委托请求、防火墙裁决、敏感度和建议操作。
2. **桌面控制面进行渲染。** 审批卡片显示外部 AI 建议的内容、为什么需要审批以及用户的批准/拒绝选项。
3. **用户决定。** 批准或拒绝。记录原因。
4. **运行时根据用户决定采取行动。** 针对委托会话记录审批；如果批准，运行时在其自身的审计谱系下采取行动。

## 读者场景：隔离审查

提供者漂移或敏感度分类隔离了输出。

1. **运行时发出隔离事件。** 包含类型化的证据。
2. **桌面面列出隔离项目。** 用户可以审查。
3. **用户释放或丢弃。** 记录决定；运行时遵守。
4. **无静默释放。** 隔离项目在用户做出决定之前不会流向消费者。

## 委托控制不做的事情

- 不会编造防火墙裁决。
- 不会悄悄改变隔离语义。
- 没有绕过审批的捷径。
- 你的偏好设置可以减少打扰，但顶不掉 Runtime 要求的审批。

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
