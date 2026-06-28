# AI Config Surface

SDK AI Config surface 是 app-owned AI capability binding 的类型边界。它回答开发者的一个问题：这个 capability 应该使用哪个 Runtime target；如果没有 live target，App 应该如何 fail closed。

当前代码通过 `@nimiplatform/sdk` 和 `@nimiplatform/sdk/ai` 暴露 AIConfig types、stores、profile helpers、target-ref validation、scheduling helpers 和 runtime-binding helpers。Kit 消费这些 primitives，提供可复用的 model-config UI。

## 当前公开部分

| 部分 | 公开路径 | 作用 |
| --- | --- | --- |
| AIConfig types 和 target refs | `@nimiplatform/sdk` 或 `@nimiplatform/sdk/ai` | `NimiAIConfig`、`NimiAIScopeRef`、`NimiAIConfigTargetRef`、profile 与 snapshot types |
| Scope helpers | `@nimiplatform/sdk/ai` | 创建和验证 `NimiAIScopeRef` |
| Config store helpers | `@nimiplatform/sdk/ai` | App-owned AIConfig 与 snapshot storage adapters |
| Runtime binding resolver | `@nimiplatform/sdk/ai` | 把 `NimiAIConfig` + capability id 转成 model、route policy、target ref、metadata |
| Kit model-config surface | `@nimiplatform/kit/features/model-config/*` | 选择/应用 model binding 的可复用 UI 与 headless contracts |

## Target Ref Families

| `targetRef.kind` | 含义 | Dispatch 状态 |
| --- | --- | --- |
| `profile-slice` | 尚未 materialize 成 live Runtime target 的 profile intent | 不可 dispatch |
| `local-runtime` | Runtime local target identity v2，携带 `profileBindingId` 或 `readinessRef` | Runtime 可解析时可 dispatch |
| `cloud-connector` | Runtime cloud provider connector 与 remote model catalog identity | provider connector 配置完成时可 dispatch |

Runtime-backed `createRuntimeModel` 和 embedding clients 在缺少 `targetRef` 或仍指向 `profile-slice` 时 fail closed。

## App 集成流程

1. App 创建显式 app scope，通常使用 `createNimiAppAIScopeRef(appId, surfaceId)`。
2. App 通过 app-owned AIConfig service 存取 `NimiAIConfig`。
3. App 使用 Kit model-config UI 或其他已准入的 app flow 选择或应用 Runtime target。
4. Dispatch 前，App 针对要运行的 capability 调用 `resolveNimiAIConfigRuntimeBinding(...)`。
5. App 把解析出的 `model`、`routePolicy`、`connectorId`、`targetRef` 和 metadata 传给 SDK Runtime AI calls。

Dispatch 形状见 [第一次 AI 调用](/zh/sdk/first-ai-call)。

## Fail-Closed Binding Resolution

`resolveNimiAIConfigRuntimeBinding(...)` 返回 typed failure，而不是伪造 model：

| Reason | 含义 |
| --- | --- |
| `binding-capability-missing` | App 没有声明这个 route 由哪个 AIConfig capability 支撑。 |
| `target-ref-missing` | 该 capability 没有选中 target。 |
| `profile-slice-unmaterialized` | config 仍指向 profile intent，不是 live Runtime target。 |
| `runtime-model-missing` | target ref 没有 runtime model id。 |

App 应该把这些状态展示为 model setup 或 account/setup 工作。不要 fallback 到 `auto`、硬编码 provider，或 app-local REST。

## 这个 Surface 不拥有什么

- 不拥有 Runtime model readiness 或 execution evidence。
- 不拥有 Realm truth 或 app listing admission。
- 不允许 App 发明 scope kinds。
- 不允许 App 通过任意写入 live target id 绕过 profile apply/materialization。
- 不把 CLI `nimi run` 成功等同于 App AIConfig readiness。

## 来源依据

- [`.nimi/spec/sdks/kernel/ai-config-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/ai-config-surface-contract.md)
- [`sdks/typescript/core/ai/config-types.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-types.ts)
- [`sdks/typescript/core/ai/config-scope.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-scope.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`kit/features/model-config/src`](https://github.com/nimiplatform/nimi/tree/main/kit/features/model-config/src)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
