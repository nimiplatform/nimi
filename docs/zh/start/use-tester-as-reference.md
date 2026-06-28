# 把 Tester 当作 Reference App 使用

`apps/tester/` 是 Nimi Lab：面向生成式 Nimi App 仓库的 developer reference app。用它理解一个真实 App 如何接入 Runtime auth、SDK calls、Kit surfaces、app-tools scaffold checks、AIConfig bindings、capability lanes 和 local acceptance tests。

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

`dev:shell` 启动 Tauri shell。App 像已分发 App 一样通过 in-app Runtime account login 认证。尚未准入的本地 App 使用 Developer Mode 和 Runtime developer registration；Tester 不创建独立 developer session，也不授予 app admission。

## 应该看哪里

| 需要 | 位置 |
| --- | --- |
| App scaffold scripts 与本地检查 | `apps/tester/package.json` |
| Runtime-authenticated shell 行为 | `apps/tester/README.md` 和 shell routes |
| AIConfig storage 与 app scope | `apps/tester/src/tester/tester-ai-config-store.ts` |
| 携带 AIConfig binding 的 Runtime AI dispatch | `apps/tester/src/tester/tester-runtime-invokers-core.ts` |
| Fail-closed capability states | `apps/tester/src/tester/tester-unavailable.ts` |
| Kit model-config integration | `apps/tester/src/shell/ai/` 和 `apps/tester/src/shell/routes/settings/` |
| Contract checks | `apps/tester/test/tester-contract/` |

## 不要直接复制什么

- Tester app identity (`nimi.tester`) 只属于 Tester。
- Tester local fixtures 和 demo data 不是生产数据契约。
- Tester acceptance tests 是 app-owned checks 的示例，不替代你的 App requirements。
- Runtime route ids、AIConfig target refs 和 provider connector ids 必须来自你的 App 的 Runtime/model-config flow。
- Developer Mode 是本地开发材料，不是公开 App listing admission。

## 常见失败状态

| 状态 | 含义 |
| --- | --- |
| `runtime-not-ready` | Runtime 不可达或该 lane 尚未 ready。 |
| `ai-config-binding-missing` | 该 capability 没有选中 AIConfig target。 |
| `auth-context-missing` | 该 route 需要已登录的 Runtime account subject。 |
| `principal-unauthorized` | Runtime account session 已过期或未授权。 |
| `sdk-method-unavailable` | 当前 App build 没有暴露所需 SDK method。 |
| `runtime-call-failed` | Runtime 返回了强类型 contract/provider failure。 |

App 应该直接呈现这些状态。不要把它们压扁成单一的 “SDK missing” 或 “model unavailable”。

## 来源依据

- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`apps/tester/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/package.json)
- [`apps/tester/src/tester/tester-runtime-invokers-core.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime-invokers-core.ts)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)
