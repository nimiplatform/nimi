# AI Provider

`@nimiplatform/sdk/ai-provider` 是 SDK 的一个子路径，把 Vercel AI SDK v3 的写法适配到 Runtime 调用上。它是**协议适配器**，不是路由决策层。

## 这个子路径用于什么

如果你的 App 已经按 Vercel AI SDK 的写法在跑，你可以保留这套写法，并在强类型契约下接到 Nimi 的 Runtime。适配器在 Vercel surface 与 Runtime 能力之间做改写；它不会自创路由语义。

| 属性 | 值 |
| --- | --- |
| 适配目标 | Vercel AI SDK v3 写法 |
| 它做什么 | surface 适配 |
| 它不做什么 | 路由决策、provider 仲裁、能力准入 |
| 权威 | Runtime 持有底层执行 |

## 为什么单独拆一个子路径

`sdk/runtime` 是强类型 Runtime client。`sdk/ai-provider` 是一份专门匹配 Vercel AI SDK 调用形状的改写。已经标准化在 Vercel 写法上的 App 可以直接接入 Nimi，无需改写调用点；想要原生 Runtime 语义的 App 则用 `sdk/runtime`。

两个子路径覆盖不同的开发体验，并不重复真值。最终都通过 Runtime 路由。

## 适配器映射的内容

| Vercel 概念 | Nimi 映射 |
| --- | --- |
| `streamText` 风格调用 | 经 `sdk/runtime` 走 Runtime 流式 |
| Provider 抽象 | Runtime 连接器加 provider catalog |
| Tool calls | Runtime 受委派能力面（已准入的部分） |
| 流式 chunk | Mode A / Mode B 映射到 Vercel chunk 形状 |

适配器永远不会取代 Runtime 权威。Runtime 判定失败时，适配器把失败改写成 Vercel 形状的错误，不会合成出"成功"。

## 适配器不做的事情

- **路由决策。** Provider 选择归 Runtime，不归适配器。适配器不会去挑"更便宜的 provider"，那是 Runtime 的事。
- **能力准入。** 在 Runtime 侧未准入的能力，不会因为走适配器就变得可用。
- **自由 provider 扩展。** 适配器尊重 provider catalog；不能借调整适配器形状假装在用未准入的 provider。

## 场景：已有 Vercel 代码的 App

你的 App 已经按 Vercel AI SDK v3 写好了，现在想搬到 Nimi Runtime。

1. **装 SDK。** 从 `@nimiplatform/sdk/ai-provider` 导入。
2. **适配器初始化。** 把 Runtime 连接接到适配器上。
3. **既有调用点。** 你的 `streamText` 风格调用形状不变。
4. **适配器改写。** 调用经 `sdk/ai-provider` 进入 Runtime；流式 chunk 改写回 Vercel 形状返回；错误以强类型 Vercel 错误形式返回。
5. **Runtime 权威。** 路由由 Runtime 决定，审计写入本地账本，工作流生命周期保留。

迁移是子路径替换，不是重写。

## 场景：能力未在 Runtime 准入

假设你的现有 Vercel 代码用到了一个 Runtime 还未准入的 provider 扩展。

1. **适配器调用打到边界。** 适配器查询 Runtime 的 provider catalog，发现该扩展未准入。
2. **Fail-closed。** 适配器返回一个强类型 Vercel 形状的错误，不会假装支持该扩展。
3. **修复路径。** 要么在 Runtime 内核层级把扩展准入（加入 provider extension registry），要么换一个 surface。

适配器不会即兴造出能力。权威在 Runtime；适配器只做改写。

## 边界总览

| 关注点 | 归属 |
| --- | --- |
| Vercel 调用点形状 | `sdk/ai-provider` 适配器 |
| 流式行为 | Runtime 流式契约 |
| Provider 路由 | Runtime |
| 能力准入 | Runtime 内核 |
| 审计 | Runtime 审计 |
| Tool calls | Runtime 受委派能力（已准入的部分） |

## Source Basis

- [`.nimi/spec/sdk/ai-provider.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/ai-provider.md)
- [`.nimi/spec/sdk/kernel/ai-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-provider-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
