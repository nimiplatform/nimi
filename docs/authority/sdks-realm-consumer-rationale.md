# SDKs Realm Consumer - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/sdks/realm-consumer.authority.yaml`。

---

<!-- source: .nimi/spec/sdks/kernel/realm-api-consumer-contract.md -->

# SDK Realm API Consumer Contract

> Owner Domain: `S-REALMAPI-*`

## Scope

Nimi consumes Realm as an external API authority identified by the external Realm authority.
This contract governs SDK, Runtime, Desktop, Web, and app consumption of Realm
API projections. It does not define Realm server truth, Realm domain semantics,
or Realm product authority.

Realm canonical authority lives outside this repository. The nested
`.nimi/spec/realm/**` subtree is an external pointer only and must not contain
Realm kernel contracts, tables, generated docs, or domain authority mirrors.

## S-REALMAPI-001 External Authority Boundary

`MUST`: Realm domain authority is external to Nimi and is identified as
the external Realm authority.

`MUST NOT`: Nimi specs, SDK docs, Runtime, Desktop, Web, or apps must not
re-declare Realm server/domain rules as local authority.

Nimi-owned contracts may reference Realm only as an external dependency, a
generated API input, or a consumer projection boundary.

## S-REALMAPI-002 Generated API Is The Consumer Floor

`MUST`: Stable Realm API consumption must start from a generated Realm carrier
sourced from the configured Realm OpenAPI input. Public SDK consumption starts
from the generated Realm SDK core. Runtime must not import `sdks/**`; its
constructor-injected private `RealmMaterializationIssuer` therefore starts from
the sibling generated Runtime-private carrier under `runtime/gen/realm/v1`.
Both projections are emitted by the same SDK generator invocation from the same
OpenAPI input. The closed Runtime-operation inventory is owned by
`tables/realm-private-operation-carriers.yaml`. Each row independently declares
`runtime_projection` and `public_sdk_disposition`: Runtime generation never
implies removal from the Public SDK. Account-auth and authn operations are
generated for Runtime and retained in the Public Web SDK; source-materialization
packet/JWKS operations are generated for Runtime and forbidden in the Public
SDK. Runtime output is split into account-auth, authn, and
source-materialization files so no generated carrier becomes a mixed-domain
context sink.

`MUST NOT`: Consumers must not bypass generated Realm clients with app-local
REST helpers, hand-authored endpoint strings, global OpenAPI singleton
mutation, or duplicated response-shape declarations.

Handwritten SDK facades are allowed only when they wrap generated operations
with typed fail-closed behavior and do not restore a second Realm contract.

Source materialization uses only the generated current Realm Packet v3 and
`CharacterSourceRefV3` transport shapes. The generated operation families own
the authenticated first-party challenge, packet, ordered closure-set segment,
component, hash-graph, current-JWKS, and detached-proof shapes. Source
materialization has no app permission or grant carrier. SDK and apps must not
introduce a handwritten materialization DTO, anonymous source payload, fixed
audience, raw bundle DTO, or parallel packet decoder.

Runtime's account/auth clients and bounded streaming verifier may own
Runtime-private semantic
validation state, canonical hashing, cryptographic verification, capacity
accounting, and atomic-commit projections. Those are enforcement semantics,
not a second Realm transport contract. It must consume generated operation and
request/response carriers, and generated OpenAPI closure metadata must gate
every accepted response field family. Runtime must not hand-author a Realm
path, request DTO, alternate response field, compatibility decoder, or public
packet adapter. OAuth form requests and JSON requests retain their generated
content type; a generator that silently treats a declared request as unknown
fails closed.

## S-REALMAPI-003 SDK Owns Consumer Semantics Only

SDK may own:

- endpoint/token instance isolation
- request transport configuration
- typed error projection
- retry and refresh orchestration
- generated client composition
- consumer availability and fail-closed states
- current small Realm readiness and source-record reads
- high-level authenticated Runtime `MaterializeRealmSource` intent carrying
  only `CharacterSourceRefV3` and `requestId`

SDK must not own:

- Realm canonical records or lifecycle truth
- Realm auth/session issuance semantics
- Realm social/chat/economy/domain invariants
- Realm OpenAPI source authority
- server compatibility promises outside the generated API input
- source-materialization packet, audience, proof, manifest, component, or
  world-closure shape semantics

## S-REALMAPI-004 Runtime/Desktop Projection Boundary

Runtime and Desktop may consume Realm projections through SDK-owned typed
facades, but local Runtime/Desktop state must not become Realm canonical truth.

When a local projection cannot be reconciled with Realm API output, the
consumer must fail closed or expose an explicit unavailable/error projection.
It must not synthesize Realm success.

Desktop, Kit, and Web submit only `CharacterSourceRefV3` and `requestId` to the
high-level authenticated Runtime `MaterializeRealmSource` operation. Runtime
internally resolves the current account, canonical Realm base, bearer, fresh
challenge, Packet v3 response, and current JWKS. Realm applies its first-party
source visibility/readiness policy directly; there is no app grant. No app-facing
facade may receive or persist packet/proof/segment/component bytes, choose an
audience, decode closure truth into app-owned records, or accept an unknown
schema, field, enum, segment kind, limit, or hash branch as local success.

## S-REALMAPI-005 Version Drift Handling

`MUST`: Realm API drift is handled by regenerating the SDK core from the
configured Realm OpenAPI input and updating SDK consumer contracts/tests.

`MUST NOT`: Nimi must not patch drift by copying Realm spec text into
`.nimi/spec/realm/**`, freezing stale DTOs in handwritten clients, or adding
compatibility aliases that hide server contract changes.

An unknown Packet v3/challenge schema, field, enum, proof family, component or
segment kind, limit, hash edge, or closure branch is version drift and fails
closed until the configured Realm OpenAPI input is regenerated. Handwritten
compatibility readers are forbidden.

## S-REALMAPI-006 Pointer-Only Realm Subtree

The only admitted files under `.nimi/spec/realm/**` are pointer/navigation
files that identify the external Realm authority and route readers to SDK consumer contracts.

Forbidden under `.nimi/spec/realm/**`:

- `kernel/**`
- `kernel/tables/**`
- generated Realm docs
- Realm domain guides that restate product rules
- delegated projection mirrors from the external Realm authority

## Traceability

- `.nimi/spec/sdks/kernel/realm-core-contract.md`
- `.nimi/spec/sdks/kernel/tables/realm-private-operation-carriers.yaml`
- `.nimi/spec/sdks/kernel/realm-contract.md`
- `.nimi/spec/sdks/kernel/boundary-contract.md`
- `sdks/typescript/core-generated/realm-client.ts`
- `sdks/typescript/core-generated/realm-typed-client.ts`


---

<!-- source: .nimi/spec/sdks/kernel/realm-contract.md -->

# SDK Realm Contract

> Owner Domain: `S-REALM-*`
>
> **Authority Disposition**：
> 本契约被分为两种显式 mode：
>
> - **Local Runtime app modes**：no generic authenticated Realm transport is
>   admitted. Any local Realm access must use an exact Runtime-mediated
>   protected operation after its operation row and caller carrier are
>   independently admitted. All local modes prohibit app/host/SDK
>   bearer, token/refresh provider, session store, JWT subject decode,
>   `MeService.getMe` account truth, Realm login route and SDK-owned 401 refresh.
>   Public token/refresh and credential-grant families are removed and their
>   identities reserved.
> - **Web / cloud adapter 与 external-principal mode**：可保留本契约的 app-provided token / subject / Realm route seams，但必须显式 fenced。
>
> Local account / login / refresh-token custody 与 Realm mediation 真相由
> `RuntimeAccountService`（`K-ACCSVC-*`）拥有；SDK 投影由
> `S-RUNTIME-109` / `S-RUNTIME-110` 约束。
>
> Web / cloud adapter mode 必须显式声明 mode 标记，且与 local first-party Runtime mode 在公共 surface 上严格 fenced；不得在 local first-party 消费者中可达。
>
> `realm-api-consumer-contract.md` owns the external Realm consumer
> boundary. This file may constrain SDK facade behavior, but it must not
> restate Realm server/domain authority or rely on `.nimi/spec/realm/**` as a
> mirrored source of truth.

## S-REALM-010 Instance Isolation

Realm SDK 入口固定为实例化 facade；endpoint/token/header 必须实例级隔离。

## S-REALM-011 Request Engine Boundary

Realm 请求引擎配置只能在实例作用域生效，不得写入全局 OpenAPI 运行态。

## S-REALM-012 Endpoint/Token Validation

endpoint 或 token 缺失时必须 fail-close（NO_AUTH 显式模式除外）。

## S-REALM-013 Refresh Strategy Declaration

auth 刷新策略必须显式声明，不允许隐式后台刷新状态。

## S-REALM-014 Default Refresh Policy

未配置 refreshToken 回调时不进行自动刷新，401 直接进入错误投影。

## S-REALM-015 Auth Retry Guard

认证失败重试最多一次，且必须可观测。

## S-REALM-019 ready() Fail-Close Semantics

Realm `ready()` 探测失败必须 fail-close 并抛出错误，不得再以事件遥测替代可用性判断。

## S-REALM-027 AccessToken Function Mode

`accessToken` 支持函数模式以承载调用方手动刷新。

## S-REALM-028 401 Refresh Flow

配置 refreshToken 后，SDK 在 401 时触发 refresh 并单次重试原请求。

## S-REALM-029 Single-Flight Refresh

并发 401 必须合并为单 flight refresh，避免刷新风暴。

## S-REALM-031 Auth Error Projection Integrity

401/403/429/5xx 语义不得伪装为成功响应。

## S-REALM-035 Realtime Governance Boundary

**Authority disposition:** Blocked detailed authority conflict. Realtime protocol and dependency details are conflict evidence only and are not independently admitted for implementation; Runtime realtime authority requires a separate admission under `S-REALM-040`.

实时传输具体协议细节由后端与客户端实现定义，SDK 合同只约束认证、状态事件与重连边界。

## S-REALM-036 Reconnect Delivery Guarantee

**Authority disposition:** Blocked detailed authority conflict. Reconnect, delivery, and replay details are conflict evidence only and are not independently admitted for implementation; compatibility evidence must precede a separate Runtime replay admission under `S-REALM-040`.

重连策略实现可变，但不得静默丢失已确认投递事件。

## S-REALM-037 Event Name Ownership

**Authority disposition:** Blocked detailed authority conflict. Realtime event-vocabulary details are conflict evidence only and are not independently admitted for implementation; exact event ownership requires a separate Runtime admission under `S-REALM-040`.

SDK 不维护实时事件名权威枚举，事件名以后端协议为准。

## S-REALM-038 Unauthenticated Decision Routing

Realm SDK 允许在 `accessToken` 为空时调用以下公开决策端点，返回类型化路由判定：

- `AuthService.checkEmail` → `CheckEmailEntryRoute`（register_with_otp / login_with_otp / login_with_password）
- `AuthService.requestEmailOtp` / `verifyEmailOtp` / `passwordLogin` — 认证端点本身不需要前置 token

此为 S-REALM-012 所述 "NO_AUTH 显式模式" 的正式边界。除上述端点外，`accessToken` 缺失时的所有其他 Realm 调用仍必须 fail-close。

## S-REALM-039 No Local Realm Authority Mirror

Realm facade behavior must be derived from generated Realm core, explicit SDK
consumer contracts, and runtime/client mode configuration. SDK must not consult
or recreate `.nimi/spec/realm/**` as Realm server authority inside this
repository.

## S-REALM-040 Runtime-Mediated Local App Default

**Owner-only authority allocation.** SDK owns typed Realm APIs and trusted carriers only. Runtime remains the sole owner of every authenticated Realm data plane, including bearer injection, private refresh, unary mediation, realtime connection authority, and media credential exchange. SDK and app inputs cannot turn an app id, endpoint, token callback, event name, or generated descriptor into authorization or canonical data-plane truth.

The realtime protocol, dependency, delivery, and replay details recorded by `S-REALM-035` through `S-REALM-037` remain blocked authority conflicts until Runtime admits the corresponding realtime authority. Runtime compatibility evidence must precede any replay posture; client caches, outboxes, event shapes, or reconnect success cannot establish replay guarantees. SDK media helpers likewise remain carrier-only until Runtime admits exact media states, limits, credential custody, and failure behavior.

`createRuntimeAccountMediatedRealmTransport` is a reserved typed constructor,
not a generic data-path admission. It returns protected-unavailable for every app
composition until the exact Runtime operation policy and caller carrier are
admitted. When enabled by a later authority batch, it may send only typed
operation ids on that verified carrier and can never accept/expose
`accessToken`, `refreshToken`, authorization headers, Realm base truth, session
persistence, refresh callbacks, public grants, or caller-selected origin.
Installed/developer/first-party facades must not export token wrappers or
`createRealmWithRuntimeAccountToken`.


---

<!-- source: .nimi/spec/sdks/kernel/realm-core-contract.md -->

# SDKS Realm Core Contract

Status: active product authority.

## S-REALMCORE-001 Realm Generated Core Source

Realm generated core under `sdks/**/core-generated` is sourced from the
configured Realm OpenAPI input from the external Realm authority.
`.nimi/spec/sdks/**` owns the SDK-family projection boundary; old `sdk/`
facade contracts and `.nimi/spec/realm/**` mirrors must not be used as
generated Realm authority.

Nimi admits exactly two generated projections from that input: the public SDK
core under `sdks/**/core-generated` (or the language-equivalent directory), and
the Runtime-private carrier under `runtime/gen/realm/v1` required because the
Runtime import boundary forbids importing `sdks/**`. The same generator run
must emit and drift-check both projections. There is no third projection.

Together these generated carriers own the Nimi wire-shape projection for the
current Realm `CharacterSourceRefV3`, Packet v3 closure set, eight packet
limits, authenticated first-party challenges, current JWKS, ordered segments,
hash graph, and detached-proof carriers. Packet issuance and current-JWKS acquisition are consumed only by
Runtime's private `RealmMaterializationIssuer`, according to
`tables/realm-private-operation-carriers.yaml`; no handwritten core, facade,
app, or public Runtime adapter may own a parallel materialization request DTO
or transport path. Runtime-private streaming verification state remains
Runtime enforcement semantics and must stay generated-field-closure-gated as
required by `S-REALMAPI-002`.

## S-REALMCORE-002 Realm Facade Boundary

TypeScript may expose a handwritten Realm facade over generated Realm core.
The facade must fail closed on malformed operation boundaries and must not
restore global OpenAPI singleton configuration.

The facade may validate, route, retry, and correlate current small Realm reads.
It must not expose packet issuance, challenge, bearer, grant selection, raw
packet/proof/segment/component bytes, or Packet v3 decoding to SDK, Kit,
Desktop, or Web callers. Those callers submit only `CharacterSourceRefV3` and
`requestId` through the authenticated Runtime `MaterializeRealmSource` facade;
Runtime alone acquires and verifies the generated Packet v3 transport.

The generated language manifests prove schema/operation shape convergence.
They do not by themselves prove that every language exposes or can execute
every operation. Runtime-private operations must not be projected as public SDK
methods; language behavior claims require an executable conformance path that
returns normally or a typed error, never `panic`, trap, or process abort.


---

<!-- source: .nimi/spec/sdks/kernel/world-contract.md -->

# SDK World Contract

> Owner Domain: `S-WORLD-*`

## Scope

This contract defines the SDK kernel authority home for the app-facing
`sdk/world` facade.
It owns the public world-domain family boundary, the world-input projection
boundary, the fixture package boundary, the renderer orchestration boundary,
and the world-session composition boundary.
It does not redefine Realm canonical truth semantics, Runtime provider
execution semantics, renderer-driver implementation semantics, or branch-local
simulation semantics.

## S-WORLD-001 Public Facade Ownership Boundary

`sdk/world` is the SDK kernel authority home for the app-facing world-domain
facade.

It owns only:

- the public world-domain family boundary
- the world-input projection boundary
- the fixture package boundary
- the renderer orchestration vs driver boundary
- the world-session composition boundary

It does not own:

- Realm canonical truth semantics
- Runtime provider execution semantics
- renderer-driver implementation semantics
- branch-local simulation semantics

## S-WORLD-002 Baseline Family Set

The baseline `sdk/world` family set is fixed to:

- `truth`
- `generate`
- `fixture`
- `render`
- `session`

All five families are admitted in coarse-grained form.

## S-WORLD-003 World-Input Projection Boundary

Provider-bound world-generation requests must pass through a world-domain
truth-to-world-input projection layer before final provider request shaping.

`sdk/world` must not expose provider-native payloads as the first public input
shape.

## S-WORLD-004 Fixture Package Boundary

Local materialized world output is represented publicly as a fixture package
rather than as raw provider payload.

Current-phase conversion semantics remain intentionally shallow and may remain
identity/pass-through where needed.

## S-WORLD-005 Renderer Orchestration Boundary

`sdk/world.render` owns renderer orchestration consume only.

It may expose:

- render plan
- initial coordinate or camera policy
- capability requirements
- fallback guidance

It must not expose:

- renderer-driver lifecycle
- window or canvas ownership
- GPU or runtime handles
- renderer-native config blobs as stable public truth

## S-WORLD-006 World Session Composition Boundary

`sdk/world.session` owns world-session composition semantics for the active
world experience.

It may compose:

- activity mode
- chat context
- agent context
- local session status

It does not transfer ownership of chat, agent, cognition, or renderer truth
into the world-domain facade.

## S-WORLD-007 Baseline Exclusions

The first `sdk/world` cut excludes:

- shared multi-user projection truth
- world simulation semantics
- provider-native request authoring
- renderer-driver APIs
- direct Realm mutation surfaces beyond existing authority homes
- cognition or authoring-workbench ownership


---

<!-- source: .nimi/spec/sdks/kernel/world-evolution-engine-consumer-contract.md -->

# SDK World Evolution Engine Consumer Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

This contract defines the controlled app consumer-facing API landing for the World Evolution Engine.
It owns only the downstream consumer seam that composes SDK projection-visible shapes into app-facing SDK facades.
It also defines the selector-read stable method contract for the approved read-only slice and the typed facade framing for the remaining non-stable families.
It does not redefine Runtime execution semantics, SDK projection semantics, host bridge concrete API, or implementation strategy.

Consumer rule map:

- `S-RUNTIME-085` defines the consumer API ownership boundary.
- `S-RUNTIME-086` defines the admissible consumer surface families.
- `S-RUNTIME-087` defines the read/observe surface boundary.
- `S-RUNTIME-088` defines the command/request surface boundary.
- `S-RUNTIME-089` defines the inadmissible affordance and leakage hardcut.
- `S-RUNTIME-090` defines the host/app boundary and no-implementation-assumption hardcut.
- `S-RUNTIME-092` defines the shared typed candidate building blocks.
- `S-RUNTIME-093` defines the admissible observe and selector-read candidate categories.
- `S-RUNTIME-094` defines the admissible request / result / rejection candidate categories.
- `S-RUNTIME-095` defines which candidates may advance to later implementation design and which remain below stable method-contract authority.
- `S-RUNTIME-096` defines candidate shapes that remain inadmissible.
- `S-RUNTIME-097` defines the shared selector-read stable semantic method-category matrix.
- `S-RUNTIME-098` defines the shared selector matrix.
- `S-RUNTIME-099` defines the shared read-result matrix.
- `S-RUNTIME-100` defines the shared read-only rejection matrix.
- `S-RUNTIME-101` defines shared semantic parity and publication layering requirements across app-facing selector-read methods.

## S-RUNTIME-085 Consumer API Ownership Boundary

The World Evolution Engine app consumer-facing API contract lands in SDK kernel as a downstream consumer seam contract.

Therefore:

- Runtime `K-WEV-*` remains the semantic owner for execution events, replay, checkpoint, supervision, effect-stage ordering, and commit-request staging semantics.
- `world-evolution-engine-projection-contract.md` remains the owner of normalized SDK projection-visible shapes.
- This consumer contract owns only how app-facing SDK facades may compose those already-visible shapes into stable consumer API families

This contract must not:

- redefine Runtime execution semantics
- redefine SDK projection-visible shape meaning
- introduce a second consumer semantic owner outside SDK kernel
- define host bridge concrete methods, transport bindings, or host implementation internals

## S-RUNTIME-086 Admissible Consumer Surface Families

The stable World Evolution Engine consumer surface is limited to two families:

- `read/observe` surface, including observe and selector-read candidate families
- `command/request` surface, including request / result / rejection candidate families

Both families must compose only SDK projection-visible shapes already admitted by `S-RUNTIME-079` through `S-RUNTIME-084`.

No stable third family is admissible for:

- workflow substrate truth ownership
- host-private control-plane ownership
- app-local shadow semantic ownership
- direct Runtime or Realm private client access

If a proposed consumer API shape cannot be described as one of the two families above using only projection-visible shapes, it is inadmissible.

## S-RUNTIME-087 Read / Observe Surface Boundary

World Evolution Engine read/observe surface is read-only and may expose only normalized consumer-visible projections composed from existing SDK projection-visible shapes.
Within that boundary, the only admissible candidate sub-families are observe and selector-read.

Allowed read/observe families are limited to:

- execution event envelope observation using the normalized `K-WEV-010` field set projected by `S-RUNTIME-080`
- kind-specific discriminated event detail that remains subordinate to the normalized envelope
- replay result or replay evidence-reference views already bounded by `S-RUNTIME-081`
- checkpoint identifier, checkpoint reference, or restore-status views that remain explicitly Runtime-local under `S-RUNTIME-081`
- supervision outcome views using the closed `CONTINUE | DEFER | ABORT | QUARANTINE` vocabulary
- commit-request candidate/result views only as adapter-bound read models already bounded by `S-RUNTIME-082`

Read/observe surface must not expose as stable consumer truth:

- scheduler internals
- queue internals
- workflow node or task progress internals
- raw checkpoint payload or restore substrate
- hidden re-inference state
- route migration or fallback migration internals

Missing required projection-visible fields or evidence references must fail-close.
Consumer read/observe surface must not reinterpret absence as implicit success, implicit recovery, or implicit completion.

## S-RUNTIME-088 Command / Request Surface Boundary

World Evolution Engine command/request surface may exist only as an explicit consumer-intent seam layered on top of SDK projection-visible identifiers, selectors, references, and result shapes.
Within that boundary, the only admissible candidate sub-families are request / result / rejection.

Allowed command/request framing is limited to requests that:

- accept only projection-visible identifiers, references, selectors, filters, or subscription parameters
- return explicit typed acknowledgment, result, or rejection shapes without inventing a second semantic vocabulary
- preserve Runtime-owned replay/checkpoint/supervision/commit-request meaning as observed through `S-RUNTIME-080` through `S-RUNTIME-082`

Command/request surface must not:

- accept workflow DAG, task, node, edge, or output-event identity as consumer control-plane truth
- accept raw commit envelopes, raw history-append payloads, or raw checkpoint state as stable consumer inputs
- expose direct commit authorization, direct history append, or direct canonical world-state mutation as consumer-owned success semantics
- add fallback, route migration, re-inference, or hidden recovery knobs that are not already projection-visible contract truth

This landing freezes the category boundary only.
It does not define a concrete method list, transport binding, host bridge shape, or lifecycle implementation.

## S-RUNTIME-089 Inadmissible Affordance And Leakage Hardcut

World Evolution Engine consumer-facing API must not widen or leak Runtime-local substrate into app stable truth.

The following are inadmissible consumer affordances:

- workflow DAG/task/node/output vocabulary as top-level consumer truth
- scheduler, queue, or worker-local control knobs
- `route_policy`, `fallback`, or equivalent recovery/migration controls
- runtime-private checkpoint substrate or supervision substrate
- consumer-authored semantic reinterpretation of missing evidence
- host-private singleton handles, app-private client handles, client handles
- direct authoring of canonical Realm mutation truth, canonical history truth, or canonical audit truth

Consumer API must not turn:

- a commit-request candidate into implied Realm mutation success
- replay evidence into permission for fresh inference or hybrid replay
- read-model absence into synthetic empty success
- Runtime-local execution evidence into Realm/shared canonical truth

## S-RUNTIME-090 Host / App Boundary And No-Implementation-Assumption Hardcut

App-facing World Evolution Engine consumer API may be published only through SDK public surface.

Both paths must preserve one composed contract:

- same projection-visible shape vocabulary
- same fail-close behavior
- same no-leak / no-widening / no-bypass hardcuts

Therefore consumer API must not:

- depend on `runtime/internal/**`
- depend on Realm private clients or private transport
- depend on SDK private internals
- depend on host bridge private methods, app-private state stores, bypass clients
- assume concrete subscription plumbing, buffering strategy, caching policy, or host lifecycle behavior as normative contract

Consumer surfaces that require those assumptions are outside the stable
consumer API.

## S-RUNTIME-092 Shared Typed Candidate Building Blocks

App-facing SDK facades host-injected facades must share one minimal typed candidate vocabulary.

That shared vocabulary is limited to:

- projection-visible envelope anchors and discriminators already admitted by `S-RUNTIME-080`
- projection-visible replay / checkpoint / supervision references and outcomes already admitted by `S-RUNTIME-081`
- projection-visible commit-request candidate / result fields already admitted by `S-RUNTIME-082`
- selector atoms composed only from those already-visible anchors, discriminators, identifiers, references, and adapter-bound candidate fields

Selector framing must remain projection-derived only.
It must not introduce a second semantic vocabulary for execution identity, canonical mutation truth, or workflow substrate identity.

Therefore shared typed building blocks must not require:

- workflow DAG / task / node / edge / output identifiers
- raw checkpoint payloads or restore substrate
- raw commit envelopes, history-append payloads, or audit records as consumer-authored inputs
- host-private handles, app-private handles, handles

## S-RUNTIME-093 Admissible Observe And Selector-Read Candidate Categories

The following consumer candidate categories may advance to later implementation design as read-only facades:

- ordered execution-event observation over the normalized envelope and subordinate discriminated detail
- selector-scoped event / evidence collection views composed from projection-visible anchors and references
- runtime-local replay / checkpoint / supervision views that stay explicitly bounded by `S-RUNTIME-081`
- adapter-bound commit-request candidate / result views that stay explicitly bounded by `S-RUNTIME-082`

All observe and selector-read categories must make the evidence class explicit.
They must distinguish runtime-local execution evidence, runtime-local recovery evidence, and adapter-bound commit-request views rather than collapsing them into one canonical-truth model.

They must not:

- imply shared present-state truth
- imply shared history truth
- expose raw workflow substrate or queue / scheduler substrate
- treat absence as implicit success, implicit completion, or implicit "no-op but valid" truth

## S-RUNTIME-094 Admissible Request / Result / Rejection Candidate Categories

The following request-side candidate categories are admissible for later implementation design:

- requests to establish or scope an observe flow using projection-visible selectors or references
- requests to evaluate selector-scoped read models over projection-visible execution or recovery evidence
- requests to derive, inspect, or forward replay / checkpoint / supervision outcomes using Runtime-owned references
- requests to derive, inspect, or forward adapter-bound commit-request candidates or adapter-visible submission outcomes

Result and rejection framing is limited to category-level contract only. This
contract does not freeze a concrete enum set, method list, or transport
envelope.

Admissible result categories are limited to:

- explicit acknowledgment that a request was admitted for evaluation, without implying semantic success
- explicit typed read models or observation items composed from projection-visible shapes
- explicit Runtime-local outcome views or adapter-bound commit-request candidate / outcome views

Admissible rejection framing is limited to explicit typed failure that preserves existing SDK error projection or Runtime reason truth for one of the following category causes:

- invalid or incomplete selector / reference
- missing required Runtime evidence
- unsupported candidate family at the current authority phase
- authority or boundary denial
- contract-shape mismatch

Request / result / rejection framing must not:

- add fallback, route migration, re-inference, or hidden recovery knobs
- reinterpret a commit-request candidate as canonical mutation success
- reinterpret Runtime-local evidence as Realm/shared canonical truth
- synthesize empty success or silent downgrade when required typed evidence is absent

## S-RUNTIME-095 Candidate Admission To Later Implementation Design

The following World Evolution Engine consumer candidates are admitted to later implementation design:

- app-facing logical facade families governed by `S-RUNTIME-091`
- - shared selector, observe-item, read-model, acknowledgment, and rejection type families governed by `S-RUNTIME-092` through `S-RUNTIME-094`

This admission is category/framing-only.
Selector-read stable methods governed by `S-RUNTIME-097` through `S-RUNTIME-101` are the only exception.
All other admitted candidates remain below stable method-contract authority.

The following remain outside stable method-contract authority and must be decided only in a later implementation design that stays within current frozen authority:

- concrete method names
- concrete package export names beyond existing public surfaces
- concrete host bridge methods or IPC payloads
- subscription lifecycle, buffering, caching, pagination, or replay-delivery policy
- batching, session ownership, or host confirmation UX semantics

## S-RUNTIME-096 Still-Inadmissible Candidate Shapes

The following candidate shapes remain inadmissible even for later implementation design under the current frozen authority:

- workflow executor / DAG controller / task-node control facades
- direct canonical world-state mutator, canonical history append, or canonical audit writer facades
- raw checkpoint-substrate, supervision-substrate, scheduler, queue, or worker control facades
- host bridge passthrough, IPC mirror, or transport-payload passthrough facades
- route migration, fallback migration, re-inference, or hidden semantic recovery facades
- runtime-private, realm-private, app-private, bypass facades
- any facade that turns Runtime-local evidence into Realm/shared canonical truth
- any facade that turns commit-request candidacy into implied authorization success or canonical mutation success

## S-RUNTIME-097 Shared Selector-Read Stable Semantic Method-Category Matrix

The World Evolution Engine stable selector-read semantic method-category matrix is closed to the following logical methods:

- `worldEvolution.executionEvents.read(selector)`
- `worldEvolution.replays.read(selector)`
- `worldEvolution.checkpoints.read(selector)`
- `worldEvolution.supervision.read(selector)`
- `worldEvolution.commitRequests.read(selector)`

These logical methods are semantic method categories, not transport methods, daemon RPC parity, host bridge methods, or IPC payload contracts.

No additional stable World Evolution Engine selector-read method categories are admissible in this phase.
The following remain out of scope and must not be added to this stable method matrix:

- observe / subscribe methods
- session or lifecycle methods
- replay / checkpoint / supervision advancement methods
- commit-request forward or submit methods

## S-RUNTIME-098 Shared Selector Matrix

Only projection-visible selector primitives already admitted by `S-RUNTIME-080` through `S-RUNTIME-082` may participate in the stable selector-read contract.

Stable selector matrix:

- `worldEvolution.executionEvents.read(selector)`
  - exact-match selectors:
    - `eventId`
    - `worldId + sessionId + tick`
  - filter-like selectors:
    - must include at least one anchor from `worldId | sessionId | traceId`
    - may additionally include `appId`
    - may additionally include refinements from `eventKind | stage | actorRefs | causation | correlation | effectClass | reason | evidenceRefs`
  - must fail-close when:
    - `eventId` is combined with any additional primitive
    - `tick` appears without `worldId + sessionId`
    - any refinement appears without an anchor
    - `appId` appears as the sole selector primitive

- `worldEvolution.replays.read(selector)`
  - exact-match selectors:
    - a single replay evidence-reference primitive already projection-visible for the replay read-model family
  - filter-like selectors:
    - may use that replay evidence-reference primitive with optional replay-mode refinement when replay mode is projection-visible for the replay read-model family
    - otherwise must include at least one execution-context anchor already projection-visible for the replay read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include projection-visible replay-mode refinement
  - must fail-close when:
    - replay mode appears without a replay evidence-reference primitive or execution-context anchor
    - `eventId` or `tick` appears without a replay evidence-reference primitive or execution-context anchor
    - any selector primitive is not projection-visible for the replay read-model family

- `worldEvolution.checkpoints.read(selector)`
  - exact-match selectors:
    - `checkpointId`
    - a single checkpoint-reference primitive already projection-visible for the checkpoint read-model family
  - filter-like selectors:
    - may use `checkpointId` or a checkpoint-reference primitive with optional restore-status refinement when restore status is projection-visible
    - otherwise must include at least one execution-context anchor already projection-visible for the checkpoint read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include projection-visible restore-status refinement
  - must fail-close when:
    - restore status appears without `checkpointId`, checkpoint reference, or execution-context anchor
    - `eventId` or `tick` appears without `checkpointId`, checkpoint reference, or execution-context anchor
    - any selector primitive is not projection-visible for the checkpoint read-model family

- `worldEvolution.supervision.read(selector)`
  - exact-match selectors:
    - none admitted in this phase
  - filter-like selectors:
    - must include at least one execution-context anchor already projection-visible for the supervision read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include `supervisionOutcome`
  - must fail-close when:
    - `supervisionOutcome` appears without an execution-context anchor
    - `eventId` or `tick` appears without an execution-context anchor
    - any selector primitive is not projection-visible for the supervision read-model family

- `worldEvolution.commitRequests.read(selector)`
  - exact-match selectors:
    - none admitted in this phase
  - filter-like selectors:
    - must include the adapter-envelope anchors `worldId + appId + sessionId`
    - may additionally include candidate-envelope refinements from `effectClass | scope | actorRefs | reason | evidenceRefs`
    - may additionally include the pair `schemaId + schemaVersion`
    - may additionally include projected sidecar refinements from `sourceEventIds | traceId | tick | causation | correlation` and projection-visible checkpoint or supervision references
  - must fail-close when:
    - any of `worldId | appId | sessionId` is missing
    - `schemaId` appears without `schemaVersion`
    - `schemaVersion` appears without `schemaId`
    - any sidecar refinement appears without the required adapter-envelope anchors
    - any selector primitive is not projection-visible for the commit-request read-model family

Global selector hardcuts:

- unknown selector primitives must fail-close
- duplicate selector primitives with conflicting values must fail-close
- mixing exact-match and filter-like forms for the same method must fail-close
- workflow DAG / task / node / output vocabulary must fail-close
- private handles or host-private tokens must fail-close

## S-RUNTIME-099 Shared Read-Result Matrix

Every stable selector-read method must use a shared outer result contract with the following fields:

- `selector`
- `matchMode`
- `matches`

`matchMode` is closed to `exact | filter`.
No stable selector-read result may add cursor, buffering, reconnect, pagination, session-lifecycle, or transport-owned fields.

`matches` may be empty only when:

- the selector is valid and complete
- the requested read-model family is projection-supported
- no admitted match exists for the selector

`matches` must not be used to hide missing required evidence, unsupported projection shape, or boundary denial.

Stable read-result matrix:

- `worldEvolution.executionEvents.read(selector)`
  - returns `WorldEvolutionExecutionEventReadResult`
  - `matches` contains `WorldEvolutionExecutionEventView[]`
  - each view is limited to the normalized event envelope projected by `S-RUNTIME-080` plus subordinate discriminated detail
  - every returned view remains Runtime-local execution evidence, not Realm/shared canonical truth

- `worldEvolution.replays.read(selector)`
  - returns `WorldEvolutionReplayReadResult`
  - `matches` contains `WorldEvolutionReplayView[]`
  - each view is limited to projection-visible replay mode / result / evidence-reference shapes admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local replay evidence, not canonical replay authority beyond recorded-replay truth

- `worldEvolution.checkpoints.read(selector)`
  - returns `WorldEvolutionCheckpointReadResult`
  - `matches` contains `WorldEvolutionCheckpointView[]`
  - each view is limited to projection-visible checkpoint identifier / reference / restore-status shapes admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local recovery evidence, not Realm state or Realm history truth

- `worldEvolution.supervision.read(selector)`
  - returns `WorldEvolutionSupervisionReadResult`
  - `matches` contains `WorldEvolutionSupervisionView[]`
  - each view is limited to projection-visible supervision outcomes and related projection-visible references admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local supervision evidence, not canonical audit truth or canonical shared-world truth

- `worldEvolution.commitRequests.read(selector)`
  - returns `WorldEvolutionCommitRequestReadResult`
  - `matches` contains `WorldEvolutionCommitRequestView[]`
  - each view is limited to adapter-envelope-compatible candidate or outcome fields admitted by `S-RUNTIME-082` plus projected sidecar references already admitted there
  - every returned view remains adapter-bound commit-request candidacy or adapter-visible outcome only, not canonical mutation success, canonical history append, or SDK write authority

## S-RUNTIME-100 Shared Read-Only Rejection Matrix

Stable selector-read methods must share one closed rejection category matrix:

- `INVALID_SELECTOR`
- `INCOMPLETE_SELECTOR`
- `MISSING_REQUIRED_EVIDENCE`
- `UNSUPPORTED_PROJECTION_SHAPE`
- `BOUNDARY_DENIED`

Rejection matrix:

- `INVALID_SELECTOR`
  - selector uses an unknown primitive
  - selector uses a forbidden primitive family
  - selector combines primitives in a forbidden exact-match or filter-like form

- `INCOMPLETE_SELECTOR`
  - selector omits a required anchor or required pair
  - selector is syntactically admitted but under-specified for the chosen method family

- `MISSING_REQUIRED_EVIDENCE`
  - selector is valid and complete, but required projection-visible evidence or reference is absent for evaluation

- `UNSUPPORTED_PROJECTION_SHAPE`
  - returned projection shape lacks required fields
  - returned projection shape contains unsupported enum or discriminator value
  - selector asks for a primitive that is not projection-visible in the chosen read-model family

- `BOUNDARY_DENIED`
  - the consumer is outside the admitted authority boundary for the requested selector-read method
  - the request would require private bypass, host-private state, or otherwise forbidden authority crossing

App-facing publication profiles must preserve the same rejection categories, same fail-close meaning, and same unknown-category behavior.
Neither path may:

- replace the closed category set with free-text-only rejection
- add app-only selector-read rejection categories
- reinterpret rejection as empty success or hidden downgrade

## S-RUNTIME-101 Shared Semantic Parity And Publication Layering

`S-RUNTIME-097` through `S-RUNTIME-100` define one shared semantic selector-read method matrix.
That shared semantic matrix must be identical across app-facing SDK publication host-injected publication for:

- method-category names
- selector matrix
- read-result matrix
- read-only rejection matrix
- no-leak / no-widening / no-bypass hardcuts

Publication layering may differ only by access path and construction boundary.
It must not differ by semantic method meaning.

Therefore:

- app-facing publication profile is defined by `runtime-contract.md` (`S-RUNTIME-102`)
- - surface placement hardcut is defined by `surface-contract.md` (`S-SURFACE-013`)

No publication layer may use selector-read stable methods to smuggle in:

- observe or subscribe semantics
- session or lifecycle semantics
- effectful request semantics
- host concrete API semantics
- workflow substrate truth

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-024` through `P-ARCH-029`
- `world-evolution-engine-projection-contract.md` — `S-RUNTIME-079` through `S-RUNTIME-084`
- `runtime-contract.md` — `S-RUNTIME-091`, `S-RUNTIME-102`
- `runtime-route-contract.md` — `S-RUNTIME-074` through `S-RUNTIME-078`
- `surface-contract.md` — `S-SURFACE-001`, `S-SURFACE-004`, `S-SURFACE-013`
-


---

<!-- source: .nimi/spec/sdks/kernel/world-evolution-engine-projection-contract.md -->

# SDK World Evolution Engine Projection Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

This contract defines the SDK typed projection boundary for the World Evolution Engine.
It mirrors only contract-visible Runtime shapes already owned by `K-WEV-*`.
It does not redefine Runtime execution semantics, consumer API ownership, host implementation details, or workflow substrate semantics.

Projection rule map:

- `S-RUNTIME-079` defines the projection-only ownership boundary.
- `S-RUNTIME-080` defines the stable shared event envelope projection.
- `S-RUNTIME-081` defines replay, checkpoint, and supervision projection limits.
- `S-RUNTIME-082` defines commit-request staging projection limits.
- `S-RUNTIME-083` defines the workflow-substrate leakage hardcut.
- `S-RUNTIME-084` defines the private-boundary and no-widening hardcut.

## S-RUNTIME-079 Projection-Only Ownership Boundary

`@nimiplatform/sdk` may expose typed projection for the World Evolution Engine only as a downstream mirror of `K-WEV-*`.

Therefore:

- Runtime remains the semantic owner for execution-event, replay, checkpoint, supervision, effect-stage, and commit-request staging semantics.
- SDK owns only the typed projection surface, naming of SDK-visible helper types, and packaging of normalized contract-visible Runtime shapes.
- SDK must not widen `eventKind`, `stage`, supervision outcome, replay mode, checkpoint meaning, or commit-request authority beyond what Runtime contract already defines.
- Any semantic change to World Evolution Engine execution rules must land in `K-WEV-*` first; SDK may only project the resulting normalized shape.

## S-RUNTIME-080 Shared Event Envelope Typed Projection

SDK stable top-level typed projection for World Evolution Engine events may expose only the contract-visible envelope defined by `K-WEV-010`.

The stable top-level SDK event projection is limited to:

- `eventId`
- `worldId`
- `appId`
- `sessionId`
- `traceId`
- `tick`
- `timestamp`
- `eventKind`
- `stage`
- `actorRefs`
- `causation`
- `correlation`
- `effectClass`
- `reason`
- `evidenceRefs`

Kind-specific detail may be projected only as a discriminated extension subordinate to the normalized envelope.
SDK must not promote the following to unconditional top-level shared-kernel truth:

- `schemaId`
- `schemaVersion`
- `scope`
- `runMode`
- Realm commit authorization result
- history-append authorization result
- workflow DAG/task/node identity
- workflow output event payload
- `route_policy`
- `fallback`
- bare `payload: Struct`

## S-RUNTIME-081 Replay / Checkpoint / Supervision Projection Boundary

SDK may project typed replay, checkpoint, and supervision surfaces only as normalized mirrors of contract-visible Runtime shapes required by `K-WEV-012`, `K-WEV-013`, and `K-WEV-014`.

Allowed projection families are limited to:

- replay mode/result/evidence-reference shapes that preserve V1 recorded-replay semantics
- checkpoint identifier/reference/restore-status shapes that remain explicitly Runtime-local
- supervision outcome projection using the closed Runtime-owned outcome set: `CONTINUE | DEFER | ABORT | QUARANTINE`

SDK must not expose as stable top-level truth:

- scheduler internals
- queue internals
- workflow node progress internals
- hidden re-inference controls
- route migration or fallback migration knobs
- checkpoint internals that are not already part of a contract-visible Runtime result

Missing required Runtime shape, missing required evidence reference, or unsupported enum value must fail-close.
SDK must not reinterpret absent Runtime evidence as successful replay, successful restore, or implicit supervision recovery.

## S-RUNTIME-082 Commit-Request Staging Typed Projection

SDK may project commit-request staging only as an explicit adapter-bound candidate/result surface derived from `K-WEV-015`.

The stable commit-request candidate projection may include only the Realm-envelope-compatible fields:

- `worldId`
- `appId`
- `sessionId`
- `effectClass`
- `scope`
- `schemaId`
- `schemaVersion`
- `actorRefs`
- `reason`
- `evidenceRefs`

SDK may additionally project Runtime-local staging references such as `sourceEventIds`, `traceId`, `tick`, `causation`, `correlation`, checkpoint references, or supervision references only when Runtime already emits them as explicit contract-visible metadata.

SDK must not:

- expose commit-request staging as a second write contract
- invent a new `runMode` surface
- imply SDK-side commit authorization ownership
- imply automatic history append ownership
- reinterpret adapter-bound candidate creation as canonical Realm mutation success

## S-RUNTIME-083 No Workflow Substrate Leakage

If Runtime implementation reuses workflow substrate internally, SDK stable surface must still project only `K-WEV-*` vocabulary.

The following must not appear as World Evolution Engine top-level SDK truth:

- `workflow`
- `task`
- `node`
- `edge`
- `callback_ref`
- `external_async`
- `route_policy`
- `fallback`
- workflow DAG identity
- workflow output event as canonical event truth

Workflow-derived implementation substrate may exist beneath Runtime internals, but SDK must not surface it as the top-level semantic model for World Evolution Engine execution.

## S-RUNTIME-084 Private Boundary And No-Widening Hardcut

World Evolution Engine SDK projection must remain satisfiable through SDK public surface only.

Therefore SDK must not:

- depend on `runtime/internal/**`
- depend on Realm private client or private transport
- depend on host-private bridge details
- depend on app-private client state
- widen Runtime semantic vocabulary with SDK-only enum values or hidden fallback reinterpretation

Projection must remain fail-close:

- unknown or unsupported `eventKind`, `stage`, supervision outcome, or replay mode must error
- missing required Runtime envelope fields must error
- unsupported commit-request adapter fields must error
- SDK must not synthesize pseudo-success, default authority, or hidden semantic recovery

## Fact Sources

- `.nimi/spec/runtime/kernel/world-evolution-engine-contract.md` — `K-WEV-001` through `K-WEV-016`
- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-024` through `P-ARCH-028`
- `runtime-contract.md` — `S-RUNTIME-011`, `S-RUNTIME-073`
- `boundary-contract.md` — `S-BOUNDARY-001`, `S-BOUNDARY-002`


---

<!-- source: .nimi/spec/sdks/kernel/realm-group-agent-participation-client-contract.md -->

# SDK Realm Group Agent Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Realm Group Agent Participation as a typed client facade over
Realm `GROUP` evidence, Runtime Agent Participation, and Runtime Room
Orchestration. It does not own prompt assembly, provider/model routing, memory
policy, participation concurrency, same-room queues, or Realm GROUP commit
truth.

## S-RUNTIME-221 Realm Group Client Boundary

SDK may expose Realm Group Agent Participation only as typed methods that bind:

- Realm group product authority `R-CHAT-008` through `R-CHAT-014`
- Runtime consumer authority `K-AGCORE-119` through `K-AGCORE-124`
- Runtime room orchestration `realm_group` row and overlay under
  `K-AGCORE-107` through `K-AGCORE-118`

SDK must not define a separate group-agent execution lane, local prompt builder,
provider/model selector, memory policy, reply queue, same-room scheduler, or
Realm commit shortcut.

## S-RUNTIME-222 Realm Evidence Projection

SDK group agent requests must carry typed Realm references only: group thread,
membership snapshot, agent slot, trigger event, read cursor, optional reply
target, room orchestration projection, and commit handoff references aligned to
`.nimi/spec/runtime/kernel/tables/realm-group-participation-context.yaml`.

SDK must not accept raw prompt blobs, unbounded transcript dumps, app-local
participant lists, canonical chat history defaults, direct commit handles, or
provider/model hints as public group agent inputs.

## S-RUNTIME-223 Candidate And Commit Split

SDK must preserve the split between Runtime candidate output and Realm
authenticated commit. Runtime-facing calls may return
`REALM_GROUP_MESSAGE_CANDIDATE`; Realm-facing calls may submit or observe
authenticated Realm commit. SDK must not expose a helper that makes Runtime
directly write a Realm `GROUP` message.

## S-RUNTIME-224 Status And Refusal Projection

SDK may expose queued, running, refused, cancelled, timed-out, and candidate
states only through typed Runtime `runtime.agent.*` projections plus Realm
commit/read/sync truth. SDK must not publish or normalize a public
`runtime.orchestration.*` namespace for group participation status.

## S-RUNTIME-225 Consumer Hardcut Gates

SDK must fail closed if a Desktop, Web, Avatar, app attempts
to pass public prompt text for execution, choose providers or models, override
Runtime memory/capability/concurrency verdicts, own same-room ordering/fairness/
budget/cancellation/timeout, use `GROUP_LIMITED` as a capability enum, or bypass
Realm authenticated commit.

## S-RUNTIME-226 Implementation Status

This contract freezes the SDK consumer plan only. It does not require production
SDK method implementation, generated client code, proto changes, Desktop/Web UI
work, or app migration. Those changes require downstream implementation
admissions that cite this contract and preserve the hardcut gates.

## Traceability

`S-RUNTIME-221` through `S-RUNTIME-226` define the SDK consumer hardcut for
Realm Group Agent Participation. The SDK remains a typed projection and command
facade over Realm and Runtime owners.

- `S-RUNTIME-221`: client boundary.
- `S-RUNTIME-222`: Realm evidence projection.
- `S-RUNTIME-223`: candidate and commit split.
- `S-RUNTIME-224`: status and refusal projection.
- `S-RUNTIME-225`: consumer hardcut gates.
- `S-RUNTIME-226`: implementation status.


---

<!-- source: .nimi/spec/sdks/kernel/companion/realm-runtime-behavior-guide.md -->

# SDK Realm/Runtime Behavior Guide

> 判定：本 companion 无独立规范语义。第 1-3 节复述 ready() fail-close、中断重建、token 刷新语义（已由 rule.nimi.sdks.realm-consumer.r014/r015/r017 承载）；第 4 节为测试门读取顺序（流程内容，按准入标准拒绝）。整文仅作 rationale 素材存档。

## 1. ready() 语义差异
Anchors: S-RUNTIME-015, S-REALM-019

Runtime `ready()` 与 Realm `ready()` 都必须 fail-close。调用方不得再把 Realm 探测失败当作“仅遥测、不影响可用性”的软失败。

## 2. 中断与重建策略
Anchors: S-RUNTIME-028, S-RUNTIME-045, S-REALM-036

Runtime 通道中断发 `runtime.disconnected`，重建由调用方决策；Realm 重连策略实现可变但不允许静默丢事件。

## 3. Token 刷新路径
Anchors: S-REALM-014, S-REALM-028, S-REALM-029

默认无自动刷新；配置 refreshToken 后进入 401 触发刷新，并使用 single-flight 合并并发刷新。

## 4. 测试门读取顺序
Anchors: S-GATE-020, S-GATE-070, S-GATE-091

先过边界/一致性，再过 provider 对齐，最后确认 docs drift 与 consistency 同时通过。
