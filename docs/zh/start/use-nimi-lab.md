# 使用 Nimi Lab

`apps/lab/` 是 Nimi 的本地能力实验 App。它在一个真实 Nimi App 中集成 SDK、Kit、Runtime、Realm 和 app-tools 表面，便于先接入并检验新能力，再决定哪些能力适合进入脚手架。某个表面可以已经集成并可见，但当前 carrier 仍返回 typed unavailable；集成存在不等于可运行或已获得脚手架准入。

Nimi Lab 不掌握平台准入真相。Runtime、Realm、SDK、Kit、发布、registry 和 permission 仍由各自的平台表面负责。App Tools 只生成明确收录的能力切片，不会复制完整 Lab。

## 运行

在源码仓库根目录执行：

```bash
pnpm dev:lab
```

`apps/lab/` 提供以下常用脚本：

```bash
pnpm run init
pnpm dev:shell
pnpm run validate
pnpm run doctor
pnpm run update
pnpm run test
```

`dev:shell` 进入官方 `nimi-app dev` launcher；在 Windows 和 macOS 上，Nimi Lab 以 Desktop-supervised Electron App 运行。`build:shell` 仍是有边界的 Tauri native build 路径，不是第二条本地开发 carrier。尚未准入的本地项目必须先由 Developer Mode 授权，再以隔离的 `local_development` build 启动。Nimi Lab 不拥有 principal、grant 或 session，也不授予公开 App 准入。

Realm-backed settings 当前作为已集成的 Lab 表面保留，但 local-app carrier 会返回 typed unavailable。其真实 owner journey 仍为 `NOT-VERIFIED`，不能由可见 UI 推断 Realm access 已可运行。

## 应该看哪里

| 需要 | 位置 |
| --- | --- |
| App scaffold scripts 与本地检查 | `apps/lab/package.json` |
| Runtime-authenticated shell 行为 | `apps/lab/README.md` 和 shell routes |
| AIConfig storage 与 App owner | `apps/lab/src/lab/lab-ai-config-store.ts` |
| 由 capability intent 发起的 Runtime AI dispatch | `apps/lab/src/lab/lab-runtime.ts` |
| Fail-closed capability states | `apps/lab/src/lab/lab-non-success.ts` |
| AIConfig intent composition | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| Contract checks | `apps/lab/test/lab-contract/` |

## 使用边界

- Nimi Lab identity (`nimi.lab`) 只属于 Nimi Lab。
- Lab 专属 diagnostics、Simulator adapter、fixture 和 demo data 不是脚手架或生产数据契约。
- 能力已经进入 Lab，不代表 App Tools 已允许用户选择它。
- Lab acceptance tests 是 app-owned checks 的示例，不能替代你的 App requirements。
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

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/package.json)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
