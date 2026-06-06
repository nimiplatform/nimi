# 代理参与客户端

## 状态：已准入，正在构建中

运行时代理参与合约 (`runtime-agent-participation-contract.md`) 已在 SDK 内核级别被准入。方法注册表和行为检查已在合约级别提供；客户端流畅的表面接口正处于积极构建中。

## 该客户端的作用

代理参与客户端是为希望其应用在已准入的参与配置文件下参与代理执行的应用/模块开发者提供的 SDK 接口（参见 [平台 → 代理 → 参与权威](/platform/agents/participation-authority)）。

它**不是**用于发明新的参与配置文件的方式。封闭的配置文件集存在于运行时规范中；SDK 允许你针对已准入的配置文件提交。

## 方法接口

方法注册表位于 `tables/runtime-agent-participation-methods.yaml`。SDK 接口将已准入的方法作为类型化调用暴露出来。

| 方法族 | 目的 |
| --- | --- |
| 配置文件附加 | 在已准入的参与配置文件下附加一个代理 |
| 输出候选提交 | 提交一个非规范的输出候选 |
| 晋升请求 | 根据 `promotion_posture` 请求类型的晋升 |
| 配置文件分离 | 正常分离 |

## 行为检查

参与合约中包含了 SDK 在提交前强制执行的行为检查：

| 检查 | 目的 |
| --- | --- |
| 配置文件轴形状 | 拒绝开放字符串轴值 |
| 内存写入默认值 | 拒绝请求持久写入的 `WRITE_NONE` 配置文件 |
| 能力范围 | 拒绝超出配置文件 `capability_scope` 的调用 |
| 输出目的地 | 拒绝输出到未准入的目的地 |

这些是 SDK 侧的防护措施。运行时仍然会在服务器端进行验证；SDK 仅在检测到违规时快速失败。

## 读者场景：模块提交一个输出候选

一个模块希望其代理参与一个 Realm 组线程。

1. **配置文件附加。** SDK 调用在 `realm_group_participation` 下附加代理。
2. **输出候选。** 模块组装一个类型化的消息候选，并通过 SDK 提交。
3. **SDK 行为检查。** 输出目的地 `REALM_GROUP_MESSAGE_CANDIDATE` 与配置文件匹配。
4. **运行时验证。** 服务器端的参与合约进行强制执行。
5. **Realm 插槽绑定。** Realm 在消息提交前验证代理插槽绑定。

## 该客户端不做的事情

- 它不会发明新的参与配置文件。
- 它不会绕过 `WRITE_NONE` 默认值。
- 它不会绕过非规范配置文件的规范聊天预算。
- 它不会让 SDK 侧的检查替代运行时验证。

## 来源依据

- [`.nimi/spec/sdks/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
