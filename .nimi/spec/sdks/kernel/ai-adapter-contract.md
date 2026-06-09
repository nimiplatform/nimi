# SDK AI Adapter Contract

> Owner Domain: `S-AIP-*`

## S-AIP-001 Adapter Role

AI adapters are independent adapter packages or core AI helper boundaries, not
the removed `@nimiplatform/sdk/ai-provider` base SDK subpath. They do not own
Runtime/provider routing decisions.

- adapter factories must bind to explicit `NimiClient` / Runtime-facing
  surfaces; app identity and Runtime construction constraints remain governed
  by `S-RUNTIME-010`.
- routing/default model 选择权属于 runtime 或调用方；adapter 不得引入独立 provider 路由表。
- adapter 不得在 caller 未提供 route policy 时自行默认到
  `local` 或 `cloud`；必须要求显式 caller route policy，或消费 Runtime
  公开 projection 提供的 explicit route policy，并在缺失时 fail closed。

多模态请求验证（video mode/role 矩阵 K-MMPROV-024/025、TTS voice_ref 强类型 K-MMPROV-018、local image workflow K-MMPROV-016、artifact metadata 校验 K-MMPROV-007）均为 runtime 侧职责。SDK adapter 层仅投影公开 SDK/Runtime 方法面和错误结果，不复刻上游请求验证逻辑。

## S-AIP-002 Media Job Projection

ScenarioJob 相关方法必须保持提交/查询/取消/订阅语义一致性。

## S-AIP-003 Stream Finish Projection

流式 done/finish reason 必须完整投影给调用方，不得静默吞掉业务终态。

## S-AIP-004 Provider Catalog Alignment

provider 名称与能力对齐以 runtime `provider-catalog.yaml` 为事实源。

## S-AIP-005 Error Projection Coupling

Adapter 错误投影必须复用 `S-ERROR-*`，不得私自扩展冲突语义。

## S-AIP-006 World Generate Projection Boundary

若 runtime admitted `world.generate`，adapter 只能把它投影为
runtime-owned async capability family.

- adapter 不得把 `world.generate` 降格为 image/video alias。
- adapter 不得引入 app-side provider upload / poll / fetch protocol。
- provider-specific request shaping、connector secret ownership、以及 job
  lifecycle 继续由 runtime authority surfaces 负责。

## S-AIP-007 External AI Framework Adapter Boundary

Independent adapter packages may host adapters for external AI framework
provider contracts, including Vercel AI SDK and similar model-provider
interfaces. The base SDK must not restore `@nimiplatform/sdk/ai-provider`.

Such adapters are protocol adapters only. They may map framework calls such as
text generation, streaming, structured output, and caller-owned tool-loop
coordination onto admitted Nimi Runtime / SDK surfaces. They must preserve
`S-SURFACE-015` through `S-SURFACE-018` and `S-BOUNDARY-005` through
`S-BOUNDARY-006`.

They must not:

- introduce an independent provider/model routing table
- keep connector secrets or provider credentials outside Runtime custody
- emulate unsupported tool-calling, JSON mode, cache, reasoning, usage, or
  stream semantics as successful parity
- expose a stable OpenAI-compatible Runtime endpoint
- persist framework session, memory, or event state as Nimi canonical truth

Capability gaps must be typed and visible to the caller. Framework-specific
ergonomics are allowed only while Runtime / Realm / Cognition authority remains
the sole source for durable product state and enforcement.

## S-AIP-008 Adapter Capability Manifest Semantics

Adapter capability manifests describe target-library capabilities that are
usable through a Nimi adapter. The `support` field answers whether a caller
using the target library can exercise the named library capability through the
adapter: `supported`, `partial`, `unsupported`, or `not-applicable`.

Ownership and execution placement are recorded separately in `mode`. A
framework-owned capability, such as a target library's caller-side tool execute
callback or multi-step orchestration, must not be marked unsupported solely
because Nimi Runtime does not own that orchestration. Conversely, Runtime-owned
or adapter-owned gaps must remain explicit instead of being hidden behind a
broader target-library capability claim.

Provider-defined tools, provider-executed tool calls/results, provider approval
rounds, sources, and raw stream chunks are evaluated as target-library
interfaces. They may be marked supported by an adapter when the adapter
faithfully maps the interface to admitted Nimi SDK/Runtime contracts, while
individual Runtime provider routes still fail closed if they cannot preserve the
provider-specific semantics.
