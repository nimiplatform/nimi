# AI Provider

`@nimiplatform/sdk/ai-provider` 是把 Vercel AI SDK v3 约定适配到 Runtime 调用上的 SDK 子路径。它是**协议适配器**，不是路由决策层。

## 这条子路径是干嘛的

已经用 Vercel AI SDK 约定的 App 可以保持那个形状、按类型化合同接到 Nimi Runtime 上。适配器在 Vercel 表面与 Runtime 能力之间桥接；它**不**发明路由语义。

| 性质 | 值 |
| --- | --- |
| 适配器目标 | Vercel AI SDK v3 约定 |
| 它干什么 | 表面适配 |
| 它不干什么 | 路由决策、Provider 仲裁、能力准入 |
| 权威 | Runtime 拥有底层执行 |

## 为什么单独子路径

`sdk/runtime` 是类型化 Runtime client。`sdk/ai-provider` 是匹配 Vercel AI SDK 调用形状的专用适配层。已经标准化在 Vercel 模式上的 App 可以零改写迁移到 Nimi；想要原生 Runtime 语义的 App 用 `sdk/runtime` 即可。

两条子路径覆盖不同的开发者体验。它们不复制真相。两边最终都路由经 Runtime。

## 适配器映了什么

| Vercel 概念 | Nimi 映射 |
| --- | --- |
| `streamText` 风格调用 | 经 `sdk/runtime` 的 Runtime 流式 |
| Provider 抽象 | Runtime connector + Provider 目录 |
| 工具调用 | Runtime 委派能力面（在已准入处） |
| 流式 chunk | Mode A / Mode B 映到 Vercel chunk 形状 |

适配器**永不**取代 Runtime 权威。如果 Runtime 说某事失败了，适配器把它转成 Vercel 形状的错误；它**不**合成成功。

## 适配器**不**做什么

- **路由决策。** Provider 选择住在 Runtime，不在适配器。适配器**不**挑「便宜的 Provider」；Runtime 挑。
- **能力准入。** Runtime 侧没准入的能力不会通过适配器变成可用。
- **自由 Provider 扩展。** 适配器尊重 Provider 目录；它**不**让 App 通过改适配器形状假装用未准入的 Provider。

## 阅读场景：已有 Vercel 代码的 App

你有一个用 Vercel AI SDK v3 模式的 App，想搬到 Nimi Runtime。

1. **装 SDK。** `import` 自 `@nimiplatform/sdk/ai-provider`。
2. **适配器初始化。** 把 Runtime 连接接到适配器。
3. **既有调用点。** 你的 `streamText` 风格调用保持形状。
4. **适配器适配。** 调用走 `sdk/ai-provider` 到 Runtime；流式 chunk 转回 Vercel 形状；错误以类型化 Vercel 错误回。
5. **Runtime 权威。** Runtime 决定路由，审计落本地 ledger，工作流生命周期被保留。

迁移是子路径替换，不是重写。

## 阅读场景：Runtime 上未准入的能力

你既有的 Vercel 代码用了一个 Runtime 没准入的 Provider 扩展。

1. **适配器调用碰到边界。** 适配器查 Runtime 的 Provider 目录；扩展未准入。
2. **Fail-close。** 适配器返回类型化 Vercel 形状错误；它**不**假装支持那个扩展。
3. **补救路径。** 要么在 Runtime kernel 准入那个扩展（加进 provider extension registry），要么换一条表面。

适配器不即兴增加能力。权威住在 Runtime；适配器只做适配。

## 边界总结

| 关注 | 所有者 |
| --- | --- |
| Vercel 调用点形状 | `sdk/ai-provider` 适配器 |
| 流式行为 | Runtime 流式合同 |
| Provider 路由 | Runtime |
| 能力准入 | Runtime kernel |
| 审计 | Runtime 审计 |
| 工具调用 | Runtime 委派能力（在已准入处） |

## 来源

- [`.nimi/spec/sdk/ai-provider.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/ai-provider.md)
- [`.nimi/spec/sdk/kernel/ai-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-provider-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
