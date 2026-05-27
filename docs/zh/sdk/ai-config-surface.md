# AI 配置界面

## 状态：已准入，正在构建中

SDK 的 AI 配置界面合同 (`sdk/kernel/ai-config-surface-contract.md`) 已被准入。它规定了应用开发者如何通过 SDK 配置 AI 配置文件；面向开发者的界面正处于积极构建中。

## 该界面的作用

AI 配置界面是 SDK 的边界，在这里应用开发者将 AI 配置文件绑定到某个作用域。它与以下内容配对：

- [平台 → AI 作用域标识](/platform/ai-scope-identity) — `AIScopeRef` 标识合同
- [运行时 → AI 配置文件执行](/runtime/ai-profile-execution) — 运行时的执行和快照合同

SDK 侧是应用调用的 **类型化配置 / 配置文件 / 快照 API**，用于应用配置文件、探测和检查快照。

## 方法族

| 族 | 目的 |
| --- | --- |
| 配置文件应用 | 将配置文件应用于 `AIScopeRef`（写时复制到作用域的 `AIConfig`） |
| 配置文件解析 | 解析作用域的有效 `AIConfig` |
| 探测（静态 / 可用性 / 可行性） | 在执行前进行验证 |
| 快照读取 | 按照 `K-AIEXEC-003` 读取执行证据 |

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 类型化配置 / 配置文件 / 快照 API | `AIProfile` 便携式模式定义 |
| 作用域参数形状 | 范围所有者的 AIConfig 意图 |
| 调用者的探测界面 | `LocalProfileDescriptor` 执行（运行时） |

SDK 是类型化访问界面。范围所有者拥有 AIConfig 意图；运行时拥有本地事实、就绪状态和执行证据。

## 读者场景：应用应用一个 AI 配置文件

应用希望将一个配置文件应用到应用拥有的工作区。

1. **应用调用 SDK。** `aiConfig.applyProfile({ scope: { kind: 'app', ownerId: 'nimi.example-app', surfaceId: 'workspace' }, profile })`。
2. **SDK 验证。** 根据 `AIScopeRef` 规则验证作用域标识。
3. **范围所有者执行配置文件应用。** 写时复制到工作区作用域的 `AIConfig`。
4. **在新配置文件下进行后续执行。**

## 该界面不做的事情

- 它不允许应用发明新的作用域类型。
- 它不允许应用直接绕过配置文件应用来实例化 `AIConfig`。
- 它不允许应用从另一个作用域的配置中使用 `AIScopeRef` 作为运行时回退。

## 来源依据

- [`.nimi/spec/sdk/kernel/ai-config-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-config-surface-contract.md)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
