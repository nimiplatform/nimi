# Cognition Standalone Services - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/cognition/standalone-services.authority.yaml` 与 `.nimi/spec/cognition/runtime-bridge.authority.yaml`。

---

<!-- source: .nimi/spec/cognition/index.md -->

# Cognition Guide

> Normative Imports: `.nimi/spec/cognition/kernel/*`

## Scope

This guide points to the cognition authority surfaces for index. It does not define product rules.

## Reading Path

- `.nimi/spec/cognition/kernel/index.md`
- `.nimi/spec/cognition/kernel/cognition-contract.md`
- `.nimi/spec/cognition/kernel/completion-contract.md`
- `.nimi/spec/cognition/kernel/family-contract.md`
- `.nimi/spec/cognition/kernel/knowledge-service-contract.md`
- `.nimi/spec/cognition/kernel/memory-service-contract.md`
- `.nimi/spec/cognition/kernel/prompt-serving-contract.md`
- `.nimi/spec/cognition/kernel/reference-contract.md`
- `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`
- `.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`
- `.nimi/spec/cognition/kernel/skill-service-contract.md`
- `.nimi/spec/cognition/kernel/surface-contract.md`

## Tables

- `.nimi/spec/cognition/kernel/tables/admitted-reference-matrix.yaml`
- `.nimi/spec/cognition/kernel/tables/artifact-families.yaml`
- `.nimi/spec/cognition/kernel/tables/completion-gates.yaml`
- `.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml`
- `.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml`
- `.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml`
- `.nimi/spec/cognition/kernel/tables/public-surface.yaml`
- `.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`
- `.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`
- `.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml`

---

<!-- source: .nimi/spec/cognition/kernel/app-memory-access-contract.md -->

# Cognition App Memory Access Contract

> Owner Domain: `C-APMEM-*`

## Scope

本契约定义第三方 Nimi App 访问 Cognition memory、knowledge 与 skill 的产品级
权限边界。它不接管 Cognition 既有服务真相，也不把 app 自己的 SQLite、缓存、
对话记录或知识库变成 Nimi 权限。

当前第三方公共权限全部处于 `reserved`；因此下述正向能力尚未准入，所有受保护
端点必须返回 typed `unavailable` 或 deny。未来准入必须遵守 Platform
`P-PERM-017` 的原子 admission 要求。

## C-APMEM-001 Cognition Owns Protected Memory Policy

Cognition 是 Nimi-owned memory、knowledge 与 skill 资源选择器和资源策略的唯一
owner。Runtime 只负责调用方 principal/session/account 绑定、Runtime-owned 权限
决策和端点前置校验；Realm 只负责 Realm-owned 数据与云端策略。Desktop、SDK、
Kit、app host 与 renderer 都不能自创平行策略。

App 自己创建并维护的数据属于 `app_owned_authority`，不经过 Cognition，也不得
创建 Nimi permission row。只有读取或修改 Nimi/Cognition 拥有的资源时，才进入
本契约。

## C-APMEM-002 Public Permission Mapping

第三方产品表面只能使用以下公共 permission id：

- `memory.read`
- `memory.write`
- `knowledge.read`
- `knowledge.write`

Skill 执行尚无已准入的第三方公共 permission id，因此不得通过开放字符串、
内部 operation id 或现有 memory/knowledge 权限推导。新增 skill 权限必须先修改
Platform 公共 catalog 并完成独立 admission。

公共 permission id 不等于 endpoint、table、collection id 或内部 policy enum。
Cognition 可以把一个用户意图展开为精确内部检查，但这些检查不得泄露到 manifest、
SDK 请求或用户审批 UI。

## C-APMEM-003 Owner-Selected Resource Boundary

未来正向准入时，Cognition owner picker 产生 bounded selector：

- `memory.read`：用户选择的 memory collection 与时间范围；
- `memory.write`：用户选择的可写 memory collection；
- `knowledge.read`：用户选择的 knowledge base；
- `knowledge.write`：用户选择的可写 knowledge base。

Selector 及其 digest 由 owner 生成，app 不能提交 resource id 作为权限证据。每个
端点必须重新验证当前 decision、selector、resource ownership、account、principal、
session、revision 与 endpoint policy；缺失、过期、撤销或不匹配均 fail-close。

## C-APMEM-004 No Implicit Projection Or Write

聊天 transcript、prompt context、缓存、background job、replay 或 display path 不得
隐式生成 Nimi memory/knowledge truth。写入必须经过相应已准入的 write permission、
owner-selected target、typed audit reason 与 Cognition 原子写入。

读取权限不能推导写入权限，write 也不能自动扩展到其他 collection、persona、
knowledge base 或 account。Batch、retry 与异步任务必须继承同一 bounded decision，
不能扩大 selector。

## C-APMEM-005 Conversation-Derived Memory

将 app conversation 转换为 Nimi memory 时，必须同时满足：

- 已准入且当前有效的 `memory.write` decision；
- Cognition owner-selected collection；
- Runtime-derived calling app principal 与 account；
- canonical conversation anchor 与 persona relation；
- typed audit event。

`app_id` 仅可作为显示 metadata，不能作为 owner、selector 或正向授权 key。没有
上述完整事实时，不得由后台任务或缓存补写。

## C-APMEM-006 Local App Principal Is Only A Caller Subject

`local_app_principal_id` 只用于 caller、access-control 与 audit subject。Cognition
必须从 RuntimeAgent/Cognition canonical relations 解析 agent、persona、conversation、
memory collection 与 knowledge base owner，禁止从以下信息推导资源所有权或权限：

- display `app_id`；
- project path 或 package path；
- process id；
- local-app record；
- permission decision 本身；
- app-local cache 或 SQLite。

有效 session、Developer Mode、项目启动批准、publisher tier、bundled identity 或
first-party binding 都不能替代当前受保护资源 decision。

## C-APMEM-007 First-Party And Third-Party Separation

Bundled first-party 产品只能使用各自已准入的 service entitlement。第三方开发版
Zhiyu 是独立 local-development principal，不能继承 shipped Zhiyu 的 agent、memory、
knowledge 或 service entitlement。First-party entitlement 不写入第三方 permission
ledger，也不能作为第三方正向 fallback。

## C-APMEM-008 Audit And Revocation

未来 admitted decision 的创建、拒绝、过期、撤销和每次写操作必须产生 owner audit。
Account switch、principal tombstone、selector/resource policy 变化或 decision revoke
必须使后续端点调用立即失败。App 只看到公共 posture，不得读取 decision id、selector
digest、内部 operation/resource identity 或其他 app 的状态。

## C-APMEM-009 Current Admission Posture

当前 `memory.read`、`memory.write`、`knowledge.read`、`knowledge.write` 均为
`reserved`，没有第三方正向 mutation/read path。Catalog 条目、manifest 声明、mock
approval 或单独 CRUD endpoint 都不能宣称 admission 完成。

## Fact Sources

- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-*`
- `.nimi/spec/platform/kernel/tables/nimi-app-permission-catalog.yaml`
- `.nimi/spec/runtime/kernel/grant-service.md` — Runtime owner-internal decision boundary
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — RuntimeAgent relations
- `.nimi/spec/cognition/kernel/memory-service-contract.md` — memory owner truth
- `.nimi/spec/cognition/kernel/knowledge-service-contract.md` — knowledge owner truth
- `.nimi/spec/cognition/kernel/skill-service-contract.md` — skill owner truth
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — public SDK projection

---

<!-- source: .nimi/spec/cognition/kernel/cognition-contract.md -->

# Cognition Contract

> Owner Domain: `C-COG-*`

## C-COG-001 Standalone Cognition Authority Home

`nimi-cognition` is the authority home for standalone local cognition.

It owns:

- standalone cognition object model
- local cognition semantic boundary
- standalone cognition public surface
- local cognition mutation / retrieval / cleanup semantics
- local cognition prompt/context separation
- local cognition working-state semantics
- external routine boundary for standalone cognition

It does not own:

- runtime bank lifecycle truth
- runtime provider bridge truth
- runtime replication truth
- runtime canonical review truth
- runtime live agent lifecycle truth
- Realm shared-truth governance

## C-COG-002 Runtime Extraction And Upgrade Relation

`nimi-cognition` is extracted from runtime-local memory / knowledge capabilities and upgraded into a standalone cognition domain.

Fixed rules:

- cognition is not a runtime subchapter, helper package, or internal extraction detail
- cognition authority must remain independently specifiable without importing runtime ownership as a prerequisite
- overlap with runtime memory or runtime knowledge does not permit cognition capability downgrade
- where cognition covers capability already present in runtime memory / knowledge, the cognition contract must be at least equally explicit and fail-closed
- shared implementation heritage does not make runtime the continuing semantic owner of cognition

## C-COG-003 No Parallel Truth

The standalone cognition authority must live in `/.nimi/spec/cognition/kernel/**`.

Fixed rules:

- local reports, baseline proposals, and implementation code are not authority once cognition kernel rules are admitted here
- runtime kernel documents may reference cognition boundary rules, but they must not redefine cognition object ownership
- cognition implementation must align to this contract rather than reinterpreting the contract through package layout or test shape

## C-COG-004 Standalone Completion Standard

`nimi-cognition` is not admitted as an MVP, skeleton, or design probe.

Fixed rules:

- standalone cognition must target production-grade semantic closure
- pseudo-implemented surfaces, fake success payloads, placeholder cleanup semantics, and compatibility-shaped non-owners are not admitted
- a package or service surface is incomplete unless its mutation, retrieval, persistence, cleanup, and formatting semantics are all explicitly closed or explicitly out of scope
- “tests pass” is not completion evidence if the tested behavior is semantically weaker than admitted cognition rules
- cognition-local top-level completion may be covered when an independent standalone audit, matching behavior-level proof, and current cognition authority all agree that no owner-path semantic blocker remains
- cognition-local top-level completion does not imply repo-wide final closeout or parity with runtime's deeper overlapping service maturity

## C-COG-005 Top-Level Object Model

Standalone cognition is centered on the following first-order local artifact families:

- `agent_model_kernel`
- `world_model_kernel`
- `memory_substrate`
- `knowledge_projections`
- `skill_artifacts`
- `working_state`

Fixed rules:

- kernels are primary local model artifacts, not generic containers
- memory, knowledge, and skill remain distinct advisory families and must not collapse into kernel truth
- working state is a first-order local cognition family even when transient
- prompt serving, retrieval, cleanup, and routines must respect these family boundaries

## C-COG-006 Kernel Boundary

Kernel semantics are local-model semantics, not external truth governance.

Fixed rules:

- kernel scope contains exactly one local agent kernel and one local world kernel per cognition scope
- kernels begin at admitted `incoming_patch` mutation surface rather than upstream observation capture
- source observation, candidate generation, and external truth arbitration remain outside kernel ownership
- kernel rule state must keep independent anchor-binding, alignment, and lifecycle axes
- kernel mutation must remain fail-closed through the admitted `status / diff / merge / resolve / commit / log` surface

## C-COG-007 Memory Substrate Upgrade Requirement

`memory_substrate` is a standalone cognition family, not merely a weaker clone of runtime memory records.

Fixed rules:

- cognition memory must admit typed local record families with fail-closed payload validation
- overlapping retrieval capability must not silently degrade below runtime memory service strength by convenience or omission
- service-derived support, cleanup, or serving metadata must not be caller-owned persisted truth
- cognition memory may differ from runtime bank / replication / provider shapes, but its local serving semantics must be independently complete
- prompt or routine consumption of memory must rely on service-owned derived views rather than caller-forged metadata

## C-COG-008 Knowledge Projection Upgrade Requirement

`knowledge_projections` are a standalone cognition family, not merely runtime-local page storage under a different name.

Fixed rules:

- cognition knowledge must own projection semantics, lifecycle, retrieval surface, and local relation integrity
- cognition knowledge must not silently regress below runtime knowledge search / graph / ingest closure where overlapping capability is claimed
- same-family and cross-family references must remain explicit, typed, and fail-closed
- cognition knowledge may remain local-only, but local-only scope does not permit weakened semantics or fake graph ownership

## C-COG-009 Skill Artifact Boundary

`skill_artifacts` are service-grade advisory artifacts within cognition.

Fixed rules:

- skill artifacts remain weaker than kernels and knowledge projections in truth weight
- advisory status does not permit malformed bundles, fake selectors, unstable step order, or unowned refs
- skill storage, retrieval, lifecycle, and history must remain semantically closed if admitted on the public cognition surface
- skill must not be used as a backdoor for runtime execution-policy truth

## C-COG-010 Working State Boundary

`working_state` is transient cognition scaffolding.

Fixed rules:

- working state is not durable truth by default
- working state must not absorb runtime hook lifecycle, autonomy policy, control-plane state, or replication truth
- if working state is not persisted, that transient boundary must be explicit and testable
- if a future rule admits persistent working state, that persistence must be declared explicitly rather than smuggled in through a generic artifact store

## C-COG-011 Prompt Boundary

Prompt/context serving must preserve kernel primacy without rewriting cognition semantics.

Fixed rules:

- prompt serving must keep kernel context distinct from advisory context
- prompt serving must not promote advisory artifacts into kernel truth
- prompt serving must consume service-owned derived views where support or cleanup metadata is shown
- prompt serving must not read working state or external routine evidence unless a later rule explicitly admits those lanes

## C-COG-012 Refgraph And Cleanup Boundary

Standalone cognition cleanup must be explicit, reference-aware, and archive-first where admitted.

Fixed rules:

- cleanup and retrieval support reasoning must use an explicit local refgraph authority
- broken references, incoming support, outgoing dependency health, and remove blockers must remain observable
- cleanup must not rely on fake drift markers or pseudo-timeout forgetting when such semantics are not admitted
- refgraph ownership is local static relation truth for cognition; it does not imply runtime replication, alias, or provider ranking ownership

## C-COG-013 External Routine Boundary

Standalone cognition routines are external workers acting on cognition-owned artifact families.

Fixed rules:

- routines are not core cognition commands
- routines must not directly mutate kernels
- routine execution must use a typed non-kernel access contract
- if cognition admits a routine worker path, that path is the authoritative external execution entry rather than a façade-owned pseudo-service

## C-COG-014 Digest Boundary

`digest` is the first admitted cognition routine.

Fixed rules:

- digest acts on memory, knowledge, and skill families only
- digest cleanup proposals and transitions must be explainable through lifecycle and refgraph truth
- archive/remove semantics must remain explicit, observable, and distinct from explicit destructive delete
- digest must not be reduced to a wall-clock stale-item sweeper unless a later rule explicitly admits such forgetting semantics

## C-COG-015 Public Surface Completeness

If a standalone cognition surface is public, it must be semantically complete within its admitted role.

Fixed rules:

- public cognition services must expose only owner-true surfaces
- compatibility wrappers that preserve known-wrong ownership are not admitted as steady-state public contract
- optional capability claims must not appear in the contract unless real wiring, semantics, and failure behavior exist
- typed API shape alone does not count as service-level completion

## C-COG-016 Runtime Bridge Boundary

Runtime may consume or bridge standalone cognition, but runtime does not own cognition semantics.

Fixed rules:

- runtime integration must be expressed as bridge / adapter / consumer behavior
- runtime contracts may constrain how runtime-owned services interact with cognition, but not redefine cognition authority
- when runtime republishes overlapping cognition-backed memory/knowledge
  semantics, the only admitted runtime-facing owner surface is
  `RuntimeCognitionService`; retired `RuntimeMemoryService` /
  `RuntimeKnowledgeService` topology must not be restored as steady state
- cognition must remain viable as a standalone project even when runtime is not present
- any extracted runtime implementation that remains only valid with runtime-owned semantics is not admitted as completed cognition

## C-COG-017 Failure Model

Standalone cognition must fail close on semantic violations.

Fixed rules:

- malformed payloads, illegal refs, illegal lifecycle transitions, and illegal scope crossings must be rejected explicitly
- pseudo-success, best-effort mutation, or silent downgrade are not admitted
- retrieval surfaces must keep degraded capability explicit; they must not quietly pretend parity they do not have
- cleanup and formatting paths must not invent service-owned metadata without explicit derivation logic

## C-COG-018 Out-Of-Scope Authority

The following are outside the admitted standalone cognition baseline:

- runtime provider bridge ownership
- runtime replication ownership
- runtime canonical review ownership
- Realm shared-truth governance
- app-facing or SDK-facing cognition transport contracts
- any requirement that standalone cognition reuse runtime bank scope truth as its own semantic home

---

<!-- source: .nimi/spec/cognition/kernel/completion-contract.md -->

# Cognition Completion Contract

> Owner Domain: `C-COG-*`

## C-COG-053 Completion Gate Registry

The authoritative standalone cognition completion gates are
`tables/completion-gates.yaml`.

Fixed rules:

- every cognition completion gate must declare exactly one closure class
- admitted closure classes are `semantic_closure`, `implementation_closure`, and
  `runtime_independence`
- completion gates must remain explicit and enumerable rather than inferred from
  test count or package count

## C-COG-054 Semantic And Implementation Closure Separation

Standalone cognition completion must distinguish semantic closure from current
implementation status.

Fixed rules:

- semantic closure is satisfied only when owner surface, failure model, cleanup,
  retrieval, and formatting semantics are decision-complete
- production-grade completion additionally requires one admitted durable backend
  path rather than parallel low-strength persistence surfaces
- `C-COG-004=covered` records a cognition-local evidence state, not a global or
  final project-completion verdict
- implementation closure is satisfied only when admitted semantics have matching
  code paths, reopen-safe persistence/recovery evidence, and behavior-level
  proof strong enough to justify `covered`
- top-level completion requires authoritative routine worker mutation paths to
  be semantically equivalent to the service-owned lifecycle policy they claim
  to represent, and that equivalence must be established by behavior-level
  proof rather than inferred solely from local green gates
- top-level completion also requires public mutation surfaces to reject illegal
  lifecycle resurrection, relation/graph writes to non-live targets, and
  provenance payloads that have not yet been closed into owner-true semantics
- when redesign audit reopens `C-COG-004`, rule evidence must return to
  `deferred` until the narrower subsystem rules, their direct behavior tests,
  and a fresh independent completion review are re-established
- `C-COG-004` may be restored to `covered` only when:
  - authoritative worker and service owner paths are semantically aligned
  - legacy low-strength cleanup helpers are no longer part of admitted truth
  - fail-closed behavior is covered across admitted retrieval and cleanup
    failure families
  - a fresh independent standalone audit agrees the remaining gaps are no
    longer semantic blockers
- once `C-COG-004` is `covered`, any new durable backend path or newly admitted
  public cognition surface requires prior cognition authority update plus a
  fresh completion audit rather than automatic inheritance of existing closeout
- rule evidence must use `deferred` whenever admitted semantics outpace current
  implementation or available proof
- if prompt, digest, or refgraph proof regresses from behavior-level evidence to
  formatting-only, best-effort, or weak-string evidence, affected rule evidence
  must be downgraded before production-grade closeout can still be claimed

## C-COG-055 Runtime Independence Completion Gate

Standalone cognition completion requires runtime independence in both authority
and operation.

Fixed rules:

- standalone cognition must remain spec-complete without importing runtime as a
  prerequisite owner
- build, retrieval, prompt, cleanup, and mutation semantics must not require
  runtime-owned provider, replication, review, or lifecycle truth to appear
  complete
- build/test/race gates are necessary runtime-independence evidence, but they do
  not by themselves prove top-level standalone semantic closure
- race-safe standalone execution evidence must remain part of the completion
  gate for production-grade closeout
- runtime bridge presence may strengthen coexistence but must not become a
  hidden completion dependency
- repo-wide non-cognition governance drift must be recorded explicitly rather
  than misreported as cognition completion failure

---

<!-- source: .nimi/spec/cognition/kernel/family-contract.md -->

# Cognition Family Contract

> Owner Domain: `C-COG-*`

## C-COG-019 Family Registry

The authoritative standalone cognition family registry is `tables/artifact-families.yaml`.

Fixed rules:

- every admitted cognition family must appear exactly once in the registry
- every registered family must declare truth weight, persistence mode, prompt lane, cleanup lane, and owner surface
- adding a new cognition family requires an admitted kernel rule rather than ad hoc package growth
- family registration is semantic admission, not a naming convenience for packages or folders

## C-COG-020 Scope And Identity Model

Every durable cognition artifact belongs to exactly one cognition scope.

Fixed rules:

- kernels, memory records, knowledge pages, and skill bundles are scope-owned artifacts
- family-local identifiers must be unique within one scope
- cross-scope references are not admitted
- one cognition scope contains exactly one `agent_model_kernel` and one `world_model_kernel`
- deleting a cognition scope must remove durable scope-owned artifacts and clear transient working state for that scope

## C-COG-021 Family Truth Weight And Serving Order

Standalone cognition serving order is family-sensitive rather than storage-sensitive.

Fixed rules:

- `agent_model_kernel` and `world_model_kernel` are the only core local-model truth families
- `memory_substrate`, `knowledge_projections`, and `skill_artifacts` are advisory families and must remain subordinate to kernel truth
- `working_state` is transient scaffolding and must never be served as admitted truth
- routine evidence is not a first-order cognition family and must not be promoted into prompt or retrieval truth by default
- kernel truth may cite advisory artifacts through typed outgoing refs, but that
  citation posture does not demote kernels or promote advisory families into
  kernel truth owners

## C-COG-022 Persistence And Transience Boundary

Standalone cognition must keep durable and transient families explicitly separated.

Fixed rules:

- durable families persist through the standalone cognition store
- `working_state` remains transient unless a later cognition rule explicitly admits persistence
- transient state must not silently leak into durable search, refgraph, digest, or prompt lanes
- routine evidence may persist as external-worker evidence, but that persistence does not make it a cognition family

## C-COG-023 Typed Reference Integrity

Cross-artifact references must remain typed and fail-closed.

Fixed rules:

- reference targets must be expressed as typed family-qualified artifact references rather than untyped free-form links
- save paths must reject missing targets, illegal target families, and illegal scope crossings
- cross-family references are admitted only where the cognition family contract explicitly permits them
- admitted cross-family reference permission is defined by `tables/admitted-reference-matrix.yaml`
- storing an artifact with unresolvable or illegal references is not admitted as partial success

## C-COG-024 Cleanup Eligibility Boundary

Cleanup eligibility is family-specific.

Fixed rules:

- kernels are never digest cleanup targets
- `working_state` admits only explicit clear semantics, not digest cleanup
- `memory_substrate`, `knowledge_projections`, and `skill_artifacts` are the only admitted digest target families
- routine evidence must not be treated as a hidden fourth cleanup lane for cognition truth

## C-COG-025 Storage Envelope And Fail-Closed Validation

Standalone cognition storage must validate by family semantics before commit.

Fixed rules:

- every admitted stored artifact must be validated against its family-specific payload contract before persistence
- one family must not be able to impersonate another through a generic envelope or mislabeled kind
- caller-owned payload must not carry service-owned derived metadata as if it were durable truth
- fail-closed validation applies before mutation commit, not only at read time

---

<!-- source: .nimi/spec/cognition/kernel/index.md -->

---
id: SPEC-COGNITION-KERNEL-INDEX-001
title: Cognition Kernel Index
status: active
owner: "@team"
updated: 2026-04-16
---

# Cognition Kernel Index

## Contracts

- `cognition-contract.md` (`C-COG-*`)
- `family-contract.md` (`C-COG-*`)
- `surface-contract.md` (`C-COG-*`)
- `runtime-bridge-contract.md` (`C-COG-*`)
- `runtime-upgrade-contract.md` (`C-COG-*`)
- `memory-service-contract.md` (`C-COG-*`)
- `knowledge-service-contract.md` (`C-COG-*`)
- `skill-service-contract.md` (`C-COG-*`)
- `reference-contract.md` (`C-COG-*`)
- `prompt-serving-contract.md` (`C-COG-*`)
- `completion-contract.md` (`C-COG-*`)
- `app-memory-access-contract.md` (`C-APMEM-*`)

## Tables

- `tables/artifact-families.yaml`
- `tables/public-surface.yaml`
- `tables/runtime-bridge-boundary.yaml`
- `tables/runtime-capability-upgrade-matrix.yaml`
- `tables/memory-service-operations.yaml`
- `tables/knowledge-service-operations.yaml`
- `tables/skill-service-operations.yaml`
- `tables/admitted-reference-matrix.yaml`
- `tables/prompt-serving-lanes.yaml`
- `tables/completion-gates.yaml`
- `tables/rule-evidence.catalog.yaml`
- `tables/rule-evidence.rules-app-memory-access.yaml`

## Derived Views

Cognition table views are rendered on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope cognition`. The views are stdout artifacts; `generated/` is not a product authority directory.

---

<!-- source: .nimi/spec/cognition/kernel/knowledge-service-contract.md -->

# Cognition Knowledge Service Contract

> Owner Domain: `C-COG-*`

## C-COG-043 Knowledge Service Operation Registry

The authoritative standalone cognition knowledge operation registry is
`tables/knowledge-service-operations.yaml`.

Fixed rules:

- every admitted knowledge service operation must appear in the registry exactly
  once
- every registered knowledge operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- same-scope relation, retrieval, and ingest capability claims must be grounded
  in this registry rather than inferred from package names alone

## C-COG-044 Knowledge Page Lifecycle And Retrieval Semantics

Standalone cognition knowledge owns local projection lifecycle and retrieval.

Fixed rules:

- save/update semantics must remain explicit for one page in one cognition scope
- explicit delete semantics are required for knowledge ownership; page removal
  must not be represented as silent index disappearance
- lexical retrieval and hybrid retrieval must remain distinct contracts when
  both are admitted
- retrieval posture must declare ordering, fail-close behavior, and whether the
  returned projection is page truth, first-class relation truth, hybrid ranking,
  or ingest task state
- cognition knowledge must not claim parity with runtime-local knowledge if it
  reduces page lifecycle and retrieval semantics to a generic blob search

## C-COG-045 Knowledge Relation, Ingest, And Progress Semantics

Standalone cognition knowledge may admit same-scope graph and ingest capability
only through explicit owner-true contracts.

Fixed rules:

- relation write paths must validate source page, target page, relation type,
  scope equality, and duplicate/self-link constraints before commit
- relation truth must remain first-class and must not be represented by
  page-embedded pseudo-relations inside `Page.ArtifactRefs`
- backlink and traversal reads must declare traversal boundary, ordering, and
  fail-close behavior explicitly
- ingest capability must declare accepted input envelope, task/progress model,
  and page-write effects rather than collapsing ingest into a hidden side effect
- admitted ingest lifecycle is `queued -> running -> completed/failed`, and
  interrupted local tasks must become explicit failed-state evidence on reopen
- if a knowledge capability is not on the public surface, it must be placed on
  an explicit external routine path or explicit deferral list rather than left
  implicit

## C-COG-046 Knowledge Non-Ownership Boundary

Standalone cognition knowledge remains separate from runtime-owned infra truth.

Fixed rules:

- knowledge service does not own runtime bank authorization, shared-truth
  replication, workflow-service truth, or Agent Core admission
- relation integrity and ingest progress remain cognition-owned only for the
  standalone local projection path
- runtime-facing republication of overlapping knowledge semantics must route
  through `RuntimeCognitionService`; retired `RuntimeKnowledgeService` topology
  must not be restored as the future steady state
- same-scope local graph ownership does not authorize cognition to absorb
  runtime shared citation or runtime review semantics

## C-COG-059 Runtime Knowledge Bank Typed Scope Kind

Runtime-facing knowledge bank lifecycle is owned by a typed cognition scope
kind `runtime_knowledge_bank` registered in the cognition scope registry.
This scope kind is disjoint from agent-bound scope kinds (`agent_core`,
`agent_dyadic`, `world_shared`); it admits only the public infra-scoped
owners declared by K-KNOW-002 (`APP_PRIVATE`, `WORKSPACE_PRIVATE`).

Fixed rules:

- every runtime-facing knowledge bank corresponds to exactly one
  registered scope of kind `runtime_knowledge_bank`; the cognition scope
  registry is the single owner of this binding
- scope id provenance is the typed cognition scope registry; runtime
  facade and downstream consumers must not derive a scope id by ad-hoc
  string concatenation (e.g. `"know_" + bankID`) on production paths
- `runtime_knowledge_bank` scopes do not admit `AGENT_CORE`,
  `AGENT_DYADIC`, or `WORLD_SHARED` owner kinds; agent recall semantics
  (`Retain` / `Recall` / `History`) do not operate on this scope kind
- registered runtime knowledge bank scopes carry typed metadata
  (display_name, owner_kind, owner_key, owner_json, created_at,
  updated_at) sufficient to authorize and audit runtime-facing RPCs
  without re-reading legacy snapshot blobs
- delete of a `runtime_knowledge_bank` scope must cascade in a single
  storage transaction to all scope-anchored stores (page / relation /
  embedding / history / ingest task / FTS); no orphan rows may survive
- this rule is the cognition-side statement of the runtime-side
  retirement K-KNOW-001a; the two rules together forbid any parallel
  runtime-private bank truth

## C-COG-060 Runtime Workspace Authorization Seam

Runtime-facing cognition knowledge owns storage, typed scope registry, local
page/relation/ingest persistence, and action-to-storage facade behavior. It
does not own Runtime account authorization for WORKSPACE_PRIVATE banks.

Fixed rules:

- runtime knowledge authorization must enter through the
  `KnowledgeAuthorizer` seam before any workspace-owned bank data is returned
  or mutated
- `KnowledgeAuthorizer` is the only cognition-side consumer of the internal
  account workspace binding resolver
- cognition must not import account persistence internals, read account
  custody, read workspace membership projection directly, call Realm for
  membership per knowledge RPC, or derive authorization from app-local cache
- cognition must pass target owner kind, target workspace id,
  runtime-authenticated caller context from the protocol envelope
  (`x-nimi-app-id`, `x-nimi-app-instance-id`), workspace binding attachment,
  knowledge action, and required scopes to the authorizer. Device identity must
  be derived or verified by Runtime account/app registry state through the
  account resolver, not supplied by knowledge request body fields
- a deny or unavailable decision from the authorizer must fail closed and must
  not downgrade to APP_PRIVATE, anonymous, subject_user_id, fixture, or legacy
  behavior

---

<!-- source: .nimi/spec/cognition/kernel/memory-service-contract.md -->

# Cognition Memory Service Contract

> Owner Domain: `C-COG-*`

## C-COG-039 Memory Service Operation Registry

The authoritative standalone cognition memory operation registry is
`tables/memory-service-operations.yaml`.

Fixed rules:

- every admitted memory service operation must appear in the registry exactly
  once
- every registered memory operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- memory capability admission must be grounded in this registry rather than
  inferred from implementation naming alone

## C-COG-040 Memory Artifact Mutation And Deletion Semantics

Standalone cognition memory owns local artifact mutation over memory records.

Fixed rules:

- memory save paths must validate scope identity, record identity, and
  family-specific payload shape before commit
- save semantics may admit create-or-update behavior, but create/update
  ambiguity must remain explicit in operation-level contract and history output
- explicit delete semantics are required for public memory ownership; silent
  disappearance is not admitted as a delete contract
- archive or remove lifecycle changes triggered by digest must remain observable
  through memory history or lifecycle-bearing views
- caller-owned payload must not persist service-owned support, cleanup, drift,
  or serving metadata as if it were raw memory truth

## C-COG-041 Memory Retrieval, History, And Derived View Semantics

Standalone cognition memory retrieval must remain service-grade and explainable.

Fixed rules:

- raw artifact reads and derived serving-view reads must remain separate
  contracts
- retrieval posture must declare at least lexical retrieval behavior, derived
  support, lineage, invalidation, and cleanup-signal posture, and ordering
  semantics for list/search surfaces
- history or lineage reads must expose lifecycle-relevant transitions rather
  than forcing clients to infer them from current snapshot state
- derived views may project support or cleanup signals only when those fields
  are recomputed by a service-owned derivation path
- derived views may expose lineage and invalidation only when those fields are
  recomputed from live refs and current dependency state at read time
- memory retrieval must not silently pretend parity with runtime recall/history
  while exposing only a weaker storage lookup

## C-COG-042 Memory Non-Ownership Boundary

Standalone cognition memory remains independent from runtime-owned operational
infrastructure concerns.

Fixed rules:

- memory service does not own runtime provider routing, embedding bridge,
  replication truth, canonical review scheduling, or runtime event streaming
- memory service does not own editable memory embedding live config, resolved
  runtime embedding state, bank identity, or bank migration / cutover truth
- standalone memory may expose lifecycle and history semantics, but that does
  not make it a runtime replication owner
- runtime-facing republication of overlapping memory semantics must route
  through `RuntimeCognitionService`; retired `RuntimeMemoryService` topology
  must not be restored as the future steady state
- derived-view support does not permit caller-owned mutation of service-owned
  ranking or cleanup posture

---

<!-- source: .nimi/spec/cognition/kernel/prompt-serving-contract.md -->

# Cognition Prompt Serving Contract

> Owner Domain: `C-COG-*`

## C-COG-050 Prompt Serving Lane Registry

The authoritative prompt-lane registry is `tables/prompt-serving-lanes.yaml`.

Fixed rules:

- every admitted prompt lane must declare serving order, admitted families,
  admitted inputs, derived-view source, and forbidden inputs
- prompt lanes govern cognition serving semantics, not just formatter output
  layout
- prompt-lane admission must remain explicit even when formatting happens inside
  one `PromptService`

## C-COG-051 Prompt Separation And Derived Metadata Rule

Standalone cognition prompt serving must preserve family truth ordering.

Fixed rules:

- kernel truth remains in a dedicated core lane and must never be merged
  implicitly into advisory context
- advisory lanes may consume only validated artifacts or service-owned derived
  views
- working state and routine evidence are excluded from prompt serving unless a
  later cognition rule explicitly admits them
- cleanup, support, or serving signals may appear in prompt output only when
  they come from explicit derivation logic rather than caller-persisted metadata

## C-COG-052 Prompt Failure Model

Prompt serving must fail close on lane or derivation violations.

Fixed rules:

- missing required kernel artifacts, illegal lane mixing, malformed derived
  views, or forbidden prompt inputs must surface explicit failure rather than
  best-effort rendering
- formatter convenience must not override family-truth ordering
- prompt output must not silently imply kernel truth from advisory-only inputs

---

<!-- source: .nimi/spec/cognition/kernel/reference-contract.md -->

# Cognition Reference Contract

> Owner Domain: `C-COG-*`

## C-COG-047 Admitted Reference Matrix

The authoritative standalone cognition reference matrix is
`tables/admitted-reference-matrix.yaml`.

Fixed rules:

- every registered cognition family must appear exactly once in the reference
  matrix
- the matrix must declare allowed outgoing refs, allowed incoming refs,
  forbidden cross-family refs, cross-scope prohibition, and missing-target
  effects per family
- cross-family reference admission must be defined by this matrix rather than
  inferred from storage convenience or permissive tests
- kernel rules may own outgoing refs to standalone advisory artifacts only where
  the matrix explicitly admits `memory_substrate`, `knowledge_projections`, and
  `skill_artifacts` as kernel targets
- kernels remain forbidden as incoming reference targets; advisory artifacts must
  not claim kernel ownership by storing reverse refs into kernel families

## C-COG-048 Refgraph Explainability Boundary

Standalone cognition refgraph is the explainability authority for local static
artifact relations.

Fixed rules:

- cleanup proposals must remain traceable to broken refs, incoming support,
  outgoing dependency health, and remove blockers
- refgraph explainability must remain explicit and queryable rather than hidden
  inside digest heuristics
- refgraph owns only local static relation truth; it does not absorb runtime
  review, replication, alias, or provider-ranking semantics
- first-class `knowledge_relation` rows are part of cognition-local relation
  truth and must participate in backlink, traversal, delete blocker, and digest
  cleanup reasoning
- remove blockers must distinguish strong vs weak inbound support and must not
  flatten both classes into one generic blocker string
- removed sources do not contribute live support; removed targets remain visible
  as broken dependency evidence

## C-COG-049 Missing-Target And Cleanup Blocking Semantics

Missing-target behavior must remain family-specific and fail-closed.

Fixed rules:

- when a family marks missing targets as `reject`, save-time mutation must fail
  before commit
- archive or remove blocking caused by missing or incoming relations must remain
  explicit in cleanup reasoning
- cleanup blocking must not be silently bypassed by forcing a generic remove
  path through storage ownership alone
- digest `remove` requires prior archival plus a later pass confirmation; same-
  pass archive-and-remove is not admitted

---

<!-- source: .nimi/spec/cognition/kernel/runtime-bridge-contract.md -->

# Cognition Runtime Bridge Contract

> Owner Domain: `C-COG-*`

## C-COG-033 Runtime Bridge Registry

The authoritative runtime bridge registry is `tables/runtime-bridge-boundary.yaml`.

Fixed rules:

- every admitted runtime/cognition overlap concern must declare cognition owner, runtime owner, admitted bridge direction, and forbidden owner inversion
- bridge registry rows define coexistence boundaries, not implementation sharing permission by default
- runtime bridge registration must not collapse cognition and runtime into one owner surface
- runtime-facing republication of overlap semantics must point to
  `RuntimeCognitionService` plus explicit retained runtime-private depth rather
  than reviving `RuntimeMemoryService` / `RuntimeKnowledgeService` as
  co-equal steady-state owners

## C-COG-034 Overlap Upgrade And No-Downgrade Rule

Overlap with runtime memory or runtime knowledge is allowed only under explicit upgrade posture.

Fixed rules:

- standalone cognition must not become semantically weaker than runtime on overlapping claimed capability
- implementation shape differences are admitted only when semantic closure and fail-closed strength remain at least as strong
- reusing runtime terminology without matching semantic strength is not admitted as parity
- runtime-facing full replacement of memory/knowledge service topology does not
  transfer runtime-private review, provider, bank, or replication ownership
  into cognition

## C-COG-035 Runtime Independence Rule

Standalone cognition must remain viable without runtime presence.

Fixed rules:

- cognition build, test, mutation, retrieval, prompt serving, and cleanup semantics must remain valid without runtime being installed or linked in
- runtime-only lifecycle, replication, provider, or review truth must not become hidden prerequisites for standalone cognition correctness
- if an implementation requires runtime semantics to appear complete, that implementation is not admitted as completed cognition

## C-COG-036 Runtime Consumption Boundary

Runtime may consume standalone cognition only as a bridge/adapter consumer.

Fixed rules:

- runtime may adapt cognition artifacts or outputs into runtime-owned services only through explicit bridge logic
- runtime may republish overlap semantics through `RuntimeCognitionService`, but
  that republishing must not create a dual-owner or adapter-first steady state
- runtime must not treat cognition internal storage layout as runtime-owned truth
- runtime and cognition must not silently share one semantic owner database, backlog, or review lane
- cognition authority remains in cognition even when runtime is the current consumer

## C-COG-061 Runtime Agent Embedding Intent Boundary

Runtime Local Agent embedding intent is not cognition-owned. RuntimeCognitionService
consumes RuntimeAgentService-owned Runtime Agent AI Config `text.embed` intent and
owns only resolved memory/knowledge projection and execution state on the runtime
path.

Fixed rules:

- cognition must not persist a runtime-facing embedding intent, binding config,
  or derived cache that can outlive or override Runtime Agent AI Config
- RuntimeCognitionService may inspect resolved embedding readiness, bank bind
  state, rebuild state, and cutover state, but those projections must carry or
  trace to the Runtime Agent AI Config `config_revision`
- standalone cognition may keep standalone configuration for non-runtime use, but
  that configuration is not imported as Runtime Local Agent truth
- runtime bridge adapters must fail closed when the committed `text.embed` intent
  cannot resolve to an admitted embedding execution path

---

<!-- source: .nimi/spec/cognition/kernel/runtime-upgrade-contract.md -->

# Cognition Runtime Upgrade Contract

> Owner Domain: `C-COG-*`

## C-COG-037 Runtime Capability Upgrade Matrix

The authoritative runtime-to-cognition upgrade matrix is
`tables/runtime-capability-upgrade-matrix.yaml`.

Fixed rules:

- every overlap concern inherited from runtime memory or runtime knowledge must
  appear exactly once in the upgrade matrix
- every matrix row must declare runtime source contract, runtime capability,
  cognition owner surface, parity mode, required floor, admitted shape, and
  forbidden downgrade
- runtime source contracts may point either to the absorbed
  `RuntimeCognitionService` authority now recorded under `K-MEM-*` / `K-KNOW-*`
  or to explicit retained runtime-private depth when that deeper floor remains
  outside the public replacement topology
- upgrade-matrix rows govern capability closure, not package similarity or
  terminology reuse
- if a runtime overlap concern is missing from the matrix, cognition must not
  claim completion for that capability family

## C-COG-038 Capability Parity Interpretation

Standalone cognition uses capability parity, not method-name parity, when
upgrading runtime memory and runtime knowledge.

Fixed rules:

- standalone-native API naming is admitted only when each overlapping runtime
  concern remains explicitly mapped to an equal-or-stronger cognition surface
- runtime topology replacement does not permit the matrix to hide retained
  runtime-private depth behind a vague "future cleanup" story
- `parity` means cognition preserves runtime semantic floor without weakening
  fail-closed behavior
- `upgrade` means cognition strengthens the runtime concern while still making
  the overlap mapping explicit
- `explicitly_out_of_scope` is admitted only when the matrix declares why the
  omitted runtime concern does not damage standalone cognition completeness
- a smaller or vaguer cognition surface must not claim parity solely because the
  overall project is “standalone”

---

<!-- source: .nimi/spec/cognition/kernel/skill-service-contract.md -->

# Cognition Skill Service Contract

> Owner Domain: `C-COG-*`

## C-COG-056 Skill Service Operation Registry

The authoritative standalone cognition skill operation registry is
`tables/skill-service-operations.yaml`.

Fixed rules:

- every admitted skill service operation must appear in the registry exactly
  once
- every registered skill operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- skill capability admission must be grounded in this registry rather than
  inferred from envelope shape or package naming alone

## C-COG-057 Skill Lifecycle, Retrieval, And History Semantics

Standalone cognition skill owns local advisory bundle lifecycle and retrieval.

Fixed rules:

- skill save/update semantics must remain explicit for one bundle in one
  cognition scope
- validated skill bundles must require non-empty ordered steps and fail-close
  on duplicate step identity, duplicate order, illegal refs, or illegal scope
  crossing
- explicit delete semantics are required for skill ownership; digest-triggered
  lifecycle transitions must remain archive/remove outcomes rather than hidden
  hard delete
- skill list/search surfaces must exclude removed bundles by default, while
  load/history must keep removed lifecycle outcomes explicitly observable until
  explicit delete
- skill history must expose created, updated, archived, removed, and deleted
  transitions rather than forcing clients to infer lifecycle from current
  bundle snapshot alone

## C-COG-058 Skill Non-Ownership Boundary

Standalone cognition skill remains separate from runtime execution
orchestration.

Fixed rules:

- skill service does not own runtime scheduler truth, provider/tool routing,
  automation execution policy, or control-plane state
- standalone skill lifecycle and retrieval semantics do not authorize cognition
  to absorb runtime execution-policy or workflow ownership
- validated skill artifacts may participate in prompt serving and digest
  cleanup, but that does not make cognition a runtime automation owner

---

<!-- source: .nimi/spec/cognition/kernel/surface-contract.md -->

# Cognition Surface Contract

> Owner Domain: `C-COG-*`

## C-COG-026 Root Constructor Surface

The root standalone cognition constructor surface is defined by `tables/public-surface.yaml`.

Fixed rules:

- `New` is the admitted standalone root constructor
- admitted constructor options may configure standalone-local behavior, but must not introduce runtime semantic dependency
- constructor success means the standalone store, refgraph authority, transient working-state lane, and public subservices are all ready

## C-COG-027 Root Facade Surface

The root `cognition.Cognition` facade must remain exact and owner-true.

Fixed rules:

- the admitted root facade methods are:
  - `KernelService`
  - `MemoryService`
  - `KnowledgeService`
  - `KnowledgeScopeRegistry`
  - `AppMemoryAccessService`
  - `SkillService`
  - `WorkingService`
  - `PromptService`
  - `KernelEngine`
  - `NewRoutineContext`
  - `InitScope`
  - `DeleteScope`
  - `ListScopes`
  - `Close`
- digest facade methods, compatibility wrappers, and optional capability claims without real wiring are not admitted
- root facade growth requires cognition kernel admission rather than convenience aggregation

## C-COG-028 Kernel Public Surface

Kernel public surface is narrow and explicit.

Fixed rules:

- `KernelService` admits only kernel initialization, typed load, and engine access
- direct kernel mutation remains governed by the admitted kernelops surface rather than ad hoc service helpers
- root `KernelEngine` exposure does not authorize bypass of kernel validation or commit semantics

## C-COG-029 Advisory Family Service Surfaces

Advisory family services must keep artifact truth and derived serving truth distinct.

Fixed rules:

- `MemoryService` admits raw artifact save/load/list/search, explicit delete, explicit history/lineage read, and derived view reads
- `KnowledgeService` admits typed page lifecycle, lexical retrieval, lexical-plus-vector hybrid retrieval, first-class relation graph ownership, ingest/progress lifecycle, and history reads over validated knowledge projections
- `SkillService` admits typed bundle save/load/list/lexical-search, explicit delete, and explicit history reads over validated skill artifacts
- `WorkingService` admits only `Save`, `Load`, and `Clear` over transient working state
- advisory family services must not silently inherit runtime review, replication, or event-stream ownership

## C-COG-030 Derived View And Prompt Surface

Prompt serving must consume owner-true surfaces.

Fixed rules:

- derived serving views remain service-owned outputs rather than caller-owned stored truth
- `MemoryService` derived views carry service-owned support, lineage, invalidation,
  and cleanup posture; callers must not persist those fields as raw memory truth
- `PromptService` admits `FormatCore`, `FormatAdvisory`, and `FormatAll`
- `FormatCore` serves kernel truth only
- advisory prompt formatting consumes validated advisory artifacts and derived views, not working state or routine evidence
- admitted prompt lanes and derived-input rules are defined by `tables/prompt-serving-lanes.yaml`

## C-COG-031 Routine Context Surface

The authoritative external routine entry on the standalone root is `NewRoutineContext`.

Fixed rules:

- routine context must expose typed non-kernel artifact access plus clock access
- routine context must not expose direct kernel mutation or raw store ownership as its primary contract
- one routine context is scoped to exactly one cognition scope

## C-COG-032 Routine Package And Worker Surface

Routine packages may expose explicit worker entrypoints without reintroducing facade ownership.

Fixed rules:

- worker-first entrypoints such as `digest.NewWorker(...).Run(ctx)` are admitted routine package surfaces
- routine cleanup mutation must flow through lifecycle-aware archive/remove surfaces rather than raw delete access
- low-level digest analysis/apply helpers must remain internal implementation detail rather than public execution contract
- standalone cognition must not grow a façade-owned digest pseudo-service

---
