# 代理参与客户端

## 状态：仅契约；当前没有公开 SDK 方法

运行时代理参与合约 (`runtime-agent-participation-contract.md`) 是已经准入的语义契约边界。方法注册表和行为检查描述了目标形态，但当前 TypeScript SDK 没有暴露可用于生产接入的代理参与客户端方法。

## 该客户端的作用

本页说明的是未来应用在已准入参与配置文件下参与代理执行时需要遵守的客户端契约（参见 [平台 → 代理 → 参与权威](/zh/platform/agents/participation-authority)）。

它**不是**当前可调用的公开 SDK surface，也不是用于发明新的参与配置文件的方式。封闭的配置文件集存在于运行时规范中；后续公开 SDK surface 只能针对已准入的配置文件提交。

## 方法接口

方法注册表位于 `tables/runtime-agent-participation-methods.yaml`。它是契约证据，不是当前可调用的公开生产 SDK surface。

| 方法族 | 目的 |
| --- | --- |
| 配置文件附加 | 在已准入的参与配置文件下附加一个代理 |
| 输出候选提交 | 提交一个非规范的输出候选 |
| 晋升请求 | 根据 `promotion_posture` 请求类型的晋升 |
| 配置文件分离 | 正常分离 |

## 行为检查

参与合约中准入了 SDK 在提交前需要执行的行为检查：

| 检查 | 目的 |
| --- | --- |
| 配置文件轴形状 | 拒绝开放字符串轴值 |
| 内存写入默认值 | 拒绝请求持久写入的 `WRITE_NONE` 配置文件 |
| 能力范围 | 拒绝超出配置文件 `capability_scope` 的调用 |
| 输出目的地 | 拒绝输出到未准入的目的地 |

这些是计划中的 SDK 侧防护措施。运行时仍然会在服务端验证；在公开客户端存在之前，调用者必须收到 unavailable 或 unsupported 行为，而不是成功响应。

## 读者场景：未来应用提交一个输出候选

这是未来契约场景，不是当前公开生产 SDK 承诺。一个应用在参与 SDK 暴露之后，希望其代理参与一个 Realm 组线程。

1. **配置文件附加。** SDK 调用在 `realm_group_participation` 下附加代理。
2. **输出候选。** 应用组装一个类型化的消息候选，并通过 SDK 提交。
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
