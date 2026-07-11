# SDK Surface Contract

> Owner Domain: `S-SURFACE-*`

## S-SURFACE-001 TypeScript SDK Public Subpath Set

The vNext TypeScript `@nimiplatform/sdk` package public subpaths are fixed to:

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/runtime/generated`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/realm/generated`
- `@nimiplatform/sdk/app`
- `@nimiplatform/sdk/types`
- `@nimiplatform/sdk/contracts`
- `@nimiplatform/sdk/ai`
- `@nimiplatform/sdk/ai-runner`
- `@nimiplatform/sdk/testing`
- `@nimiplatform/sdk/features/conversation`
- `@nimiplatform/sdk/features/knowledge-context`
- `@nimiplatform/sdk/features/memory-context`
- `@nimiplatform/sdk/features/generation`
- `@nimiplatform/sdk/features/workflow`
- `@nimiplatform/sdk/features/evaluation`
- `@nimiplatform/sdk/features/toolkits`

The TypeScript package keeps one base SDK package. External framework adapters
are independent packages and must not be restored as base SDK adapter subpaths.

Removed old subpaths such as `@nimiplatform/sdk/runtime/browser`,
`@nimiplatform/sdk/runtime/agent-identity`, `@nimiplatform/sdk/world`,
`@nimiplatform/sdk/ai-provider`, `@nimiplatform/sdk/ai-app`,
`@nimiplatform/sdk/scope`, `@nimiplatform/sdk/scope/permission`, and
`@nimiplatform/sdk/platform-catalog` must fail closed instead of forwarding to
new internals.

The `@nimiplatform/sdk` root entrypoint is the recommended app-level
composition surface for first-party docs/examples; subpaths remain explicit
low-level escape hatches or dedicated domain entrypoints.

执行命令：

- `pnpm check:sdk-vnext-package-contract`

## S-SURFACE-002 Runtime SDK 对外方法投影

The vNext TypeScript app-facing Runtime facade projection groups methods
by service. Method names must align with the corresponding service entries in
`.nimi/spec/runtime/kernel/tables/rpc-methods.yaml` and use design names. For
the TypeScript facade only, the service list and projected method set are
governed by
`.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml` (S-SURFACE-009);
each group tracks alignment status and phase independently.

`runtime-method-groups.yaml` is not the cross-language core method source.
Cross-language core method truth comes from Runtime proto plus admitted
generator/spec inputs under `S-SURFACE-019`, and generated Runtime bindings
must not use the TypeScript facade table as selective omission authority.

app-facing `runtime.route.*` route projection surface 是例外的 host-typed logical surface，遵循 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`）。该例外覆盖 `listOptions / resolve / checkHealth / describe` 的 app-facing facade，但不得被误写成新增 daemon 顶层 RPC 投影，且不得把 SDK projection 升级为 catalog、readiness、capability 或 fallback policy authority。

当 `RuntimeCognitionService` / `RuntimeAgentService` 进入 SDK 投影时，公开
surface 必须维持 runtime-owned authority cut：

- `runtime.memory.*` 仅投影 `RuntimeCognitionService` 中的 runtime-owned memory family
- `runtime.knowledge.*` 仅投影 `RuntimeCognitionService` 中的 runtime-owned knowledge family
- memory embedding runtime readiness/bind/cutover methods remain under the
  `runtime.memory.*` SDK namespace as host/runtime typed logical methods backed
  by retained runtime-private memory depth; they must not be treated as a
  standalone `RuntimeMemoryService` or canonical agent memory direct-write path
- steady-state agent authority surface is `RuntimeAgentService`
- current admitted SDK public projection for the agent surface is
  `runtime.agent.*`
- reactive agent-chat consumption is currently carried separately on the
  reserved `runtime.agent` app-message seam via the admitted app-messaging
  transport, rather than a parallel reactive-chat RPC subgroup
- app-facing canonical agent control plane and canonical agent memory write path
  must remain unified on that runtime-owned agent projection, rather than
  drifting back to direct Realm memory mutation or provider-native memory API
- SDK may expose typed request builders and projections for
  `runtime.agent.getAgentCanonicalMemoryBankStatus` and
  `runtime.agent.requestAgentCanonicalMemoryBankBind`, but must not synthesize
  canonical bank mode/status from Runtime Agent AI Config `text.embed` form state,
  runtime-private inspect state, or raw `GetBank`
- `@nimiplatform/sdk/realm` 不再承载 canonical agent-memory public helper；runtime-era app path 只能消费 `runtime.agent.*`
- Runtime Agent reads/events may carry only the Runtime-admitted
  `LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projection
  families. The facade preserves their closed enums and bounded fields; it
  does not publish the private context manifest or a caller context-attachment
  parameter.

## S-SURFACE-003 Runtime SDK 禁用旧接口名

SDK 对外契约层禁止出现以下旧接口名：

- `listTokenProviderModels`
- `checkTokenProviderHealth`
- `TokenProvider*`

## S-SURFACE-004 Realm/Scope 稳定导出面

- Realm SDK 以实例化 facade 为唯一入口，不允许全局配置入口。
- Scope SDK 以 in-memory catalog + publish/revoke 语义为最小稳定面。

## S-SURFACE-005 Realm 公开命名去 Legacy

Realm SDK 公开符号（类型名、service 名、公开方法名、property-enum 键名）必须使用规范命名，禁止暴露 legacy 命名。

- 禁止：`*2fa*` / `*2Fa*` / `*2FA*`、`Me2FaService`、`SocialV1DefaultVisibilityService`、`SocialFourDimensionalAttributesService` 等旧命名。
- 允许保留协议字面量（wire literal）用于与服务端契约对齐，例如路径 `/api/auth/2fa/*`、schema key `Auth2faVerifyDto`、枚举值 `needs_2fa`。
- 命名归一化必须在 codegen 层完成，不允许在公开 facade 层依赖 legacy → new alias 桥接。

执行命令：

- `pnpm check:sdk-vnext-realm-consumer-smoke`

## S-SURFACE-006 App Realm Access Boundary

`apps/**` 中的生产代码访问 Realm 时只能通过以下两类入口：

- codegen 生成的 `realm.services.*`
- 经明确登记的 typed adapter 模块

禁止在 app 生产代码中直接：

- 调用 `realm.raw.request(...)` 或 `realm.unsafeRaw.request(...)`
- 传递字面量 `/api/...` 路径或 URL
- 使用 `fetch('/api/...')` 直连 Realm REST

例外必须收敛到显式 allowlist，并由仓库检查脚本追踪。

执行命令：

- `pnpm check:no-app-realm-rest-bypass`

## S-SURFACE-007 Raw Escape Hatch 命名硬切

- Realm SDK 不再公开 `realm.raw` 兼容别名；如确有未覆盖的底层场景，只允许显式 `realm.unsafeRaw` 命名。
- Runtime SDK 不再公开 `runtime.raw` 兼容别名；低层调用统一使用 `runtime.call(...)` 或显式 `runtime.unsafeRaw`。
- 公开 surface 不允许保留 legacy alias 作为“平滑迁移”层；未规范化合同必须通过 `unsafe` 命名暴露，避免被误读为稳定 typed API。
- `unsafeRaw` 是显式底层 escape hatch 本身，不得被 SDK public domain
  facade 包装成稳定 API。任何 Realm operation 在进入 SDK public domain
  之前必须先进入 Realm OpenAPI/codegen 或被登记为具名 typed adapter；不得以
  `unknown` request/response 和字面量 `/api/...` path 暴露。
- 一旦 Realm-managed runtime grant 合同落地，bridge helper 必须直接调用生成的 typed service（`realm.services.RuntimeRealmGrantsService.issueRuntimeRealmGrant`），不得继续走 `realm.unsafeRaw.request(...)`。

执行命令：

- `pnpm check:sdk-vnext-matrix`

## S-SURFACE-008 App-Facing Realm DTO 必须具名且可消费

第一方 app 直接消费的 Realm DTO 不得退化为匿名内联 object、`Record<string, never>` 或 `unknown` map；必须满足：

- 关键嵌套结构使用具名 schema，例如 agent profile DNA、friend list response、world/worldview 语义块。
- 生成后的 SDK `.d.ts` 必须允许 app 直接读取常用嵌套字段，不得要求先把返回值打回 `Record<string, unknown>` 再自行清洗。
- 回归门禁必须覆盖这些高频 DTO 和对应 operation 的生成结果。

执行命令：

- `pnpm check:sdks-conformance-typed-core`

## S-SURFACE-009 Runtime 方法投影表治理

`.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml` is the structured
fact source for the vNext TypeScript app-facing Runtime facade projection only.
It uses an explicit-maintenance plus consistency-check model:

- explicit maintenance: the table lists only the TypeScript SDK
  app-facing projection set and is not required to mechanically equal the full
  runtime kernel proto surface.
- consistency check: every group must declare its corresponding runtime
  service, and method names must be resolvable in
  `.nimi/spec/runtime/kernel/tables/rpc-methods.yaml`; the check script blocks
  drift.

The table is not a cross-language core method source, not an omission list for
generated Runtime bindings, and not a release waiver for any generated core
language. Generated Runtime bindings derive their core method truth from Runtime
proto plus admitted generator/spec inputs under `S-SURFACE-019`.

## S-SURFACE-010 Realm Dynamic Envelope Allowlist

Realm codegen 生成出的 `[key: string]: unknown` 字段不得默认为“可接受动态对象”。必须满足：

- 每个 unknown-map 字段都要进入显式 allowlist，并带上动态边界分类。
- 未登记的 unknown-map 视为 contract regression，必须回到 backend OpenAPI 命名建模或先补 allowlist 说明。
- allowlist 仅用于真正动态 envelope、metadata、patch/value、manifest 等边界；高频 app-facing 业务结构不得长期停留在 allowlist 中。

执行命令：

- `pnpm check:sdks-conformance-typed-core`

## S-SURFACE-011 Runtime Stable AI Surface No-Struct

`@nimiplatform/sdk/runtime`、`@nimiplatform/sdk/ai`、独立 adapter package
以及第一方 app 中对稳定 AI product surface 的消费，不得再把 typed runtime
protobuf 输出降格回 `google.protobuf.Struct`、`Record<string, unknown>` 或
`asRecord(...)` 补锅解析。必须满足：

- stable sync 输出直接读取 `ScenarioOutput` oneof；
- stable async media/stt 输出直接读取 `GetScenarioArtifactsResponse.output` 中的 typed `ScenarioOutput` oneof；
- stable stream 输出直接读取 `ScenarioStreamDelta` oneof；
- stable text request 输出配置直接读取 typed `TextGenerateScenarioSpec.reasoning`，不得借由 `Record<string, unknown>` 或 metadata 影子字段传 reasoning 开关；
- stable text stream 消费必须保留 `reasoning` 与正文的独立分支，不得静默压平或并回 `text`；
- app-facing runtime convenience、core AI 和 adapters 不得再暴露
  `fallback: 'allow' | 'deny'` 之类的产品语义 fallback 开关；
- stable helper 缺 typed output、artifact metadata 或 mime/result 字段时必须直接报错，不得再补默认 `artifactId`、`application/octet-stream`、`audio/wav` 或空 artifact 成功路径；
- relay/desktop 对这些稳定能力的消费不得再通过 `result.object`、`Struct.fields.*`、artifact bytes/mime 约定、或 `Record<string, unknown>` 恢复语义。

真正动态的 workflow/internal envelope、plugin manifest、transport/error raw payload 仍可保留动态边界，但必须与稳定 AI product surface 明确分层。

执行命令：

- `pnpm check:runtime-stable-ai-output-typing`

## S-SURFACE-012 World Evolution Engine Logical Facade Placement

World Evolution Engine typed facade candidates are logical consumer surfaces, not a new SDK package root or a new Runtime RPC method-group family.

Placement rules:

- app-facing candidate facades land on existing SDK public composition surfaces governed by `S-RUNTIME-091` and `S-RUNTIME-092` through `S-RUNTIME-096`
- shared types may be re-exported through existing SDK public surfaces when they remain projection-derived and consumer-seam-only

The following are not admissible:

- a new `@nimiplatform/sdk/world-evolution-engine` stable subpath
- recording World Evolution Engine logical facades in `runtime-method-groups.yaml` as if they were daemon RPC parity
- treating host-injected facade shape as proof of host concrete API authority

## S-SURFACE-013 World Evolution Engine Selector-Read Stable Method Placement

World Evolution Engine selector-read stable methods must stay on existing public composition surfaces.

Allowed placement:

- app-facing selector-read methods on the SDK root composition surface governed by `S-RUNTIME-102`
- shared selector / result / rejection / view type families on existing SDK public surfaces when they remain projection-derived helper types

Forbidden placement:

- a new SDK public subpath for World Evolution Engine
- `@nimiplatform/sdk/runtime` or `Runtime` class publication of selector-read methods as daemon convenience
- any `runtime-method-groups.yaml` entry that records selector-read methods as RPC parity
- any placement that implies host concrete API ownership or transport-owned semantics

## S-SURFACE-014 World Domain Feature Placement

The old `@nimiplatform/sdk/world` subpath is not part of the vNext public
subpath set. World-facing developer workflows are exposed through admitted
Realm helpers, root composition, and `@nimiplatform/sdk/features/workflow`
without creating a separate world package root.

Placement rules:

- world feature helpers may compose Realm and Runtime-facing surfaces without
  re-owning their semantic homes
- workflow helpers must remain feature-level developer ergonomics, not Runtime
  RPC parity or a renamed `world-evolution-engine` publication path
- removed world subpath imports must fail closed rather than forward to
  `features/workflow`

Forbidden interpretations:

- treating a world feature helper as provider-native request authority
- treating a world feature helper as renderer-driver API publication
- treating a world feature helper as the semantic owner of `K-WEV`
  execution-evidence surfaces

## S-SURFACE-015 SDK Developer Experience Layer

SDK may own developer ergonomics, not platform truth.

Admitted SDK developer-experience capabilities include:

- typed request builders and response decoders
- structured-output parsers and schema validation helpers
- stream assemblers that preserve typed event branches
- app-facing facade composition over admitted Runtime / Realm / Cognition
  projection surfaces
- protocol adapters such as Vercel AI SDK providers, test transports, and
  language bridges when they consume admitted public SDK / Runtime surfaces
- developer test harnesses and mocks whose non-production status is explicit

These helpers must remain mechanically explainable as composition over admitted
SDK public surfaces. They may reduce boilerplate and normalize caller ergonomics,
but they must not become hidden owners of provider routing, model defaults,
permission grants, app lifecycle, memory, session, event, audit, or durable
domain truth.

## S-SURFACE-016 Non-Authoritative Client Orchestration

SDK may expose client-side orchestration helpers only when their authority
posture is explicit and non-canonical.

Allowed orchestration includes:

- ephemeral chat state assembly for the current consumer process
- local tool-loop coordination for caller-supplied tools
- retry/backoff and stream aggregation within existing transport contracts
- structured output retries or repair prompts when the returned value is still
  treated as model output and not as committed platform truth
- test-only fake Runtime / Realm transports

The output of such orchestration is either ephemeral consumer state or an
explicit request to an authoritative Runtime / Realm / Cognition service. SDK
must not present client-orchestrated state as canonical session, memory,
agent-event, audit, permission, provider, model, or app lifecycle truth.

## S-SURFACE-017 Canonical Commit Boundary For SDK Helpers

When a SDK helper produces data that a product wants to persist, publish, or use
as platform authority, the helper must hand the data to the owning service
through an admitted typed operation.

Examples:

- chat-derived memory must go through the admitted RuntimeAgentService /
  Cognition memory policy path, not a SDK-local memory writer
- app lifecycle state must go through Runtime app lifecycle projection, not
  process reachability or file existence
- Realm social or group transcript commits must go through Realm-owned typed
  operations, not Runtime candidate output or SDK stream text
- provider/model selection must come from Runtime route/config projection or
  explicit caller input, not a SDK-local routing table

SDK may validate, format, preview, or stage candidate data before commit. It may
not silently commit, infer authority from helper success, or treat a successful
local parse as an authoritative domain write.

## S-SURFACE-018 Integration Adapter Admission

SDK integration adapters are admitted when they translate an external developer
framework into Nimi public surfaces without importing private implementation or
changing authority ownership.

Adapters for Vercel AI SDK, LangChain, Agno, Python, or other ecosystems must:

- use public SDK / Runtime / Realm entrypoints only
- surface capability gaps explicitly instead of emulating unsupported Runtime
  semantics as success
- keep framework-owned ephemeral state separate from Runtime / Realm /
  Cognition canonical truth
- avoid provider/model hardcoding and provider-native secret custody
- preserve typed finish/error/usage semantics as far as the target framework
  allows, and fail closed when a required semantic cannot be represented

An adapter may provide migration convenience. It must not become an alternate
OpenAI-compatible Runtime endpoint, a shadow agent runtime, or a parallel app
permission / memory / session system.

## S-SURFACE-019 SDKS Core Family Placement

SDK family work targets `sdks/`, especially `sdks/typescript` for the full
next-major `@nimiplatform/sdk` implementation.

Required Phase 1 family roots:

- `sdks/generators`
- `sdks/conformance`
- `sdks/typescript`
- `sdks/python`
- `sdks/go`
- `sdks/rust`

Core SDK means Runtime and Realm public interface coverage together for a
language. A Runtime-only package, Realm-only package, partial method package,
or derivative adapter is not core-ready.

`sdks/generators` owns generated core facts for the family, including Runtime
method IDs, method allowlists, unary/stream codec maps, request/response
contract maps, Realm operation maps, Realm service registries, Realm model
maps/property enums, reason-code tables, and core export manifests. These facts
must be generated from admitted inputs such as Runtime proto, Realm OpenAPI,
and sdks/Runtime/Realm spec tables; they must not be hand-copied from archived
old SDK source.

`sdks/conformance` owns language-neutral core conformance fixtures and expected
protocol traces. Each language owns only its harness binding. A language is
core-ready only when shared conformance passes for Runtime and Realm together.

The archived old SDK tree is comparison evidence only. This contract must not
create forwarding packages, restore old subpaths, or claim compatibility
through shims or fake success.

External framework adapters are excluded from base core readiness unless
explicitly admitted by adapter capability manifests. App clients, permission
clients, AI config helpers, runtime route helpers, local environment helpers,
and feature helpers remain TypeScript-only until the TypeScript implementation
is stable.

## S-SURFACE-020 TypeScript Feature And Adapter Family

The old `@nimiplatform/sdk/ai-app` subpath is hardcut. Surviving session-loop,
conversation, structured-output, tool, and stream-assembly capabilities move to
TypeScript core AI/AI runner and feature exports:

- `@nimiplatform/sdk/ai`
- `@nimiplatform/sdk/ai-runner`
- `@nimiplatform/sdk/features/conversation`
- `@nimiplatform/sdk/features/generation`
- `@nimiplatform/sdk/features/toolkits`
- independent adapter packages such as
  `@nimiplatform/sdk-adapter-vercel-ai`

Feature and adapter surfaces are developer-experience infrastructure only. They
must not:

- persist product session, thread, message, draft, memory, event, audit, or
  permission truth
- create a Runtime `AiConversation` or generic daemon chat-history authority for
  ordinary app product sessions
- infer provider/model routing, fallback policy, capability readiness, or
  default models
- write canonical memory, knowledge, agent state, Realm records, or account
  state
- claim unsupported external framework parity

Durable product session ownership remains with the consumer product owner:

- app-local when the session is app-specific, local, and not cross-device truth
- Realm when the session is cloud canonical, social, account-scoped,
  cross-device, or multi-user business truth
- Runtime only when the session is part of Runtime-owned Agent lifecycle or
  another explicitly admitted Runtime authority domain

The string `chat`, `conversation`, or `session` is not sufficient evidence for
Runtime placement. Placement follows the underlying authority: Agent lifecycle
chat belongs to Runtime; ordinary app AI session loops consume Runtime AI but
do not become Runtime truth by default.

## S-SURFACE-021 Runtime Agent Turn Consumer DX Surface

SDK may expose reusable Runtime Agent turn consumer helpers under
`@nimiplatform/sdk/runtime` when they are thin developer-experience
orchestration over the admitted public `runtime.agent.turns` surface.

Admitted primitives include:

- typed `RuntimeAgentTurnRequest` runners that subscribe to
  `runtime.agent.turns`, submit the explicit caller-provided turn request, and
  interrupt the same turn on caller abort
- event queues and stream assemblers for `runtime.agent.turn.*`,
  `runtime.agent.presentation.*`, `runtime.agent.state.*`, and
  `runtime.agent.hook.*` consume events
- non-authoritative voice/lipsync playback schedule decisions assembled from
  typed `runtime.agent.presentation.voice_playback_requested` and
  `runtime.agent.presentation.lipsync_frame_batch` events, with Runtime
  timeline authority and stream identity preserved
- request-id / committed-message correlation for ignoring backlog events on the
  same conversation anchor
- terminal snapshot recovery that calls the public
  `runtime.agent.turns.getSessionSnapshot` projection and replays typed
  synthetic consume events only when Runtime reports terminal turn evidence
- typed session snapshot transcript parsers that accept replayable transcript
  entries only when Runtime provides the required replay envelope
  (`id`, `status`, `kind`, `created_at`, `updated_at`) and preserve Runtime
  parent linkage without app-local derivation
- non-authoritative diagnostics, timeline summaries, projection summaries, and
  metadata callbacks for app UI/debug consumers
- read-only correlation/render helpers for `LocalAgentSourceContextStatus` and
  `AgentTurnContextSummary`, preserving Runtime-owned refs, hashes, lane ids,
  counts, budgets, truncation, and typed failure states without reading raw
  context
- fixture runners and mock `RuntimeAgentTurnsModule` harnesses for second-app
  consumer tests

This surface is SDK DX/client-orchestration only. It must not:

- create, plan, validate, or execute Runtime Agent turns
- infer agent identity, conversation-anchor truth, memory policy, autonomy,
  hooks, presentation posture, APML/message-action existence, voice/media
  workflow truth, provider/model routing, readiness, audit, or permissions
- infer, synthesize, or persist voice workflow success when Runtime has not
  emitted admitted voice/lipsync evidence
- synthesize terminal success when Runtime has not emitted or exposed terminal
  turn evidence
- persist transcript, session, message, memory, or event truth
- synthesize Agent Chat replay transcript identity, status, kind, timestamps,
  or parent bindings when Runtime omits them
- bypass `runtime.agent.turns.*` admitted transport or Runtime Agent service
  projections
- accept caller system/developer roles, source/world overrides, raw LocalAgent
  context, lane text/order, execution bindings, or forged context manifests
- assemble or override Runtime-owned LocalAgent prompt/context from either
  bounded summary family

Runtime remains the authority for Agent lifecycle chat. Apps may use SDK turn
consumer helpers to render Runtime-owned Agent Chat projections, but product
screens own only user intent, UI metadata callbacks, view-model composition,
and ephemeral renderer state.

## S-SURFACE-022 Runtime Scenario Job Consumer DX Surface

SDK may expose reusable Runtime scenario job consumer helpers under
`@nimiplatform/sdk/runtime` when they are thin developer-experience
orchestration over admitted public Runtime job surfaces.

Admitted primitives include:

- typed runners that submit an explicit caller-provided
  `ScenarioJobSubmitInput` through `runtime.media.jobs.submit`
- typed runners that submit an explicit caller-provided
  `RuntimeAiSubmitScenarioJobRequestInput` through
  `runtime.ai.submitScenarioJob` for SDK provider/framework adapters
- job-event stream consumption through `runtime.media.jobs.subscribe`
- terminal recovery through `runtime.media.jobs.get` when the Runtime event
  stream ends before terminal job evidence is observed
- low-level status recovery through `runtime.ai.getScenarioJob` for Runtime AI
  scenario jobs that do not expose a public event stream
- artifact collection through `runtime.media.jobs.getArtifacts` only after
  Runtime reports `COMPLETED`
- artifact collection through `runtime.ai.getScenarioArtifacts` only after
  Runtime reports `COMPLETED`
- abort-to-cancel wiring that calls `runtime.media.jobs.cancel` for the same
  Runtime job, or `runtime.ai.cancelScenarioJob` for the same Runtime AI
  scenario job, and preserves the caller abort as an SDK error path
- non-authoritative status projections, update callbacks, fixture job modules,
  and mock job transports for app and Kit tests

This surface is SDK DX/client-orchestration only. It must not:

- create, validate, execute, schedule, or materialize scenario jobs
- infer provider/model routing, fallback policy, capability readiness,
  provider health, artifact truth, audit truth, or permissions
- synthesize terminal success when Runtime has not reported `COMPLETED`
- fetch artifacts for failed, canceled, timed-out, or nonterminal jobs as if
  the product scenario succeeded
- persist product generation history, asset ownership, Realm records, local
  files, or renderer state
- bypass the admitted public Runtime job surfaces

Runtime remains the authority for scenario job lifecycle, provider/model
routing, execution, readiness, artifacts, reason codes, audit, and fail-closed
enforcement. Kit may use this SDK runner to render reusable generation panels,
but Kit owns only UI/headless state mapping and app consumers own any product
history, review, save, or commit behavior. SDK ai-provider adapters may use the
same Runtime AI scenario job runner, but adapters own only framework request and
response mapping, not job lifecycle truth.
