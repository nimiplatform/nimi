# AI 配置文件

## 状态：已准入契约；Desktop 拥有的 surface

桌面 AI 配置文件配置合约 (`.nimi/spec/canonical/desktop/ai-consumption.authority.yaml`) 已获得准入。面向用户的 Agent 配置界面属于 Desktop 拥有的 surface。

## 该界面是什么

桌面 AI 配置文件配置界面是用于为每个 Agent 配置 AI 配置文件的**用户界面流程**——选择模型路由、调整提供商偏好、切换已准入的配置文件、将配置文件应用到 AI 范围。

它不允许用户编辑配置文件的**执行语义**。执行语义属于运行时 AI 配置文件执行合约。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 用户界面流程，用于配置文件选择和应用 | `AIProfile` 可移植模式（此合约将其固定） |
| 每个 Agent/每个 App 的配置文件绑定可见性 | `AIScopeRef` 标识（平台） |
| 应用触发器和用户界面反馈 | `LocalProfileDescriptor` 执行（运行时） |
| 配置文件偏好用户体验 | 探针语义（运行时/SDK 分割） |

用户进行选择；桌面通过 SDK 应用；运行时执行。
用户不能编辑运行时如何执行。

## 读者场景：用户为 App 工作区选择一个配置文件

用户希望他们的笔记 App 使用不同的 AI 配置文件。

1. **用户打开配置文件配置界面。** 看到已准入的配置文件。
2. **用户选择配置文件。** 桌面调用 SDK 的 `aiConfig.applyProfile(...)` 方法，并传入模块工作区的 `AIScopeRef`。
3. **配置文件应用。** 复制写入工作区范围的 `AIConfig`。
4. **在新配置文件下进行后续执行。** 模块的下一个 AI 调用将通过新的配置文件进行路由。

## 该功能不包括的内容

- 它不允许用户编辑配置文件的执行语义。
- 它不允许用户发明新的范围类型。
- 它不允许用户在已准入的配置文件应用流程之外实例化 `AIConfig`。
- 它不允许每个 Agent 的用户界面覆盖 `AIScopeRef` 标识规则。

## 来源依据

- [`.nimi/spec/canonical/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
