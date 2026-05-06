# Runtime Client

SDK runtime client 是 App 进入 Runtime 行为的公开路径。它**应该**被用，而不是直接 import runtime 私有代码或走 App 特定的旁路。

支撑这页的 kernel 规则在 `S-RUNTIME-*` 与 `S-TRANSPORT-*` 下。

## 它代表什么

Runtime client 把 Runtime 能力暴成 TypeScript 表面：transport、元数据、流式行为、错误、按能力分组的 runtime 方法。它让 App 调 Runtime 时跟整个平台用同一条权威边界。

也就是说，写在 `sdk/runtime` 上的 App 不必知道某个 runtime 方法是哪个包实现的、transport 怎么处理重试、runtime 审计怎么记。这些事都被 SDK 边界处理。

## 它藏什么、暴什么

Runtime client 故意藏：

- 私有 transport 实现；
- 不该泄露的内部错误形状；
- 私有 runtime 工具函数；
- 原始 transport 重试与 auth 刷新（这是机制，不是合同救援）。

它故意暴：

- 按能力分组的类型化 runtime 方法（工作流、流式、多模态、委派表面、Agent 参与表面）；
- App 用来理解行为的 transport 元数据；
- App 可以以编程方式响应的 runtime 错误形状；
- 跟 Runtime 流式合同对齐的流式基础协议。

## 为什么"直接访问"不是方式

直接访问引出两个问题。第一，它把 App 耦合到 Runtime 私有内部。第二，它让 App 形成可能跟 Runtime 来源合同对不上的本地预期。SDK 边界两者都防。

如果某个 runtime 能力看起来必须直接 import 才能用，那是**SDK 边界需要新增准入表面的信号**，不是边界该被绕开的信号。

## 阅读场景：通过 client 跑流式生成

App 通过 `sdk/runtime` 发起一次流式生成：

1. App 调 runtime client 的生成方法，带类型化请求。
2. Client 把请求传输出去，并暴露一个跟 Runtime 流式合同对齐的类型化流式基础协议。
3. App 消费这个流式基础协议，不发明自己的 chunk 语义。阶段边界、终止帧、错误语义都来自合同。
4. 如果工作流产出了多模态 artifact，artifact 通过类型化形状暴露，不是自由格式 URL。
5. 错误以 SDK 错误合同定义的类型化形状到达。App 不必解析自由文本。

这个流是 App 跨 Runtime 内部变更仍然可移植的原因。

## 阅读场景：某个方法还不在 client 上

Runtime kernel 准入了一个新能力，但 SDK 边界还没准入。App 不能从私有内部合成这个调用。正确动作是：

- 把"缺席"当作合同。
- 提交或跟进准入 SDK 表面的工作。
- 等准入。

那种等待感觉慢。它正是让 SDK 不积累任何东西都担保不了的静默表面的原因。

## 来源

- [`.nimi/spec/sdk/runtime.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/runtime.md)
- [`.nimi/spec/sdk/kernel/runtime-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/runtime-route-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-route-contract.md)
- [`.nimi/spec/sdk/kernel/runtime-delegation-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-delegation-client-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
