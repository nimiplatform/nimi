# Runtime Client

SDK 的 Runtime client 是 App 通往 Runtime 行为的公开路径。应使用它，而不是从 runtime 私有代码直接导入或绕过边界。

本页背后的内核规则在 `S-RUNTIME-*` 与 `S-TRANSPORT-*`。

## 它代表什么

Runtime client 把 Runtime 能力转换为一份 TypeScript surface：传输、元数据、流式行为、错误，以及按能力分组的 runtime 方法。它让 App 用与平台其余部分一致的权威边界去调用 Runtime。

也就是说，针对 `@nimiplatform/sdk/runtime` 写出来的 App，不需要知道某个 runtime 方法由哪个包实现、传输如何重试、runtime 审计如何记录。这些事都由 SDK 转换承担。

## 它隐藏什么、暴露什么

Runtime client 有意隐藏：

- 私有传输实现；
- 不应外泄的内部错误形状；
- 私有 runtime helper；
- 原始传输重试与鉴权刷新——这些是机制，不是契约救援。

它有意暴露：

- 按能力域分组的强类型 runtime 方法（工作流、流式、多模态、受委派 surface、Agent 参与适配）；
- App 理解行为所需的传输元数据；
- App 可以编程响应的 runtime 错误转换；
- 与 Runtime 流式契约对齐的流式基础协议。

## 为什么不走"直接访问"模式

直接访问会带来两个问题。第一，App 与 Runtime 私有内部耦合。第二，App 形成了一种与 Runtime 源契约可能不一致的本地预期。SDK 边界把这两件事都挡掉。

如果某个 runtime 能力让人觉得"必须直接导入才能用"，那是 SDK 转换需要新的准入 surface 的信号，而不是边界应被绕开的信号。

## 场景：通过 client 跑流式生成

某个 App 通过 `@nimiplatform/sdk/runtime` 发起一次流式生成：

1. App 用强类型请求调用 runtime client 的生成方法。
2. Client 把请求传输出去，并暴露与 Runtime 流式契约一致的强类型流式基础协议。
3. App 使用该流式基础协议，无须自创 chunk 语义。阶段边界、终止帧、错误语义都来自契约。
4. 工作流如产出多模态产物，产物以强类型形状暴露，不会以自由 URL 形式出现。
5. 错误以 SDK 错误转换定义的强类型形态返回。App 不必去解析自由格式消息。

这样的流程让 App 在 Runtime 内部演进时仍然可移植。

## 场景：方法尚未在 client 上

假设 Runtime 在内核里准入了一个新能力，但 SDK 转换还未准入。App 不能从私有内部合成调用。正确做法是：

- 把"缺席"当作契约。
- 提交或跟进准入 SDK surface 的工作。
- 等待转换。

这种等待感觉慢。这正是 SDK 不会积累一堆"无人背书的静默 surface"的原因。

## 来源依据

- [`.nimi/spec/sdks/kernel/runtime-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-contract.md)
- [`.nimi/spec/sdks/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/transport-contract.md)
- [`.nimi/spec/sdks/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/error-projection.md)
- [`.nimi/spec/sdks/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/surface-contract.md)
- [`.nimi/spec/sdks/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/boundary-contract.md)
- [`.nimi/spec/sdks/kernel/runtime-route-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-route-contract.md)
- [`.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
