# Runtime Config Contract

> Owner Domain: `K-CFG-*`

## K-CFG-001 Canonical Config Path

Production Runtime configuration is service-principal-owned state at the
OS-profile-specific protected location in
`tables/protected-local-runtime-principal-profiles.yaml`. Its physical path is
not a Desktop/SDK/public CLI interface and is never projected to renderer or
app callers. `~/.nimi/runtime/config.json`, `~/.nimi/config.json`, and any other
user-writable file are forbidden production inputs. This pre-release hardcut
imports no retired config or credential material.

The non-release development updater has one narrower, non-Runtime exception:
before invoking the signed installer it may read only the exact `dataRootRef`
field from the current `~/.nimi/runtime/config.json` and promote that value to
an explicit installer selection. The Runtime service never reads that file,
none of its other fields enter protected configuration, and a missing,
malformed, relative, volume-root, or inaccessible value fails before build or
installation. This is updater input selection, not production Runtime config
authority or a compatibility fallback.

## K-CFG-002 Source Priority

Production source authority is the closed partition in
`tables/config-schema.yaml`: signed OS service/release boot security,
service-owned immutable/mutable state, Runtime-private secret custody, then
spec-governed defaults where the field permits a default. Environment
variables, argv, user-writable config, renderer metadata, and app manifests
have no production selection priority because they are rejected inputs.

## K-CFG-003 Schema Version

Service-owned state must contain `schemaVersion`, currently `1`. Every field
belongs to exactly one production authority class. Unknown fields are rejected;
they are never ignored for forward compatibility.

## K-CFG-004 Provider Name Canonicalization

配置中的 provider 名称必须使用 `provider-catalog.yaml` 的 canonical 值，alias 与 legacy 名称必须拒绝。

## K-CFG-005 Secret Policy

Provider records may contain only an opaque `credentialRef`. The referenced
material is created and resolved inside Runtime service-principal custody.
Inline `apiKey`, `apiKeyEnv`, process-environment lookup, user-session generic
keyring/vault storage, renderer projection, and app-provided secrets are
forbidden production shapes.

## K-CFG-006 Atomic Write

Runtime writes service-owned non-secret state with fail-closed atomic replace,
owner-only ACLs, symlink/reparse-point refusal, and durability appropriate to
the OS profile. Secrets use the protected custody backend defined by
K-ACCSVC-007 and `tables/protected-local-custody-profiles.yaml`; they are never
serialized into the non-secret state document.

## K-CFG-007 Runtime Command Surface

Production configuration is mutated only through typed protected control owned
by Runtime. Desktop may receive redacted typed status and may request an
admitted mutation; public CLI `config init/get/set`, arbitrary JSON patching,
physical-path access, and whole-document reads are not production surfaces.
Any retained command is a separately signed synthetic non-product fixture and
cannot provide product evidence.

## K-CFG-008 Validation Fail-Close

配置校验失败必须 fail-close，不得以部分成功继续启动核心路径。

## K-CFG-009 Provider Env Binding

`provider-probe-targets.yaml` environment bindings are non-product probe
fixtures only. Production provider endpoint and credential selection comes
from Runtime-owned connector/provider state; an environment variable can
neither create nor override a production provider record.

## K-CFG-010 Hot Reload Boundaries

配置变更的热生效与重启生效边界必须显式声明，不允许隐式生效。

已声明的边界：

- Service-owned Runtime configuration follows the per-field `restart`, `hot`,
  or `immutable` disposition in `tables/config-schema.yaml`; callers cannot
  infer reload behavior from a physical document.
- Runtime Agent AI Config（K-AGCORE-144~150）不属于本契约的 machine
  config plane。它经 RuntimeAgentService RPC 持久化于 runtime store，热生效，
  粒度为 next-turn：变更不影响 in-flight turn 的 execution snapshot。

## K-CFG-011 Credential Plane Boundary

Configuration may carry opaque credential references only. Interactive product
credential capture terminates at a Runtime-owned protected connector/control
operation, which stores the credential under the isolated Runtime principal
and returns only redacted typed state. Desktop, public CLI, SDK, and app callers
must not persist, cache, replay, or re-submit raw credential material after that
operation. There is no inline-memory or user-file success fallback.

Source materialization proof verification uses the configured Realm issuer and
JWKS trust chain plus a closed materialization-purpose signing-key registry.
Runtime accepts only detached JWS with `alg=RS256`, a JWK with `use=sig`, and a
`kid` admitted for the materialization purpose. An unknown `kid` may trigger one
controlled JWKS refresh; unknown, removed, revoked, wrong-purpose, wrong-use, or
wrong-algorithm keys fail closed. Active and retiring verification keys follow
the Realm rotation window, while a revoked key is rejected immediately.

No source-materialization shared verifier secret belongs in Runtime machine
config. Desktop, SDK, Kit, apps, packet fields, and provider metadata cannot
supply or override issuer, JWKS, key purpose, or proof verification truth. The
materialization-purpose registry is verification policy, not a credential
projection or caller-extensible free-form map.

## K-CFG-012 Default Value Governance

默认值必须在 kernel 表格中有可追溯来源，不允许散落在实现层文档。

## K-CFG-013 Cross-Layer Projection

Desktop/CLI/SDK 对 runtime 配置行为的投影必须与本契约保持语义一致。config 允许声明：

- top-level `defaultLocalTextModel`，用于覆盖 bundled local default text target
- top-level `defaultCloudProvider`
- provider-scoped `defaultModel`

其中 machine-default cloud target 由 `defaultCloudProvider + provider.defaultModel`
形成。

- Runtime Agent AI Config alias bindings consume admitted default target
  aliases rather than copying concrete targets into every agent record. The
  default alias family includes `local/default`, capability-specific local
  defaults, `local/default-embedding`, and `cloud/default`.
- Changing a default alias target is an admitted app-facing Runtime config
  mutation surface with explicit scope, audit, and Runtime Agent AI Config
  readiness recompute. Alias-bound agents observe the new target on their next
  turn; pinned agents are unaffected. This package records the authority only;
  implementation of the mutation RPC and Agent Center Model UI is a separate
  follow-up package.

- 对 `static_source` provider：当 provider 未显式覆盖 `defaultModel` 时，
  higher-level surface 可以回退到 provider catalog 的
  `default_text_model`。
- 对 `dynamic_endpoint` provider：higher-level surface 不得回退到 provider
  catalog `default_text_model`。必须使用显式 `provider.defaultModel`，或由
  UI/route 提供 live-selected model；若两者都缺失，runtime 必须 fail-close。

`nimi run --cloud`、provider-only high-level CLI/SDK 等 surface 不得绕过这组
配置语义。

## K-CFG-014 Service Schema Transition Framework

Future service-owned schema transitions require an admitted release transition
plan with exact `from_version`, `to_version`, field changes, defaults,
anti-rollback rules, and fail-closed conditions. They operate only on state
already owned by the isolated Runtime principal. This pre-release cutover does
not import, inspect, back up, or transform user-session/retired configuration.

## K-CFG-015 Transition Execution Semantics

The signed Runtime release performs any admitted service-owned transition
before protected listeners open. It is deterministic, idempotent, atomic, and
anti-rollback anchored. Failure leaves no partially admitted state and keeps
the service unavailable. Desktop/CLI/SDK never execute or select transitions.

The signed `dev_kernel_checkpoint` profile is a closed non-release exception,
not a production schema transition. Its binary identity and durable development
state identity are separate. `runtimeCandidateId` binds the exact current
signed build record but never selects the state partition. On first installation
the installer creates a cryptographically random `acceptanceRoundId` and records
the then-current candidate as `developmentStateCandidateId`; together with the
bounded trial id these fields form the durable development state lineage.

An ordinary signed Runtime update must preserve that exact lineage. Product
Control, Runtime identity, local-app kernel state, durable grants, model
registry, audit state, and service-owned mutable config therefore survive a
binary candidate rotation instead of being silently replaced by an empty
candidate directory. Account token custody and durable local-project consent
remain in their independently stable protected stores. A new lineage may be
created only by an explicit destructive repair/reset operation, never merely by
installing a new candidate, restarting Desktop, or rotating the Runtime boot
epoch. Malformed or unavailable lineage state fails the update closed; the
installer does not guess a new directory.

Payload reuse still does not imply readiness by file presence. The updated
candidate must verify its current catalog hashes, manifests, and activation
requirements, but unchanged verified payloads are not downloaded again.
Existing or partially damaged records retain the normal Product Control
repair/fail-closed path. Production configuration, HOME/TEMP, renderer state,
environment, argv, endpoint selection, and request payloads cannot activate or
reset the development lineage.

The signed installer preserves an existing non-empty explicit development
`nimi_data` binding when it rotates the binary candidate, unless the operator
supplies a different explicit binding to that installer invocation. The
development updater may obtain that explicit value only from the bounded
`dataRootRef` read described by K-CFG-001. The installer validates and records
the exact path; the Runtime service does not read the user file. A missing,
malformed, inaccessible, or reparse-point binding fails the update closed
instead of silently falling back to a candidate-specific payload root.

The same profile binds account OAuth, token exchange, JWT issuer, JWKS, and
revocation to one exact real Realm development deployment so the checkpoint
exercises a controlled production account through Runtime custody. The binding
is installer-owned and candidate-bound; user environment, argv, renderer state,
or a request cannot select it. Its loopback fixture origin is a separate
non-authorizing field used only for the signed non-release provider seed. A
shared Realm/provider endpoint field, fixture-issued account token, automatic
fixture authorization redirect, alias, or fallback is forbidden.

For First Run acceptance, Runtime may additionally project one visible
`nimi_data` proposal. When the signed installer recorded an explicit absolute
development data-root binding, that candidate-bound protected profile field is
the proposal and the Runtime data-plane roots resolve below it. Otherwise the
proposal is derived from the verified interactive Windows SID's OS profile
mapping, the signed trial id, and the build-record-verified Runtime candidate
id. The proposal is not a Product Control record field and cannot select the
data root or create readiness; explicit confirmation through the normal typed
Product Control operation is still required. The protected service cannot
derive the binding from HOME, USERPROFILE, TEMP, renderer state, environment,
argv, endpoint, or a Runtime request payload. The signed installer must reject a missing,
non-absolute, volume-root, reparse-point, or inaccessible explicit binding.
The installer may source that exact field from the preceding protected profile
when rotating a candidate, subject to the same validation. The development
updater may instead pass the canonical user-config `dataRootRef` as an explicit
selection, but the installer and Runtime never consume any other user-config
field.

### First-party product acceptance build profile

The developer-signed `first_party_product_acceptance` build profile is a
separate closed, non-release, non-promotable exception for installed-product
acceptance against the admitted local Realm development deployment. It changes
only the Runtime account Realm, OAuth, token, issuer, JWKS, and revocation base
from the release-fixed `https://realm.nimi.ai` to the build-fixed
`http://localhost:3002`. The exact profile identity is compiled into the signed
Runtime binary, recorded in its source-bound build record, and must match an
explicit signed-installer mode. Environment, argv, mutable service state,
renderer input, and arbitrary installer endpoint input cannot select or alter
that endpoint.

This profile does not admit a fixture, seed, provider endpoint, model default,
data-root selection, alternate service principal, compatibility path, or
dev-kernel checkpoint state. It uses ordinary product configuration and state
semantics apart from the exact local Realm endpoint projection. A release
`production_build` continues to use only `https://realm.nimi.ai`, and a
`dev_kernel_checkpoint` candidate remains the only build that may carry its
separately bounded provider fixture and seeded checkpoint identity.

## K-CFG-016 Transition Backup & Drift Boundary

Automatic backups cannot restore older security-critical generations, executable trust,
listener, or custody authority. Recovery material is version-bound and
service-principal protected; restoration requires the same or newer admitted
installer-owned active release. User files and old generic keyring/vault entries are not
recovery inputs.

## K-CFG-017 Phase 1 Field Authority

Production Runtime fields and their authority classes are defined by
`tables/config-schema.yaml`. The table records type, default, reload semantics
(`restart`/`hot`/`immutable`), source rule, closed field partition, forbidden
inputs, and redaction boundary.

配置字段的新增或修改必须先更新 `tables/config-schema.yaml`，再同步相关合约文档。

## K-CFG-018 Data Root Reference And Service Posture Boundary

Runtime service-owned state may store `dataRootRef` and derived managed roots for models,
dependencies, environments, logs, and audit. These fields are Runtime-owned
daemon/materialization configuration and must be reconciled from the product
control record selected `nimi_data`.

Runtime config also owns its own daemon identity and service posture:

- `runtimeId` is the stable local Runtime daemon identity. It is generated once
  by the service and is immutable for the lifetime of service-owned state.
- `localService.enabled` and `localService.mode` declare the Runtime local
  service posture. `localService.mode` is restricted to the closed value
  `desktop-local` for the on-device Phase 1 product.

Runtime config does not own first-run product state, install level, account app
library, account profile library, permission grants, or app durable data.
The product-control service may project selected `nimi_data` through an exact
typed protected operation. Conflicts fail closed; Runtime never reads the
user-writable product-control file as configuration truth.

On Windows, before that exact mutation is sent, the verified native Desktop
host must prepare the user-selected data-plane root through the shared Kit OS
adapter. Preparation preserves the interactive user as the root owner, rejects
a reparse-point root, and grants inheritable modify authority only to the exact
restricted `NT SERVICE\NimiRuntime` service SID needed for Runtime-managed
children. Runtime still independently validates the absolute path, creates the
closed managed-root layout, and owns the service-state write. Renderer code may
neither name a SID nor mutate an ACL, and an environment variable, endpoint,
direct daemon, broad principal grant, or test-only service identity cannot
satisfy this handoff. Failure to prepare or validate the root leaves
`dataRootRef` empty and first-run blocked.

The Runtime page `Environment` surface reads the `nimi_data` data-plane roots
(`models`, `dependencies`, `environments`, `logs`, `audit`) as a Runtime-owned
read-only data model derived from `dataRootRef` and `managedRoots`; it does not
introduce a second config authority.

The data-plane roots are also the only admitted install location for Runtime
local environment materialization. `local-environment-dependencies.yaml` binds
each dependency family to one of these root ids through its `managed_root`
field: `models` for model and companion asset payloads, `dependencies` for
standalone downloaded dependency payloads (the `uv` tool, the shared
accelerator/CUDA runtime), and `environments` for Nimi-managed executable
environment trees (native engine packages, the managed Python interpreter,
venvs, package sets, Torch wheels). The engine manager, native engine package
installers, and Python dependency materializers must resolve their install root
from `dataRootRef` / `managedRoots` and must not use `~/.nimi/engines` or any
other home-directory root. When `dataRootRef` is empty the managed install
fails closed into product setup rather than guessing a path.
