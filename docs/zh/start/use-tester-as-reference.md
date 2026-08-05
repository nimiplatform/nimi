# 把 Tester 当作 Reference App 使用

`apps/tester/` 是 Nimi Lab：面向生成式 Nimi App 仓库的 developer reference app。用它理解一个真实 App 如何接入 Runtime auth、SDK calls、Kit surfaces、app-tools scaffold checks、AIConfig capability intent、capability lanes 和 local acceptance tests。

不要把 Tester 当成 platform admission truth。它是 app-owned reference surface，不是 Runtime、SDK、Kit、Realm、release、registry 或 permission authority 的来源。

## 运行

在源码仓库根目录：

```bash
pnpm dev:tester
```

在 `apps/tester/` 内，相关脚本是：

```bash
pnpm run init
pnpm dev:shell
pnpm run validate
pnpm run local-audit
pnpm run doctor
pnpm run update
pnpm run test
```

`dev:shell` 启动 Tauri shell。Native host 会注入 standard-shell local-app carrier。尚未准入的本地项目必须先由 Developer Mode 授权，再以隔离的 `local_development` build 启动。Tester 不拥有 principal、grant 或 session，也不授予公开 app admission。

## 应该看哪里

| 需要 | 位置 |
| --- | --- |
| App scaffold scripts 与本地检查 | `apps/tester/package.json` |
| Runtime-authenticated shell 行为 | `apps/tester/README.md` 和 shell routes |
| AIConfig storage 与 App owner | `apps/tester/src/tester/tester-ai-config-store.ts` |
| 由 capability intent 发起的 Runtime AI dispatch | `apps/tester/src/tester/tester-runtime.ts` |
| Fail-closed capability states | `apps/tester/src/tester/tester-unavailable.ts` |
| AIConfig intent composition | `apps/tester/src/tester/workbench/tester-ai-config-settings-panel.tsx` |
| Contract checks | `apps/tester/test/tester-contract/` |

## 参考边界

- Tester app identity (`nimi.tester`) 只属于 Tester。
- Tester local fixtures 和 demo data 不是生产数据契约。
- Tester acceptance tests 是 app-owned checks 的示例，不替代你的 App requirements。
- Runtime execution diagnostic 只是证据，不要把 implementation、route、connector 或 target 细节复制到 App 请求中。
- Developer Mode 是本地开发材料，不是公开 App listing admission。

## 常见失败状态

| 状态 | 含义 |
| --- | --- |
| `runtime-unavailable` | Runtime 无法处理这次请求。 |
| `permission-required` | 文本生成权限尚未获准。 |
| `input-invalid` | 必需的 capability 输入缺失或格式错误。 |
| `sdk-method-unavailable` | 当前 App build 没有暴露所需 SDK method。 |
| `runtime-call-failed` | Runtime 返回 typed contract failure。 |

App 应该直接呈现这些状态。不要把它们压缩成单一的 `SDK missing` 或 `model unavailable`。

## 来源依据

- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`apps/tester/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/package.json)
- [`apps/tester/src/tester/tester-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime.ts)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)
