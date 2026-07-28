# SDKs Client Core - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/sdks/client-core.authority.yaml`。

---

<!-- source: .nimi/spec/sdks/kernel/surface-contract.md -->

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

## S-SURFACE-002 Runtime SDK 对外方法投影

The vNext TypeScript app-facing Runtime facade projection groups methods
by service. Method names must align with the corresponding service entries in
`config/runtime-rpc-methods.yaml` and use design names. For
the TypeScript facade only, the service list and projected method set are
governed by
`config/sdks-runtime-method-groups.yaml` (S-SURFACE-009);
each group tracks alignment status and phase independently.

`runtime-method-groups.yaml` is not the cross-language core method source and
is not protected Desktop admission authority. Cross-language core method truth
comes from Runtime proto plus admitted generator/spec inputs under
`S-SURFACE-019`, and generated Runtime bindings must not use the TypeScript
facade table as selective omission authority.

The sole protected first-party Desktop operation-set input is Runtime's
`first-party-protected-runtime-profiles.yaml` under `K-PLOCAL-006`. SDK codegen
must join that registry to RPC method/kind authority and emit closed
`DesktopMachineProductRuntimeMethods` and
`DesktopAccountProductRuntimeMethods` types plus purpose-specific machine and
account intent clients. Exact public names may evolve only through this rule and
the generated projection; the method memberships cannot be copied into an SDK
table. Desktop production code must not import, return, store, cast to, or
construct the full `Runtime` facade. A profile-external method is a generation,
type, and structural-gate failure, not a deferred carrier error.

Host injection supplies transport and selects a generated named intent outside
renderer control. SDK/renderer inputs expose no endpoint, carrier, profile,
role, principal, app id, account, owner authority, session, boot epoch, token,
grant, scope, metadata authority, or arbitrary method id. Account-client calls
and streams bind Runtime's current account generation and surface typed
relogin/retry state after logout, switch or generation change; they never
silently reopen. First-party product clients are distinct from third-party app
permissions and must not project permission/grant UX. The independent Runtime
account/Realm broker remains a separate narrow client and does not merge into
the machine or account product method groups.

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
- Realm 不提供 runtime grant bridge；SDK 不得生成、包装或回退到 `issueRuntimeRealmGrant`。Source Materialization packet 是 Runtime 内部消费的已认证第一方产品操作，不进入 app-facing Realm facade，也不接受 app grant、scope 或 `accessGrantId`。

执行命令：

- `pnpm check:sdk-release-contracts`

## S-SURFACE-008 App-Facing Realm DTO 必须具名且可消费

第一方 app 直接消费的 Realm DTO 不得退化为匿名内联 object、`Record<string, never>` 或 `unknown` map；必须满足：

- 关键嵌套结构使用具名 schema，例如 agent profile DNA、friend list response、world/worldview 语义块。
- 生成后的 SDK `.d.ts` 必须允许 app 直接读取常用嵌套字段，不得要求先把返回值打回 `Record<string, unknown>` 再自行清洗。
- 回归门禁必须覆盖这些高频 DTO 和对应 operation 的生成结果。

执行命令：

- `pnpm check:sdks-conformance-typed-core`

## S-SURFACE-009 Runtime 方法投影表治理

`config/sdks-runtime-method-groups.yaml` is the structured
fact source for the vNext TypeScript app-facing Runtime facade projection only.
It uses an explicit-maintenance plus consistency-check model:

- explicit maintenance: the table lists only the TypeScript SDK
  app-facing projection set and is not required to mechanically equal the full
  runtime kernel proto surface.
- consistency check: every group must declare its corresponding runtime
  service, and method names must be resolvable in
  `config/runtime-rpc-methods.yaml`; the check script blocks
  drift.

The table is not a cross-language core method source, not an omission list for
generated Runtime bindings, not protected Desktop admission authority, and not
a release waiver for any generated core language. Generated Runtime bindings
derive their core method truth from Runtime proto plus admitted generator/spec
inputs under `S-SURFACE-019`. Protected Desktop narrow clients derive their
membership only from Runtime's `first-party-protected-runtime-profiles.yaml` and
must fail generation when the profile row, RPC kind, intent, owner postcondition,
negative-test class, or gate reference is missing or contradictory.

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

This historical placement proposal is retired. Current canonical authority
keeps general Workflow and World Evolution deferred, so the SDK publishes no
`@nimiplatform/sdk/world`, `@nimiplatform/sdk/features/workflow`, or root-client
workflow convenience surface. Admitted Realm world reads remain available only
through their existing Realm-owned typed methods.

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

---

<!-- source: .nimi/spec/sdks/kernel/runtime-contract.md -->

# SDK Runtime Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-010 Runtime Client Construction

Runtime SDK 不允许隐式全局单例。`@nimiplatform/sdk` 根入口的
`createNimiClient()` / `NimiClient` 是 app-owned 显式组合面：调用方明确
提供 Runtime、Realm、App、AI、Agent 与 feature surface 所需配置或实例，不
恢复 retired platform-client singleton。runtime 子路径上的 `new Runtime()`
仅作为允许的 low-level escape hatch：

- Production protected calls require an injected Kit/native host carrier that
  has already mutually verified the Runtime service and live caller process.
- `node-grpc`, loopback `127.0.0.1:46371`, `NIMI_RUNTIME_ENDPOINT`,
  `NIMI_APP_ID`, caller-supplied endpoint/app id, and bearer metadata can at
  most reach independently admitted public/binding-only methods; they never
  establish protected origin.
- Environment/default endpoint convenience is allowed only in separately
  signed synthetic non-product fixtures and cannot claim product readiness.
- If the exact transport required by a method is absent, every environment
  fails closed with a typed actionable error.

## S-RUNTIME-011 Module Projection

Runtime 子路径公开方法集合由 `runtime-method-groups.yaml` 约束，必须与 runtime kernel RPC 面对齐。

允许在 `Runtime` 类上提供 ergonomic convenience 方法（如 `generate()` / `stream()`），但必须是对既有 runtime text surface 的薄投影，不得分叉推理语义、错误语义或 trace/usage 语义。

当 `RuntimeCognitionService` 与 `RuntimeAgentService` 进入 public projection
后，runtime 子路径必须保持以下 authority split：

- `runtime.memory.*` 投影 `RuntimeCognitionService` 的 runtime-owned memory family
- `runtime.knowledge.*` 投影 `RuntimeCognitionService` 的 runtime-owned knowledge family
- memory embedding runtime readiness/bind/cutover methods remain under the
  `runtime.memory.*` SDK namespace, but they are host/runtime typed logical
  methods backed by retained runtime-private memory depth; they are not a new
  `RuntimeMemoryService` and not canonical agent memory direct-write shortcuts
- steady-state runtime-owned live agent control plane belongs to
  `RuntimeAgentService`
- the app-facing steady-state agent projection is `runtime.agent.*`
- reactive agent-chat consumption is currently carried through the admitted
  app-messaging transport addressed to reserved target `runtime.agent`, rather
  than a separate reactive-chat RPC family
- that agent projection may additionally project runtime-owned
  persistent `AgentPresentationProfile`
- canonical agent memory 的 app-facing mutation 统一经该 runtime-owned agent projection
- canonical agent memory bank status/bind 的 app-facing helper may be SDK
  DX/projection only when it delegates to `runtime.agent.*`; it must not
  combine memory embedding config, inspect state, or `GetBank` as a second
  status authority
- `runtime.memory.*` 不得被 app 误用为 canonical agent memory 直写捷径
- current-thread avatar interaction state must stay above runtime and must not be promoted into a new `runtime.avatar.*` truth surface

Runtime Agent AI Config（K-AGCORE-144~150）的 app-facing 面固定为
`runtime.agent.aiConfig.*` 逻辑模块：

- `get()` / `readiness()` / `subscribeReadiness()` 消费 committed config 与
  readiness projection；`upsert({ expectedRevision, intents })` 是唯一的
  mutation 入口，revision 冲突必须以 typed concurrent-modification 失败浮出，
  不得静默重试覆盖。
- SDK 不得缓存 readiness 作为自有 truth，不得从 `AIConfig` overlay、route
  projection、或 app 局部状态重算 agent chat binding truth。
- Agent turn request 不携带 execution binding payload（K-AGCORE-147）。turn
  runner 的 route/model 显示上下文只能来自 Runtime turn 事件/快照投影。

`runtime.route.describe(...)` 的 app-facing route metadata projection 边界由 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`）约束；在 runtime transport authority 定稿前，它不得被表述为新的 daemon convenience method。

media convenience 也必须遵守同一原则：新增 ergonomic API 只能封装既有 `ScenarioJob` + artifact 主链，不得引入新的推理语义或绕过 runtime 校验。`runtime.media.music.iterate()` 属于允许的薄投影，必须复用 `MUSIC_GENERATE` 与 `nimi.scenario.music_generate.request` 扩展面。

Runtime image helper `buildLocalProfileExtensions()` 仅用于编码 `entry_overrides` 与 `profile_overrides` 到既有 runtime request extension；Runtime music helper `buildMusicIterationExtensions()` 仅作为低层 extension builder。两者不是新的推理 owner，也不替代 `runtime.media.music.iterate()` 的官方主路径。

Runtime AI session-loop helpers are not Runtime daemon method projections. SDK
may expose app AI loop DX through core AI/Agent/features under
`S-SURFACE-020`, but those helpers must compose admitted Runtime AI consume
surfaces rather than adding ordinary product-session methods to
`RuntimeAiService` or recording app chat-history helpers in
`runtime-method-groups.yaml`.

`RuntimeAiService` remains the execution owner for AI consume, provider/model
routing, readiness, jobs, artifacts, audit/fail-closed enforcement, and typed
scenario output. It does not own ordinary app product `thread`, `message`,
`draft`, or session-history truth by default. Runtime-owned chat session truth
is admitted only through `RuntimeAgentService` Agent lifecycle or another
explicit Runtime authority rule.

已知 method id 的低层调用必须通过 `Runtime.call()` 与 method-id contract map 绑定；`runtime.raw` 兼容别名不再是允许的公开 surface。

high-level convenience targeting 必须满足：

- `runtime.generate({ prompt })` / `stream({ prompt })`：本地默认文本模型
- `runtime.generate({ model: '<local-model-id>', ... })`：本地显式模型
- `runtime.generate({ provider: '<provider>', ... })`：provider 默认文本模型
- `runtime.generate({ provider: '<provider>', model: '<model>', ... })`：provider 显式模型

其中 high-level `model` 只表示具体模型，不承担 provider/route alias 语义；fully-qualified remote model id 必须留在低层 `runtime.ai.text.*` surface，不得作为 high-level convenience public contract。

SDK 不解析 `~/.nimi/runtime/config.json` 或 `<runtime_owner_state_root>/nimi.json`；模型默认值
（`defaultLocalTextModel`、`defaultCloudProvider`、`provider.defaultModel`）由
runtime 按 K-CFG-002 优先级解析后通过 RPC 响应返回。SDK convenience 方法仅
传递调用方意图，不做本地 config 回退。

high-level local targeting 只允许：

- bare local default：`local/default`
- qualified local model：`local/<model-root>`
- canonical engine prefix：`llama/`、`media/`、`speech/`、`sidecar/`

`localai/`、`nexa/`、`nimi_media/`、`localsidecar/` 属于 invalid legacy input；SDK 不得继续把它们当作合法 public contract。

high-level app-facing runtime convenience surface 不得继续暴露 route/provider fallback 开关：

- `runtime.generate()` / `runtime.stream()`
- `runtime.ai.text.*`
- `runtime.media.*`
- core AI and independent adapter packages

这些 surface 必须固定使用 `FallbackPolicy.DENY`，不得允许调用方以 `fallback: 'allow' | 'deny'` 修改稳定 product contract。

## S-RUNTIME-012 Metadata Projection

connector/body 字段与 metadata 字段必须按 transport 合同分层传递。

## S-RUNTIME-015 ready() Fail-Close

Runtime `ready()` 探测失败必须抛出 `RUNTIME_UNAVAILABLE`，不得 fail-open。

## S-RUNTIME-023 Deferred Service Projection

Phase 2 deferred 服务必须显式标记不可用语义，不得冒充 active。

## S-RUNTIME-028 Disconnected Event

连接中断时 SDK 必须发射 `runtime.disconnected` 事件，重建决策交给调用方。

## S-RUNTIME-045 Retry Backoff Baseline

Runtime gRPC 重试基线为指数退避（200ms 初始，3000ms 上限），不自动重连流式订阅。

## S-RUNTIME-050 Blocked vs Deferred

blocked 与 deferred 是不同状态：blocked 由依赖缺失造成，deferred 属于路线图阶段控制。

## S-RUNTIME-066 Pagination Projection

Runtime List RPC 的分页默认值与 Realm REST 客户端分页默认值可不同，必须在文档层显式说明。

Runtime 分页具体默认值（`K-PAGE-001`）：
- 默认 `page_size` = 50
- 最大 `page_size` = 200
- 超出范围时 runtime 自动 clamp 至 [1, 200] 区间，不报错

## S-RUNTIME-067 鉴权与主体上下文分离

> **Authority Disposition**：
> 本规则仅在 **Web/cloud 与 external-principal 模式** 保留为 app-provided auth/subject seam。所有 local Runtime app 模式下，本规则被 superseded：SDK 不允许接收或取得 app/host bearer、`auth.accessToken`、`subjectContext`、refresh-token provider、session store 或 subject provider；account 上下文与 Realm data 只能通过 Runtime projection、scoped binding 和 Runtime-mediated operations 消费。Removed public token/refresh identities are reserved。详见 `S-RUNTIME-109`。

Runtime SDK 必须将“鉴权 token”与“业务主体标识”分离建模：

- `auth.accessToken`：用于 Runtime AuthN（`authorization` 注入）。
- `subjectContext`：用于填充请求体 `subjectUserId`。

两者语义独立，不得复用同一配置字段。
Neither field establishes K-PLOCAL protected origin or permits any removed
public credential-grant operation.

**模式适用范围（authority split）：**

- Web / cloud 显式 adapter 模式：保留。
- external-principal 模式：保留。
- 所有 local Runtime app 模式：app-provided 或 SDK-acquired bearer、
  `auth.accessToken` / `subjectContext` provider **禁止**；只允许
  Runtime-mediated typed operations。

Runtime SDK 还必须保持 multi-agent truth boundary：

- app 可以维护 local `current/default/pinned agent` UX state
- 该状态不得被提升为 runtime-owned platform default agent truth
- 每个 agent-scoped wire call 仍必须显式解析到一个 `agent_id`
- SDK 不得把 construction-time bound agent helper 作为 canonical public
  surface；multi-agent consume path 必须显式接收 `agent_id`

## S-RUNTIME-068 Subject Context 命名规范

RuntimeOptions 公开字段必须使用 `subjectContext` 命名，不得继续暴露 `authContext` 旧命名。

## S-RUNTIME-069 调度器并发拒绝

Runtime 调度器在 per-app 并发上限（2）或全局并发上限（8）达到时返回 `RESOURCE_EXHAUSTED`（`K-DAEMON-007`）。SDK 处理规则：

- `RESOURCE_EXHAUSTED` 属于 S-ERROR-004 定义的 retryable transport code，SDK 应按 S-RUNTIME-045 退避重试基线自动重试。
- 饥饿检测超时（30s）触发的拒绝同样投影为 `RESOURCE_EXHAUSTED`，SDK 行为一致。

## S-RUNTIME-070 Session 恢复协议

Public/binding-only consumers may explicitly reconnect and call `OpenSession`
(`K-AUTHSVC-012`), but the result remains binding-only and cannot recover or
rebind protected authority:

- 恢复失败按 S-RUNTIME-045 退避重试基线重试。
- 不区分网络故障和 daemon 重启——两者恢复策略相同（重新建立连接并打开新 session）。
- session 恢复是消费者侧职责，SDK 不自动执行（与 S-TRANSPORT-003 禁止隐式重连一致）。
- A Desktop protected disconnect discards the origin/session immediately. The
  native carrier must repeat service-principal, endpoint, live process, same
  executable object and release-record verification, then open a fresh empty
  `OpenDesktopSession`. SDK cannot copy a session id/bearer onto the new
  connection. A local-app child reconnect repeats `PrepareLocalAppLaunch`,
  verified process bind and request-empty `OpenLocalAppSession`; it never
  recovers the pre-restart session.

## S-RUNTIME-071 Connector 字段预校验（建议性）

SDK 可在客户端侧对 Connector 操作执行预校验以改善 DX（`K-RPC-007`/`K-RPC-008`）：

- `CreateConnector`: 请求面只表示 `REMOTE_MANAGED` 创建路径，不接受调用方自定义 `kind`；`api_key` 必填。
- `UpdateConnector`: 至少包含一个可变字段，否则建议在客户端侧提前拒绝。

此规则为建议性（SHOULD），服务端强制校验是权威。客户端预校验旨在减少无效 RPC 往返。

## S-RUNTIME-072 Music Iteration Fail-Fast

SDK 对 `runtime.media.music.iterate()` 必须执行最小 fail-fast 预校验，以减少无效 RPC 往返：

- `mode` 只能是 `extend | remix | reference`
- `sourceAudioBase64` 必须非空且可解码
- `trimStartSec` / `trimEndSec` 必须为非负数
- 同时提供 start/end 时必须 `trimEndSec > trimStartSec`

该预校验不得替代 runtime 权威校验；服务端 reason code 仍是权威事实源。

## S-RUNTIME-073 Stable AI Output Typed Projection

SDK runtime 高层文本/embedding/语音与多媒体 convenience surface 必须直接消费稳定 typed proto output，不得继续把 `ExecuteScenarioResponse.output` 当作 `google.protobuf.Struct` 使用。

- `runtime.generate()` / `runtime.ai.text.generate()` 必须从 `ScenarioOutput.textGenerate` 投影文本结果。
- `runtime.embed()` / `runtime.ai.text.embed()` 必须从 `ScenarioOutput.textEmbed` 投影向量结果。
- `runtime.media.tts.synthesize()` 必须从 `GetScenarioArtifactsResponse.output.speechSynthesize` 投影稳定结果，不得仅把 artifact 列表当作隐式语义载体。
- `runtime.media.stt.transcribe()` 必须从 `GetScenarioArtifactsResponse.output.speechTranscribe` 投影转录结果，不得再从 artifact bytes 恢复文本语义。
- `runtime.media.image.generate()`、`runtime.media.video.generate()`、`runtime.media.music.generate()` 必须从 `GetScenarioArtifactsResponse.output.{imageGenerate|videoGenerate|musicGenerate}` 投影稳定结果，不得仅把 artifact 列表当作隐式语义载体。
- 文本 stable surface 必须以 typed `reasoning` 配置透传 `TextGenerateScenarioSpec.reasoning`；不得继续用 metadata、extensions 或自由对象拼装推理开关。
- 流式 text/speech/media helper 必须从 `ScenarioStreamDelta` 显式 oneof 分支读取 `text`、`reasoning` 或 `artifact`；不得依赖旧的自由字段或手工 `Record<string, unknown>` 解析。
- `runtime.ai.text.stream()` 的稳定顺序必须允许 `start -> reasoning-delta* -> delta* -> finish|error`；SDK 不得把 reasoning chunk 合并回普通 text，也不得在 unsupported provider 上伪造 reasoning 事件。
- high-level `Runtime.stream()` 若暴露文本 convenience chunk，也必须保留独立 reasoning chunk 类型；不得为了兼容旧 helper 折叠 reasoning 语义。
- `Struct` 仅允许出现在 low-level explicit-dynamic scenario/workflow 边界；稳定 product surface 不得把 `Struct` 暴露为默认 app-facing contract。
- stable helper 缺 typed output、缺 artifact metadata、缺稳定 mime/result 字段时必须 fail-close；不得补默认 `artifactId`、`application/octet-stream`、空 artifact 成功、或 content-type 占位值来伪装成功路径。

## S-RUNTIME-091 World Evolution Engine App-Facing Logical Facade Boundary

World Evolution Engine app-facing typed facade candidates may be published only as SDK logical consumer facades layered on already-admitted projection-visible Runtime shapes.

Allowed app-facing candidate families are limited to:

- observe family
- selector-read family
- request family

These candidates must follow `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-085` through `S-RUNTIME-096`) and must remain satisfiable through SDK public surface only.
Selector-read stable publication is additionally governed by `S-RUNTIME-102`.

They must not:

- be recorded as new daemon top-level RPC method groups
- imply `new Runtime()` or `@nimiplatform/sdk/runtime` already owns host-specific observation lifecycle or control-plane semantics
- bypass `S-RUNTIME-079` through `S-RUNTIME-084` projection hardcuts
- widen Runtime execution semantics beyond `K-WEV-*`

## S-RUNTIME-102 World Evolution Engine App-Facing Selector-Read Publication Profile

App-facing stable selector-read publication may exist only on the SDK public composition surface.

The stable app-facing logical namespace is fixed to `worldEvolution`.
The stable app-facing logical operations are fixed to:

- `worldEvolution.executionEvents.read(selector)`
- `worldEvolution.replays.read(selector)`
- `worldEvolution.checkpoints.read(selector)`
- `worldEvolution.supervision.read(selector)`
- `worldEvolution.commitRequests.read(selector)`

These app-facing logical methods must preserve the shared semantic matrix defined by `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-097` through `S-RUNTIME-101`).

`@nimiplatform/sdk/runtime` may share selector, result, rejection, and view type families for these methods, but it must not publish the selector-read methods themselves as:

- `Runtime` class convenience methods
- runtime-subpath daemon convenience methods
- new top-level RPC parity claims

App-facing selector-read publication must not add:

- observe or subscribe siblings
- session or lifecycle siblings
- effectful request siblings
- pagination or buffering semantics
- fallback or re-inference knobs

## S-RUNTIME-105 `worldEvolution` Non-Equivalence Boundary

The root-level `worldEvolution` logical namespace remains the SDK composition
surface for the adjacent `K-WEV` execution-evidence line governed by
`S-RUNTIME-091` and `S-RUNTIME-102`.

Boundary rules:

- `worldEvolution` is not the semantic owner of world feature helpers
- `worldEvolution` does not restore the removed `@nimiplatform/sdk/world`
  subpath
- execution-event, replay, checkpoint, supervision, and commit-request
  evidence publication remain distinct from world-domain fixture, render, and
  session composition semantics

## S-RUNTIME-103 Agent Presentation Projection Boundary

SDK runtime may project runtime-owned persistent `AgentPresentationProfile` and
the admitted transient `runtime.agent.turn.*` / `runtime.agent.presentation.*`
families plus admitted read-only `runtime.agent.state.*` projection only as
part of `runtime.agent.*` surfaces.

Fixed rules:

- the SDK may expose stable avatar asset refs, backend kind,
  expression/idle preset refs, default `VoiceReference` binding, anchor-scoped
  turn/text projections, backend-neutral presentation requests, status text,
  execution state, current emotion, and posture projection when runtime makes
  them public
- projection must remain downstream of `K-AGCORE-022` through `K-AGCORE-026`; SDK must not reinterpret missing profile fields into fallback avatar truth
- anchor-scoped turn/presentation projection must preserve
  `conversation_anchor_id`, `turn_id`, `stream_id`, and `message_id` semantics
  rather than collapsing them into app-local session guesses
- SDK must not publish a parallel top-level `runtime.avatar.*` daemon convenience surface for the same persistent truth
- SDK must not expose APML parser events as the durable app-facing product path;
  APML remains runtime model-facing input and SDK consumers observe only typed
  `runtime.agent.*` projections unless a later mounted runtime rule admits
  another surface
- SDK must not publish Avatar generated motion routes, backend capability
  profiles, mapping sidecars, or mapping confidence labels as runtime-owned
  payload truth. Those are Avatar-owned downstream projection facts consumed
  after typed `runtime.agent.*` delivery.
- SDK typed projection helpers must preserve the distinction between public
  APML wire syntax and typed runtime presentation events; no SDK helper may
  re-admit public `<motion>`, `<expression>`, `<lookat>`, `<pose>`, or
  `<clear-pose>` syntax by translating it client-side.
- SDK may combine typed `runtime.agent.presentation.voice_playback_requested`
  / `runtime.agent.presentation.voice_stream_chunk_available` /
  `runtime.agent.presentation.lipsync_frame_batch` events into a
  non-authoritative playback schedule for app/Kit consumers when all Runtime
  timeline authority fields, turn identity, stream identity, audio artifact
  identity, and drift bounds remain explicit and fail closed.
- SDK must not decide whether Desktop manual playback, Avatar autoplay, or
  text-only fallback applies. Those decisions are Runtime voice policy truth.
- SDK runtime packages must not import browser-only audio processing dependencies
  such as WebAudio worklets or `wlipsync`; Avatar/browser helpers may live in
  Kit Avatar entrypoints downstream of typed Runtime events.
- LocalAgent source/context readiness on `runtime.agent.*` may project only as
  the Runtime-owned `LocalAgentSourceContextStatus` and
  `AgentTurnContextSummary` families. This presentation rule does not admit the
  private context manifest, lane content, source/world records, prompt,
  transcript text, memory content, packet/proof, provider payload, credential,
  or tool arguments/results.

## S-RUNTIME-104 Renderer-Local Transient Non-Owner Boundary

SDK runtime is not the semantic owner of renderer-local transient avatar
interaction state.

Fixed rules:

- runtime-owned current emotion may project through
  `runtime.agent.state.current_emotion` /
  `runtime.agent.state.emotion_changed`
- speaking/listening phase, viseme, amplitude, and renderer-local attention
  target remain app/surface-side inputs unless a later runtime contract admits
  them explicitly
- SDK may carry runtime-owned turn/presentation/emotion projections, but it
  must not elevate renderer-local values into runtime canonical read/write truth
- when first-party apps combine runtime-owned presentation profile with surface-local avatar interaction state, the ownership cut must remain explicit and fail-closed

## S-RUNTIME-106 Broad Event API Deferral Boundary

The closed 2026-04-20 SDK Event API design remains evidence only. The active SDK
runtime surface admits the current `runtime.agent.*` consume path, not a general
platform event API.

Active SDK boundary:

- `runtime.agent.turns.subscribe(...)` may merge admitted app-message turn /
  presentation events with RuntimeAgentService state/hook events
- `runtime.agent.turns.subscribe(...)` may filter by explicit `agentId` and
  optional `conversationAnchorId`
- emitted SDK event names and payloads must remain downstream of
  `.nimi/spec/runtime/agent-service.authority.yaml`
- SDK parsing must fail closed on invalid runtime activity category or
  intensity values

Not admitted on the stable SDK surface in the current authority set:

- `client.events.on(...)`, `once(...)`, `onBefore(...)`, `emit(...)`, or
  `clear(...)` as a broad app developer event bus
- wildcard subscription contracts for `desktop.*`, `avatar.*`, `system.*`,
  `apml.*`, or third-party namespaces
- cancellable before-event semantics
- SDK-owned app-event schema or rate-limit truth

Future admission of the broad Event API requires a new SDK/runtime authority
packet and must not be inferred from historical design evidence.

## S-RUNTIME-107 Local SDK Consumer Trust Posture

The SDK local runtime consumer posture is an active SDK/runtime boundary, not a
historical trust checklist.

Fixed rules:

- the only app-facing source-materialization facade is
  `materializeRealmSource({ sourceRef, requestId })`, which invokes only the
  Runtime `MaterializeRealmSource` operation; `sourceRef` is the closed
  `CharacterSourceRefV3` union (`worldCharacter | personaCharacter`) and the
  response contains only opaque `localAgentRef`, bounded
  `LocalAgentSourceContextStatus`, `idempotentReplay`, and typed failure reason
- the facade must not accept Realm base URL, bearer, grant, challenge,
  audience, Packet v3, proof, segment, component, chunk, semantic payload,
  prompt/context, or caller-selected LocalAgent identity; acquisition and the
  private transaction remain Runtime-owned
- SDK consumers must provide explicit `agentId` for every localAgent-scoped runtime
  call; construction-time current-localAgent helpers are not canonical truth
- `conversationAnchorId` is the only admitted cross-surface continuity scope for
  a selected conversation; SDK must not synthesize app-local session ids or
  reuse same-localAgent traffic across anchors
- auth credentials, subject context, localAgent identity, and conversation anchor
  identity remain separate inputs; SDK must not infer one from another
- runtime reconnect/session recovery is consumer-owned per `S-RUNTIME-070`; SDK
  may expose recovery methods such as anchor snapshot/session snapshot reads,
  but it must not silently reconnect, reopen, or downgrade to fixture/mock data
- protected runtime agent turn read/write paths must request the admitted
  runtime scopes for that operation and must fail closed when runtime rejects the
  request
- SDK runtime consume projection remains downstream of active runtime authority
  and must not import runtime-private implementation packages or app-local
  avatar/Desktop surfaces
- source readiness consumers accept only closed, read-only
  `LocalAgentSourceContextStatus`: ready/state and typed reason; source
  kind/ref/schema/`sourceHash`; SnapshotV2 schema/hash/captured-at; world and
  materialization-context hashes; and coverage section states/counts
- turn context consumers accept only closed, read-only
  `AgentTurnContextSummary`: ready/state and typed reason; manifest/compiler
  versions and manifest/content/prompt hashes; safe source/snapshot/world
  refs/hashes; ordered lane ids/status/counts; budget/use/truncation summary;
  transcript, memory, media, and tool counts; and route/catalog digest
- unknown schema, enum, state, lane, or reason fails closed; SDK must not
  backfill, reinterpret, or persist an offline-success context projection
- SDK must reject raw source/world/core/closure records, prompt/lane/transcript
  text, private memory, packet/proof/chunks, provider payloads, credentials,
  tool arguments/results, or free-form maps on these public families
- SDK may correlate and render these summaries, but it must not assemble,
  override, or attach LocalAgent source/context to an Agent turn

- AUTHORITY-RELATION subject=sdk action=consume-status object=localagent-source value=bounded-only polarity=require
- AUTHORITY-RELATION subject=sdk action=consume-status object=localagent-context value=bounded-only polarity=require

Trust-posture evidence must be current implementation or test evidence from the
SDK/runtime public surface. Closed 2026-04-20 trust posture artifacts may be
used only as historical evidence and cannot close this rule by themselves.

## S-RUNTIME-108 Presentation Timeline Consume Boundary

The SDK may expose PresentationTimeline metadata only as a downstream projection
of runtime-owned `runtime.agent.*` timeline-bearing events admitted by
`K-AGCORE-051`.

Fixed rules:

- SDK must preserve runtime-owned `agentId`, `conversationAnchorId`, `turnId`,
  `streamId`, timebase, offset, duration, deadline, and interrupt semantics
  without collapsing them into app-local session or renderer state
- SDK parsing must fail closed on malformed timing metadata, unknown timeline
  channel names, invalid negative offsets, or non-monotonic voice/lipsync frame
  sequences once the concrete runtime schema is admitted
- SDK must not publish this branch as `client.events.*`, wildcard subscription,
  cancellable before-event, or general app-event broker behavior
- SDK must not synthesize voice timing, lipsync frames, or mouth-open values;
  those values remain runtime/provider/avatar downstream data with explicit
  ownership
- SDK may provide ergonomic typed accessors over admitted timeline metadata, but
  those accessors must remain thin projections over runtime event payloads

Retired SDK Event API and PresentationTimeline designs are evidence only and
cannot close SDK timeline support without current tests.

## S-RUNTIME-109 Local Runtime Account And Local App Consumer

> Authority: SDK kernel
>
> Upstream Runtime authority: `K-ACCSVC-*`（`account-session-contract.md`）、`K-BIND-*`（`scoped-app-binding-contract.md`）。

**Owner-only authority allocation.** SDK owns typed Runtime APIs and trusted carriers only. It may validate and transport opaque owner-issued projections, bindings, and failures, but SDK MUST NOT own or infer account, token, unary, realtime, or media truth. SDK configuration, generated descriptors, helpers, caches, and app-mode discriminators cannot grant privilege, mint credentials, select a canonical Realm endpoint, or replace Runtime refresh and data-plane decisions.

The verified Desktop account-UX facade remains the only local account-control
consumer. Bundled first-party surfaces retain their admitted first-party
projection. Third-party apps use one `LOCAL_APP` facade over the final
host-injected protected carrier; SDK does not receive caller/session bootstrap
fields.

Fixed rules:

- `local-first-party-app` and `local-app` are the only local app modes. A mode
  name, app id, manifest, registry row, project path or loopback connectivity
  does not authorize.
- The `local-app` facade exposes session status, public permission posture and
  request by product permission id, plus app-private JSON storage. The current
  public permission set is reserved, so it exposes no Artifact/RuntimeAgent
  operation. It does not expose
  login/logout/switch, account control, presence mutation, scoped/workspace
  binding control, generic Realm, generic Runtime or generic RuntimeAgent APIs.
- Session-bound zero-permission, process-replaced, account-changed,
  Runtime-restarted and unavailable are distinct session projections.
  Permission posture is a separate owner projection; SDK cannot infer or cache
  authorization from session state or prior success.
- Shipped Zhiyu/Avatar stay bundled first-party. An isolated Zhiyu integration
  build is `local-app` and cannot inherit bundled identity or bindings.
- The Desktop account-UX facade may expose only methods listed in the protected
  transport matrix and only when the injected native carrier proves
  `desktop_account_host`; SDK never derives that role.
- Removed public token/refresh, credential-grant and exact-operation local-app
  grant wire identities remain reserved. Apps may only read/request admitted
  product permission ids and cannot approve, revoke or mutate owner decisions.
- No local mode accepts or exposes `auth.accessToken`, refresh token,
  authorization-header/subject provider, session store, JWT hook, Realm base,
  principal/record/grant/session identifiers, or equivalent credential surface.
- Runtime-mediated operation tables remain exact allowlists; SDK cannot fall
  back to direct Realm, `MeService`, HTTP proxy, direct daemon, SDK-owned 401
  refresh, generated descriptor or a broader Runtime client.
- Missing carrier, account state when required, record, session, admitted
  permission decision/selector or operation-owner state fails closed with typed unavailable/permission results,
  never anonymous, fixture or mock success.

Web/cloud adapter 与 external-principal mode 仍可保留 app-provided token / subject provider 输入，但这些 mode 必须在公共 surface 上显式 fenced，且不得对 local first-party 消费可达。

Only the Desktop account-UX facade may expose
`runtime.account.requestPresenceVerification(...)`, as a typed thin
projection of `RuntimeAccountService.RequestPresenceVerification` on the
verified Desktop carrier. Ordinary app facades must not export it. SDK must not implement the
second factor itself, accept passwords or secrets from the app, convert current
login/access-token state into verified presence, or call Realm server APIs as
the acceptance path. Only Runtime may orchestrate a Realm-backed fresh
`NIMI_REAUTH` fallback behind this method, and SDK/app consumers only receive
the Runtime response state/method/expiry. Non-verified, unavailable, cancelled,
or expired Runtime responses remain fail-closed.

## S-RUNTIME-110 Desktop-Owned Login Adapter Surface

local account login/logout/switch UX 仅由 Desktop account UX 拥有，并以
`ACCOUNT_CALLER_MODE_DESKTOP_SHELL` 调用 Runtime `BeginLogin` /
`CompleteLogin` / `Logout` / `SwitchAccount`。SDK 在 Desktop-owned composition
中仅扮演 typed projection；third-party `LOCAL_APP`、binding-only
Avatar 与 ordinary first-party app facades 不得暴露这些 account-control helper：

The facade is constructible only from the injected verified native carrier and
the Runtime-derived `desktop_account_host` role. A caller enum or bearer cannot
construct it, and none of its request/response/session material enters renderer
IPC.

- SDK 只在 Desktop account-UX facade 暴露 typed `beginLogin(...)`、
  `completeLogin(...)`、`logout(...)`、`switchAccount(...)` 包装并转发到
  Runtime；不得在 SDK 层完成 token exchange 或解码 JWT。
- removed public refresh 不属于 app-facing facade。SDK broker/token
  composition 不得恢复它；refresh 由 Runtime private helper 完成。
- SDK 不得在 local first-party mode 暴露 Realm 直接登录路径；登录只允许通过 Runtime Nimi Auth Browser callback proof。
- SDK 必须把 Runtime 返回的 UX instruction envelope（不含 PKCE verifier）原样投影给 kit / Desktop。
- SDK 必须把 `CompleteLogin` proof envelope 视为不透明字节包，不得检查、解析或重写 token 字段。
- 登录失败 reason code 必须按 `K-ACCSVC-008` 投影；不得合并、改写、或以 anonymous fallback 替代。

## S-RUNTIME-111 Runtime Artifacts Bytes Retrieval

> Upstream Runtime authority: `K-AGCORE-053`（`runtime-artifact-contract.md`）。

SDK 必须暴露通用 artifact bytes 取回 surface，与 typed media projection 体系（`S-RUNTIME-073`）正交。avatar 等 first-party app 用此 surface 按 `audio_artifact_id`（来自 `voice_playback_requested.detail` / `voice_stream_chunk_available.detail`）取回 runtime-emitted audio artifact 的原始 bytes，用于本地 audio decode + wLipSync 等下游消费。`lipsync_frame_batch` 若继续存在，其 metadata artifact identity 不得与 playable audio artifact identity 混用。

固定规则：

- SDK 必须以 `Runtime` class `readonly artifacts: RuntimeArtifactsModule` 字段暴露 `runtime.artifacts.readBytes({ artifactId, expectedMimePrefix? }): Promise<{ bytes: ArrayBuffer; mimeType: string; sizeBytes: number; mimeInferred: boolean }>` 稳定 high-level convenience API。
- SDK 必须以 `Runtime['client']` / RPC binding 形态暴露底层 `runtimeClient.readArtifactBytes(request: ReadArtifactBytesRequest, options?: RuntimeCallOptions): Promise<ReadArtifactBytesResponse>`，绑定到 `RuntimeArtifactService.ReadArtifactBytes` proto method id。
- `ReadArtifactBytes` 的 wire binding 仅是 typed projection，不代表 public
  transport admission。普通 `Runtime.generated`、`Runtime.artifacts`、app
  session metadata 和 direct local gRPC 必须返回
  `SDK_RUNTIME_METHOD_UNAVAILABLE` 且不得发出请求；只有当前 admitted 的
  protected local-app carrier、admitted product permission、owner selector/policy
  与 artifact audience 同时成立后才能消费该 binding。当前 `artifacts.open` 尚未
  admitted，因此第三方 local app 必须得到 typed unavailable。
- SDK Runtime class 的 `artifacts` module 必须暴露 Runtime-owned generated voice cleanup RPC binding：`cleanupGeneratedVoiceArtifacts({ agentId?, conversationAnchorId? })`，绑定到 `RuntimeArtifactService.CleanupGeneratedVoiceArtifacts`；SDK 不得在 app/Avatar 层实现文件删除逻辑。
- SDK 不得以 singleton const（如 `export const runtime = { artifacts }`）形式暴露 artifacts namespace；必须通过 Runtime class 实例化路径（`new Runtime(options)` 或 `createLocalFirstPartyRuntimePlatformClient(...)`）。
- `expectedMimePrefix` 用于 SDK fail-fast：runtime 返回 `mime_type` 不以 prefix 开头（case-insensitive）时，SDK throw `NimiError(reasonCode: ARTIFACT_MIME_MISMATCH)`，不暴露 bytes。
- SDK 必须在该 surface 上 enforce `fallback: 'deny'`（与 `runtime.media.*` 同 policy）；不允许调用方修改 fallback policy。
- SDK 必须把 `ARTIFACT_INVALID_INPUT` / `ARTIFACT_NOT_FOUND` / `ARTIFACT_TOO_LARGE` / `ARTIFACT_FORBIDDEN` / `ARTIFACT_MIME_MISMATCH`（`K-AGCORE-053`）作为稳定 reason code，必须 fail-close 透传到 caller；不得返回空 bytes / 默认 mime / 假装成功。
- SDK 对 voice playback/chunk audio artifact 的 `expectedMimePrefix` 应使用
  `audio/`；返回非 audio mime 必须 fail-close，不得把 lipsync metadata 或
  synthetic placeholder 交给 audio decoder。
- SDK runtime client 不得在 mime 缺失时填默认值；mime 必须由 runtime 端打 `mime_inferred: true`。
- 此 surface 不替代 `getScenarioArtifacts(jobId)`（job-typed projection；S-RUNTIME-073）或 `getVoiceAsset(GetVoiceAssetRequest)`（voice asset library）；用例正交，三者并存。
- `runtime.artifacts.readBytes` 入参 `expectedMimePrefix` 仅接受 RFC-6838 合法 top-level type（`audio/`、`image/`、`video/`、`text/`、`application/`、`model/` 等）；`music/` 不是合法 top-level type（music artifacts 实际为 `audio/*`），SDK 不得 advertise 它为合法 prefix。

drift check：

- SDK 不得在 `readBytes` 失败时返回空 bytes、默认 mime、或假装成功路径。
- SDK 不得为 `readBytes` 暴露 fallback / retry-on-decode-failure 旋钮（K-ERR-003 / S-RUNTIME-085 同 posture）。
- SDK readBytes mime prefix check 必须 case-insensitive；不得 exact-match。

## S-RUNTIME-123 Local Runtime Transfer State Projection

> Upstream Runtime authority: `K-LOCAL-024`（`local-catalog-recommendation-contract.md`）。

Runtime LocalService owns local transfer lifecycle state. SDK local-runtime
transfer parsers are typed projections over that state only.

Fixed rules:

- `state` is the canonical lifecycle field for local transfer progress events
  and session summaries.
- `done` and `success` are terminal flags derived from Runtime-owned `state`;
  SDK must not reverse-infer `completed`, `failed`, or `cancelled` from these
  booleans when `state` is absent or invalid.
- SDK must fail closed on missing or unknown transfer `state`.
- When Runtime provides `done` or `success`, SDK must verify those booleans are
  consistent with `state`; mismatches must fail closed instead of being
  projected as progress or completion.
- Desktop, Tester, Kit, and other apps may render SDK transfer projections but
  must not maintain a second transfer lifecycle state machine.

## S-RUNTIME-124 Runtime Agent Memory Observatory Projection Helper Boundary

> Upstream Runtime authority: `runtime-agent-canonical-memory-contract.md`
>
> Consumer product driver: Zhiyu H5 Memory Observatory local companion surface.

SDK Runtime Agent Memory Observatory helpers are typed read-only projections
over admitted RuntimeAgentService memory read envelopes. They may compose the
existing SDK canonical memory export helper, which itself reads
`RuntimeAgentService.GetAgentState` and `RuntimeAgentService.QueryAgentMemory`,
but they do not own memory truth, memory lifecycle truth, or app-local memory
identity.

Fixed rules:

- SDK Memory Observatory helpers must project canonical agent memory as
  `canonical-agent-memory` authority class and preserve Runtime-owned agent id,
  memory id, bank key, canonical class, memory kind, summary, provenance,
  timestamps, replication outcome, policy reason, and recall score from the
  RuntimeAgentService read envelope.
- SDK Memory Observatory helpers may expose product-readable state such as
  `ready` or `empty`, record counts, bank counts, lineage, and semantic
  confidence only when those values are directly available from the admitted
  memory export envelope.
- SDK Memory Observatory helpers must represent lifecycle fields not present on
  the admitted read envelope as explicit `not_projected` states. This includes
  review state, redaction state, and forget/retire intent.
- SDK Memory Observatory helpers must not infer review, redaction, forget
  intent, consent/grant state, provider/model facts, or app-local memory
  identity from metadata, summaries, timestamps, confidence, UI state, or cache.
- SDK Memory Observatory helpers must not call memory write/mutation paths,
  `runtime.memory.*` as a canonical agent memory shortcut, provider APIs,
  app-level REST, Desktop implementation modules, or Runtime private packages.

## S-RUNTIME-125 Runtime Agent Canonical Review Status Projection

> Upstream Runtime authority: `K-AGCORE-016a`（`runtime-agent-canonical-memory-contract.md`）
>
> Consumer product driver: Zhiyu Memory Observatory lifecycle transparency.

SDK may expose a typed read-only projection over
`RuntimeAgentService.GetAgentCanonicalMemoryReviewStatus` for canonical
agent-facing memory banks.

Fixed rules:

- SDK review status helpers must preserve Runtime-owned bank identity,
  readiness, executor availability, last review follow-up id, checkpoint basis,
  completion time, next eligibility time, and recoverable review-run id as read
  projection values.
- SDK must not infer review readiness, redaction, forget, retire, or per-record
  lifecycle state from memory records, metadata, summaries, confidence,
  timestamps, UI state, app cache, or provider/model outputs.
- SDK must not expose review execution, redaction, forget, or retire mutation
  through this projection helper.
- When Runtime does not project review status, SDK/app consumers must keep
  lifecycle fields explicit as unavailable or `not_projected`; they must not
  backfill product copy with synthetic lifecycle values.

---

<!-- source: .nimi/spec/sdks/kernel/transport-contract.md -->

# SDK Transport Contract

> Owner Domain: `S-TRANSPORT-*`

## S-TRANSPORT-001 Runtime Transport 显式声明

Runtime SDK transport 必须满足以下构造边界：

- `node-grpc`
- `tauri-ipc`
- `electron-ipc`
- native `protected-local-host` carrier (host-injected; never renderer-constructed)

The `@nimiplatform/sdk/testing` deterministic in-process Simulator harness is
not a Runtime transport and must not be added to this transport enum. It is
injected through the host-neutral SDK facade, opens no network/native carrier,
and is excluded from production transport selection. Missing production
transport therefore continues to fail closed even when the testing subpath is
installed.

Electron transport rules:
- Non-Node Runtime consumers must pass an explicit transport. Supported explicit transports are `node-grpc`, `tauri-ipc`, and `electron-ipc`.
- `electron-ipc` / `tauri-ipc` generic renderer bridges can carry only
  independently admitted public/binding-only operations. They must reject
  protected method ids and authorization-bearing renderer payloads.
- Protected Desktop calls use the host-injected native carrier. SDK receives a
  typed carrier handle, never endpoint/session/process/trust material, and
  cannot derive or inject origin. Third-party app calls use the final
  host-injected `LOCAL_APP` carrier; bundled first-party calls retain their
  separately admitted carrier.

规则：

- Production has no `NIMI_RUNTIME_ENDPOINT` or implicit endpoint discovery for
  protected calls. A Node loopback default is allowed only for separately
  signed synthetic non-product fixtures and public/binding-only testing.
- Non-Node surfaces require an explicit ordinary transport or injected native
  carrier. Missing method-required carrier fails closed.

## S-TRANSPORT-002 Metadata 投影边界

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/key never enters SDK transport metadata; Runtime resolves
  connector/credential refs inside service-principal custody
- an `authorization` bearer may serve only an explicitly fenced Web/cloud,
  external-principal, or ordinary public AuthN contract; it never establishes
  K-PLOCAL protected origin or invokes the public Grant tombstones

幂等键透传：SDK 支持通过 `options.idempotencyKey` 传递 `x-nimi-idempotency-key` metadata（`K-DAEMON-006`）。缺省时不设置该 header，runtime 不做去重。

## S-TRANSPORT-003 流式行为边界

- SDK 不得隐式重连续流。
- 中断后必须由调用方显式重建订阅。

## S-TRANSPORT-004 Realm 请求引擎边界

Realm SDK 必须通过实例级配置完成 endpoint/token/header 合并，不允许共享全局 OpenAPI 运行态配置。

## S-TRANSPORT-005 SDK/Runtime 版本兼容边界

SDK 与 Runtime 的版本协商必须显式可判定：

- major 不兼容必须 fail-close，不允许静默降级为”部分可用”。
- minor/patch 差异允许通过能力探测或方法可用性检查做受控降级。
- 版本兼容判断结果必须可被上层读取（用于提示与治理），不得仅写日志。

发现机制：

- 版本信息通过初始连接的 metadata 交换获取。
- 方法可用性通过已知方法集合（`runtime-method-groups.yaml`）静态判定，不依赖运行时反射。
- 降级仅限于 Phase 2 deferred 方法标记为不可用，不改变 Phase 1 方法语义。

**Protected protocol**：Production Desktop/Runtime compatibility is proven
before SDK traffic by mutual platform-native process and code-signing verification: exact
`protected_local_protocol_version` plus reciprocal peer release-id admission.
Typed status returns the verified release id. Semver metadata is advisory for
ordinary public transports only; missing protected compatibility never uses
best-effort or assumes compatibility.

**blocked vs deferred 语义区分**：

- `blocked`：Phase 1 服务但 proto 依赖未就绪，SDK 返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`。blocked 服务的方法一旦 proto 发布即可实现，不需要版本协商。当前无 blocked 服务（ConnectorService proto 已就绪，`S-RUNTIME-050`）。
- `deferred`：Phase 2 服务（如 WorkflowService），在版本兼容降级中标记为不可用。deferred 服务的可用性取决于 runtime 版本支持。

## S-TRANSPORT-006 Trace 与可观测性边界

- SDK 必须支持将调用链 trace 标识透传到下游（如 metadata/header）。
- 任何可观测性输出禁止包含明文凭据（api key/token）。
- 可观测性是辅助面，不得改变请求成功/失败语义与重试判定。

## S-TRANSPORT-007 流式终帧投影

SDK 必须将 runtime 流式终帧（`done=true`）中的 `reason_code` 和 `usage` 投射给消费者：

- `done=true + REASON_CODE_UNSPECIFIED` = 正常完成。
- `done=true + 错误 reason_code` = 业务错误（非 gRPC 错误），SDK 必须作为流级错误投影，不可静默丢弃。
- 终帧语义权威定义：`K-STREAM-002`（建流阶段边界）、`K-STREAM-003`（文本流事件约束，含 usage 与 done 语义）、`K-STREAM-004`（语音流事件约束）。
- `SubscribeScenarioJobEvents` 不使用 `done=true` 语义（`K-STREAM-005`），终态后 server 关流。

Mode B 投影规则（`SubscribeScenarioJobEvents`）：

- 终态事件（`K-JOB-002` 定义的 `COMPLETED`/`FAILED`/`CANCELED`/`TIMEOUT`）到达后，server 以 gRPC OK 正常关闭流（`K-STREAM-005`）。
- SDK 必须在收到终态事件后停止流读取，将终态事件作为最终结果投影给消费者。
- SDK 不得将 gRPC OK close 视为错误——终态事件即为流的语义终止信号。
- 当消费者随后通过 `GetScenarioJob` 轮询终态失败时，结构化失败细节投影遵循 `S-ERROR-016`。

Mode C 投影规则（`ExportAuditEvents`）：Phase 2 服务（`audit_service_projection`），当前不定义 SDK 投影规则。

Mode D 投影规则按 Phase 分层：

- **Phase 1 健康订阅流**（`SubscribeRuntimeHealthEvents`、`SubscribeAIProviderHealthEvents`）：属于 Phase 1 frozen 的 daemon 健康监控功能（`K-DAEMON-001`~`010`、`K-PROV-003`），归入 `health_monitoring_projection` 分组。SDK 必须投影为 `runtime.healthEvents` / `runtime.providerHealthEvents` 订阅接口。Desktop 通过 IPC 桥（`D-IPC-002`）消费等价数据，两条路径语义等价。独立 SDK 消费者通过此投影获得 Phase 1 健康事件订阅能力。流关闭语义遵循 `K-STREAM-010`。
- **Phase 2 应用消息流**（`SubscribeAppMessages`）：属于 Phase 2 服务（`app_service_projection`），当前不定义 SDK 投影规则。

## S-TRANSPORT-008 流式超时投影

流式 RPC 超时由 runtime 侧强制执行（`K-STREAM-007`）：

- 首包超时默认 10s（由 runtime 侧配置控制，`K-DAEMON-008`），SDK 侧不可覆盖；超时触发 `DEADLINE_EXCEEDED + AI_PROVIDER_TIMEOUT`。
- 总超时默认 120s，独立计时，可由 runtime 配置调整（`K-DAEMON-008`，`K-DAEMON-009`）。
- SDK 不叠加独立客户端侧流超时（除非显式配置）。
- `AI_PROVIDER_TIMEOUT` 属于可重试 ReasonCode（`S-ERROR-007`）。

## S-TRANSPORT-009 Chunk 透传边界

- Runtime chunk 缓冲至最小 32 bytes（`K-STREAM-006`）。
- SDK 不重新拆分或合并 chunk，直接透传 runtime 边界。

## S-TRANSPORT-010 Runtime 鉴权注入边界

- `auth.accessToken` is available only in explicit Web/cloud or
  external-principal adapters whose own authority admits it. It is unreachable
  from every local Runtime app/Desktop facade.
- Local protected account, lifecycle, Realm, connector, AI and service-control
  calls never inject a bearer. They require the native verified carrier and the
  exact Runtime-derived origin/operation policy.
- Public/binding-only calls cannot be upgraded by a bearer, app id, caller enum
  or metadata. Removed public token/refresh and credential-grant methods remain
  reserved. Local-app public permission posture/request uses the protected
  owner surface and never returns a portable credential or owner decision id.
- `metadata.extra` and renderer IPC must reject `authorization`, provider keys,
  Realm bases, protected session ids and origin material rather than silently
  stripping and continuing.

## S-TRANSPORT-014 Local-Development Carrier Projection

The SDK local-development transport is host-injected by Kit and is never
renderer-constructed. It exposes only typed bootstrap/status and admitted
business calls. The SDK cannot accept or return a Runtime endpoint, project
authorization, launch correlation, process binding, session id/proof, Runtime
epoch, credential, token, capability fingerprint, or trust-class override.
The native host performs request-empty `OpenLocalAppSession` only after the
single-use launch lease has been consumed by the exact process bind; the SDK
receives neither that bootstrap operation nor any of its authority inputs.

Technical-session rotation and controlled host/Runtime restart are transparent
behind the typed transport. The native host alone performs request-empty
`RenewLocalAppSession` on the current verified `local_app_host` connection;
the SDK and renderer cannot invoke it or observe its private material. A
revoked, expired, project-changed,
account-changed, untrusted-host, or unavailable carrier produces a stable typed
failure before a business call. Session material never enters renderer IPC,
application state, telemetry, errors, or retry callbacks.

Local-development transport does not widen the Runtime method set. Its exact
positive business surface is public permission posture/request and app-private
JSON read/write/remove. App-private storage is a base entitlement and succeeds
for a live principal/session/account partition without a user permission.
Every public permission is currently reserved, so posture/request returns typed
`unavailable`; it does not manufacture an owner decision.

Artifact, Agent, conversation, voice, account-control, lifecycle mutation,
Realm, broad AI, realtime, media, admin, memory and generic Runtime forwarding
are absent from the third-party local-app carrier until their complete public
permission or first-party service slice is admitted. App-native SQLite, media,
settings, routes and exact product commands remain outside this SDK permission
surface. Missing operation families remain typed unavailable. Ordinary
Electron/Tauri IPC and localhost gRPC cannot claim this transport type.

## S-TRANSPORT-015 Desktop-Supervised Bundled Avatar Carrier

The `nimi.avatar` Electron SDK transport is injected by the verified Desktop
host and exposes only the generated `bundled_avatar_v1` Runtime profile. SDK
callers use the ordinary generated typed clients, but cannot select the fixed
app id, profile marker, origin role, endpoint, metadata, capability, account,
or transport implementation. `RegisterApp`, `OpenSession`, `GetAccessToken`,
bearer injection, scoped binding bootstrap, public gRPC fallback and renderer
auth truth are absent.

Account snapshot/events, the admitted Realm unary, Runtime Agent/voice/lipsync,
generated voice artifact reads and bounded scenario jobs preserve their normal
typed SDK semantics. Carrier loss is Runtime unavailable; Realm transport
failure alone is Cloud offline. Reauthentication, permission, validation,
contract and rate-limit failures retain their owner-specific classifications.
Streams close explicitly and the app reopens them after a new verified host
connection; the SDK does not manufacture replay or durable authority.

## S-TRANSPORT-011 背压投影

SDK 在流消费速度不足时必须将背压关闭转化为可判定的错误（`K-STREAM-011`）：

- server 端因慢消费者触发的 `RESOURCE_EXHAUSTED` 必须投影为 `NimiError`。
- SDK 不得静默累积无限缓冲——当 transport 层反馈背压信号时，SDK 必须向消费者传递压力或中止流。

## S-TRANSPORT-012 慢消费者关闭投影

慢消费者触发的流关闭必须投影为稳定错误形态（`K-STREAM-012`）：

- SDK 不得将背压关闭误报为正常完成（`done=true` + 正常 reason）。
- 关闭原因必须以 `NimiError` 形态投影，`reasonCode` 反映背压根因。

## S-TRANSPORT-013 Resume/Retry 边界

按流类型显式分类自动重试策略（`K-STREAM-013`）：

- **订阅型流（Mode D）**：恢复由调用方显式主导。SDK 可以发出 `runtime.disconnected` 等恢复信号，但不得在后台自动重建订阅或重放消费者状态。
- **执行型流（Mode A）**：由调用方决策是否重试，SDK 不得自动重放。
- SDK 自动重试仅限 unary/短生命周期读取调用；流式订阅与执行型流都必须由上层显式重建或重放。

---

<!-- source: .nimi/spec/sdks/kernel/error-projection.md -->

# SDK Error Projection Contract

> Owner Domain: `S-ERROR-*`

## S-ERROR-001 双层错误投影

SDK 错误投影分两层：

- 上游运行时错误（gRPC/HTTP + reason_code）
- SDK 本地错误（参数校验、环境、边界违规）

## S-ERROR-002 ReasonCode 事实源

Runtime 相关 ReasonCode 以 `config/runtime-reason-codes.yaml` 为权威。
SDK 文档不得重新分配 Runtime ReasonCode 数值。

执行命令：

- `pnpm check:reason-code-constants`

## S-ERROR-003 SDK 本地错误码事实源

SDK 本地错误码唯一事实源为 `tables/sdk-error-codes.yaml`。

Simulator control errors remain owned by
`.nimi/spec/platform/simulator.authority.yaml` and are not SDK
local error codes or Runtime ReasonCodes. `SIMULATOR_*` names must not be added
to `sdk-error-codes.yaml`, exposed by a production SDK client, or leak through
the host-neutral facade.

## S-ERROR-004 重试语义

重试语义必须与底层 transport code 协同：

- `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `RESOURCE_EXHAUSTED` / `ABORTED`（其中 `ABORTED` 受 ReasonCode 优先级约束，见下文）可标记为 retryable
- 流中断不做自动重连

ReasonCode 优先级：当 ReasonCode 为 `OPERATION_ABORTED`（SDK 合成码，不在 runtime reason-codes.yaml 中）时，即使 transport code 为 `ABORTED`，也不可重试（S-ERROR-008 优先）。
ReasonCode 级 retryable 判定优先于 transport code 级判定。

## S-ERROR-005 Realm 本地配置错误投影

Realm SDK 的本地配置错误（实例参数校验、请求引擎配置非法）必须使用 `SDK_REALM_*` family。
具体 code 名称以 `tables/sdk-error-codes.yaml` 为权威，不在 domain 文档重复枚举。

## S-ERROR-006 版本与方法兼容错误投影

SDK 在版本协商或方法可用性检查阶段触发的本地错误必须使用 `SDK_RUNTIME_*` 本地错误码：

- 版本不兼容（如 major 断裂）必须返回显式不兼容错误码。
- 方法在目标 runtime 不可用时必须返回显式方法不可用错误码。
- 不允许将上述兼容性错误降级为通用网络错误或空成功响应。

## S-ERROR-007 应用层 Retryable ReasonCode

公开 `isRetryableReasonCode()` 函数标记面向上层消费者（如 ai-provider）的
可重试应用级 ReasonCode。此集合与 S-ERROR-004 的 transport 级 retryable 是互补关系，不重叠。

retryable 集合分两类来源：

Runtime ReasonCode（权威源：`config/runtime-reason-codes.yaml`）：

- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_PROVIDER_RATE_LIMITED`
- `AI_STREAM_BROKEN`
- `SESSION_EXPIRED`

`AI_LOCAL_SPEECH_*` bundle reason family 默认不进入 `isRetryableReasonCode()`
集合：

- 这些码表达的是 explicit download gating、preflight block、bundle init
  failure 或 degraded repair truth，而不是通用网络瞬态故障。
- SDK 不得把 `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED` 视为可自动重试；
  它要求上层显式用户动作。
- 若 runtime 额外给出 `retryable=true` metadata，上层可以在 UI 上提供
  retry/repair affordance，但 SDK 的默认公开 retryable 集合仍不收录这些码。

SDK 合成 ReasonCode（SDK 本地生成，不在 runtime reason-codes.yaml 中）：

- `RUNTIME_UNAVAILABLE`
- `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`

## S-ERROR-008 Runtime 内部连接恢复重试

Runtime 内部 transparent retry（auto 连接模式）使用独立 retryable 集合，
包含 SDK transport 错误码（`SDK_RUNTIME_NODE_GRPC_UNARY_FAILED` 等）。
此集合仅用于内部连接恢复，不暴露为公开 API。
`OPERATION_ABORTED` 永不重试。

## S-ERROR-009 非错误终端原因投影

Runtime 响应可携带 `reason_code` 且 gRPC 状态为 `OK`，属于非错误终端原因：

- SDK 必须将这些投射为响应元数据或 `finishReason` 字段，不可作为抛出错误。
- 非错误终端原因集合由 `config/spec-frozen/runtime/tables/error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 定义。
- 当前适用（完整集合，以 `error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 为权威）：`AI_FINISH_LENGTH`、`AI_FINISH_CONTENT_FILTER`。
- 特例：`test_connector` 表面的 `AI_CONNECTOR_CREDENTIAL_MISSING` 使用 `exit_shape: payload_ok_false`（gRPC OK + ok=false payload），SDK 不应将其视为异常。
- 双模退出形态：`exit_shape: grpc_status_or_payload_ok_false` 表示同一 ReasonCode 在不同 surface 可能以 gRPC 错误或 `ok=false` payload 返回（当前适用：`AI_LOCAL_MODEL_PROFILE_MISSING`、`AI_LOCAL_MODEL_UNAVAILABLE`，surface 为 `local_consume_or_probe`）。SDK 须对两种退出形态等价处理：gRPC 错误路径按常规错误投影，`ok=false` payload 路径按非异常结果投影。
- `AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED`、
  `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED`、
  `AI_LOCAL_SPEECH_BUNDLE_DEGRADED` 也属于同类双模退出形态：probe/readiness
  路径可表现为 `ok=false` payload，真实 consume/setup 路径表现为 gRPC 错误。
  SDK 必须保留原始 Runtime `reasonCode`，不得把它们降级为 generic local
  model unavailable。

## S-ERROR-010 SDK 合成 ReasonCode 治理

SDK 在特定场景合成不在 `reason-codes.yaml` 中的 ReasonCode：

- 合成码必须在 `tables/sdk-error-codes.yaml` 的 `SDK_SYNTHETIC_REASON` family 中注册。
- 当前合成码：`OPERATION_ABORTED`、`RUNTIME_UNAVAILABLE`、`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`。
- 合成码与 runtime ReasonCode 共享 `isRetryableReasonCode()` 语义空间（`S-ERROR-007`）。

The Simulator harness must map declared simulated outcomes to the same
host-neutral public result or `NimiError` shape that canonical UI handles in
production. It must not synthesize a `SIMULATOR_*` ReasonCode, place a raw
Simulator code in `code`, `reasonCode`, `message`, or `details`, or expand the
retryable set. Qualification, lifecycle, module, and session-integrity failures
remain Simulator Shell errors and never enter the App-facing SDK facade.

## S-ERROR-011 ExternalPrincipal 不可重试 ReasonCode

`AUTH_TOKEN_EXPIRED` 和 `AUTH_UNSUPPORTED_PROOF_TYPE`（来源：`K-AUTHSVC-013`）为 ExternalPrincipal 场景的细分错误码，均为不可重试 ReasonCode：

- `AUTH_TOKEN_EXPIRED`：ExternalPrincipal proof JWT 已过期，需应用层重新签发 proof。
- `AUTH_UNSUPPORTED_PROOF_TYPE`：不支持的 proof_type，需应用层修正注册参数。

两者均不进入 `isRetryableReasonCode()` 集合（`S-ERROR-007`），自动重试无法修复根因。

`AUTH_REVOCATION_UNAVAILABLE`（来源：`K-AUTHN-006`）表示会话撤销内省临时不可判定，必须进入 `isRetryableReasonCode()` 集合，并保持为 unavailable/retryable 投影；SDK 不得将其归类为 reauth 或 token invalid。

## S-ERROR-012 Mode D 流 CANCELLED 语义

Mode D 长生命周期订阅流（`K-STREAM-010`）在 daemon 进入 STOPPING 时以 gRPC `CANCELLED` 关闭。`CANCELLED` 不在 S-ERROR-004 的 retryable transport codes 中，SDK 处理规则：

- 收到 `CANCELLED` 时，SDK 发射 `runtime.disconnected` 事件（`S-RUNTIME-028`），不自动重连（`S-TRANSPORT-003`）。
- SDK 不将 `CANCELLED` 视为可重试错误——daemon STOPPING 是有意关闭，盲重试会持续失败直到 daemon 恢复。
- 应用层（Desktop/Agent）可在检测到 daemon 恢复 `READY` 状态后手动重新订阅。Desktop 通过 `runtime_bridge_status`（`D-IPC-002`）轮询检测 daemon 恢复；独立 SDK 消费者通过 `runtime.connected` 事件或 `ready()` 重试检测恢复。
- `CANCELLED` 与 `UNAVAILABLE` 的语义区分：`UNAVAILABLE` 表示暂时不可达（网络问题），可立即重试；`CANCELLED` 表示被服务端有意取消（daemon 关闭），需等待服务恢复后重建。

**跨层引用**：`K-STREAM-010`（Mode D 流协议）、`K-DAEMON-003`（STOPPING 状态）、`S-TRANSPORT-003`（禁止隐式重连）。

## S-ERROR-013 SDK 结构化归一化优先级

SDK（`asNimiError` 与 transport 适配层）必须按固定优先级归一化错误，避免结构化字段丢失：

1. 已是 `NimiError`：原样保留。
2. 结构化 JSON：优先解析 `details` 或 `message` 中可解析对象（支持嵌入 JSON）。
3. `CODE:` 前缀：提取前缀作为 `reasonCode`。
4. transport fallback：按 gRPC/HTTP 状态映射默认 `reasonCode`。
5. 最终兜底：使用 SDK 默认码（例如 `RUNTIME_CALL_FAILED` 家族）。

归一化过程不得覆盖上游已有的 `reasonCode/actionHint/traceId/retryable`。

## S-ERROR-014 Transport 投影一致性

`node-grpc` 与 `tauri-ipc` transport 必须对同一上游失败输出等价的 `NimiError` 形状：

- 字段一致：`reasonCode`、`actionHint`、`traceId`、`retryable`
- ReasonCode 提取一致：优先结构化 payload，其次 `CODE:` 前缀，其后状态映射
- 不允许一个 transport 保留结构化字段而另一个退化为纯字符串错误

## S-ERROR-015 NimiError 最小形状契约

`NimiError` 类型必须携带以下最小结构化字段（与 `K-ERR-009` 对齐）：

必填字段：
- `reasonCode: string` — 业务级错误码（来自 `reason-codes.yaml` 或 SDK 合成码）
- `message: string` — 人类可读错误描述
- `code: string` — SDK 统一错误码字段；默认与 `reasonCode` 对齐，必要时可承载 transport 派生码

可选结构化字段：
- `actionHint?: string` — 建议消费者的修复动作
- `traceId?: string` — 调用链追踪标识
- `retryable?: boolean` — 是否可安全重试
- `details?: Record<string, unknown>` — transport-safe 的结构化失败细节；当上游来自 `ScenarioJob` 终态失败时，SDK 必须保留 runtime 投影下来的 `reason_metadata`

对 `AI_LOCAL_SPEECH_*` family，SDK 必须尽可能保留 runtime 传下来的
capability / bundle slice / repair hint metadata；上层不得依赖 message 自由文本
去猜测失败属于 `STT`、`TTS` 或 workflow slice。

S-ERROR-013/014 引用的字段稳定性保证在此正式升级为类型契约：任何 `NimiError` 实例必须满足上述最小形状，归一化过程不得产出缺失必填字段的实例。

For an injected deterministic harness, `NimiError` has exactly this same
minimum shape and contains only public SDK/Runtime/Realm reason semantics that
the simulated operation declares. Simulator module/instance/epoch/operation
identifiers and raw `SIMULATOR_*` errors are forbidden in `details`.

## S-ERROR-016 Async ScenarioJob Failure Detail Projection

SDK 在轮询 `GetScenarioJob` 并遇到终态失败（`FAILED` / `CANCELED` / `TIMEOUT`）时，必须：

- 保留 `reasonCode` 的符号名；若 transport 给出的是 numeric enum，也必须还原为稳定字符串名
- 使用 `reasonDetail` 作为短 message，但不得丢弃 `reason_metadata`
- 将 runtime `ScenarioJob.reason_metadata` 原样投影到 `NimiError.details`

SDK 不得要求上层通过解析 `reasonDetail` 自由文本来恢复失败细节。

---

<!-- source: .nimi/spec/sdks/kernel/boundary-contract.md -->

# SDK Boundary Contract

> Owner Domain: `S-BOUNDARY-*`

## S-BOUNDARY-001 子路径导入边界

各 SDK 子路径禁止跨域私有实现导入，所有跨域依赖必须通过公开导出面完成。
`S-BOUNDARY-001` 是所有 surface 的基线规则，可与特化规则叠加绑定。

## S-BOUNDARY-002 Runtime/Realm 边界

SDK 内部禁止将 runtime transport 与 realm REST client 混合为单一私有入口；必须维持显式边界。

## S-BOUNDARY-004 SDK Root Entry Contract

SDK 根入口必须固定为 owner-approved vNext composition surface：

- `createNimiClient`
- `NimiClient`
- `NimiClientConfig`

禁止出现 retired platform-client / singleton 入口：

- 全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值
- `createPlatformClient`
- `createLocalFirstPartyRuntimePlatformClient`
- `getPlatformClient`
- `clearPlatformClient`

## S-BOUNDARY-005 Developer Ergonomics Is Not Truth Ownership

SDK boundary reviews must distinguish developer ergonomics from authority
ownership.

`MUST`：SDK may add helper APIs when the helper is a typed projection,
composition layer, adapter, parser, builder, stream assembler, or explicit
test/development harness over admitted public surfaces.

The existing public `@nimiplatform/sdk/testing` subpath may expose a
deterministic in-process harness for the `P-SIM-*` host-neutral facade. That
harness derives request, response, stream, abort, and `NimiError` shapes from
the same public SDK types used by production consumers. It is a typed local
execution adapter only: it cannot create a transport, endpoint, credential,
principal, account, permission, Runtime/Realm record, Simulator State Engine,
or alternate product method contract.

`MUST NOT`：SDK helper placement must not be rejected solely because the helper
performs client-side coordination. It must be rejected when it owns or infers
canonical Runtime / Realm / Cognition / Platform truth, bypasses admitted
transport, hides fail-closed states, or creates a second provider/model,
session, memory, event, or permission authority.

## S-BOUNDARY-006 Client Orchestration Promotion Rule

Client orchestration that outgrows ephemeral consumer coordination must be
promoted to the owning authority before it becomes product truth.

Promotion is required when a helper:

- persists data across process or app-session boundaries
- controls provider/model routing or fallback policy
- writes or mutates canonical memory, knowledge, agent state, app lifecycle, or
  Realm domain records
- emits events that consumers treat as Runtime / Realm / Cognition audit or
  lifecycle truth
- requires cross-app, cross-device, permissioned, or account-scoped
  enforcement

Until promoted, the helper must remain documented as non-authoritative,
ephemeral, and caller-owned. If a product needs the helper's result as durable
truth, the SDK must submit that result through an admitted typed Runtime /
Realm / Cognition operation instead of persisting it locally.

Simulator deterministic presentation state is explicitly non-authoritative
and session-ephemeral under `P-SIM-010`. SDK may project typed calls against
that state only through the injected testing harness. Cross-App ordering,
scenario state, logical time, replay, fixtures, and reset remain Simulator/App
contract concerns and cannot be promoted into SDK client orchestration.

## S-BOUNDARY-007 Agent Lifecycle Chat vs App AI Session Loop

Boundary reviews must distinguish Runtime Agent lifecycle chat from ordinary app
AI session loops.

Runtime Agent lifecycle chat is not a generic SDK client loop. It belongs to
Runtime when the behavior depends on any of:

- agent lifecycle, identity, state, autonomy, hooks, or presentation posture
- Runtime-owned `ConversationAnchor`
- Runtime Agent memory policy or canonical memory admission
- Runtime Agent turn planning, action existence, APML / message-action
  validation, voice/media workflow execution, or agent event emission
- `runtime.agent` app-message seam or `RuntimeAgentService` projection truth

Ordinary app AI session loops are not Runtime-owned merely because they use an
LLM, stream tokens, keep conversation history, call tools, or expose a chat UI.
They may use SDK DX primitives under `S-SURFACE-020` and Runtime AI consume
surfaces, while the durable product session truth remains with the app or Realm
unless a separate Runtime / Cognition / Platform authority rule admits it.

SDK helpers must therefore be rejected only when they become a hidden authority,
not when they coordinate an ephemeral AI turn. Conversely, Runtime placement
must be rejected for ordinary product chat history unless the session is tied to
Runtime Agent lifecycle or another explicit Runtime authority domain.

For Runtime Agent lifecycle chat, SDK may correlate and render the bounded
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projections. SDK
must not assemble LocalAgent prompts, attach source/world/memory/context, or
turn either summary back into provider-visible content; Runtime owns that
composition. Ordinary Nimi Chat and ordinary app AI loops retain their existing
caller/app prompt authority and are not narrowed by the LocalAgent context cut.

- AUTHORITY-RELATION subject=ordinary-nimi-chat action=preserve object=prompt-authority value=unchanged polarity=require
- AUTHORITY-RELATION subject=sdk action=assemble object=localagent-prompts value=denied polarity=forbid

Runtime Agent lifecycle chat may still have SDK developer-experience helpers
over public Runtime Agent surfaces. Under `S-SURFACE-021`, SDK can own
request-id correlation, public consume-event stream assembly, abort-to-interrupt
wiring, and terminal snapshot recovery as non-authoritative client
orchestration. Those helpers are allowed only because Runtime remains the
authority for agent execution, memory policy, turn planning, terminal evidence,
and app-message projection truth.

Runtime scenario jobs may also have SDK developer-experience helpers over public
Runtime job surfaces. Under `S-SURFACE-022`, SDK can own
submit/subscribe/get/getArtifacts consumer orchestration for `runtime.media`
jobs, low-level submit/get/cancel/artifact consumer orchestration for
`runtime.ai` scenario jobs used by SDK provider/framework adapters, fallback
polling when a public job stream ends before terminal evidence, abort-to-cancel
wiring, and typed fixture transports. Those helpers are allowed only because
Runtime remains the authority for scenario job lifecycle, provider/model
routing, execution, readiness, artifacts, reason codes, audit, and fail-closed
enforcement. SDK must fail closed unless Runtime reports `COMPLETED` before
artifacts are treated as a successful scenario result.

---

<!-- source: .nimi/spec/sdks/kernel/scope-contract.md -->

# SDK Scope Contract

> Owner Domain: `S-SCOPE-*`

## S-SCOPE-001 Catalog Surface

scope 子路径最小稳定面是 in-memory catalog 的 publish/revoke/query。

## S-SCOPE-002 Authorization Boundary

scope 仅表达授权前置数据，不定义服务端授权执行规则。

## S-SCOPE-003 Transport Consistency

scope 的订阅/重建行为遵循 transport 合同，不得隐式重连。

## S-SCOPE-004 Error Family

scope 本地错误必须统一投影到 sdk-error-codes 受控 family。

## S-SCOPE-005 Cross-Package Boundary

scope 实现不得跨包调用 runtime/realm 私有客户端。
