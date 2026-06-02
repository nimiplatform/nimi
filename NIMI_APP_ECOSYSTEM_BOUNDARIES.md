# Nimi App Ecosystem Responsibility Entrypoint

Status: non-authoritative AI handoff.

Authority lives under `.nimi/spec/**`, plus the nearest `AGENTS.md` for local
working rules. If this file conflicts with spec, the spec wins. Keep this file
small: it is an entry card for app-boundary review, not a history log.

## Read First

Before high-risk Desktop, Tester, SDK, Kit, Runtime, Realm, or Cognition
boundary work, read:

1. `AGENTS.md`
2. nearest app `AGENTS.md`
3. `.nimi/spec/INDEX.md`
4. `.nimi/spec/platform/kernel/nimi-ecosystem-contract.md`
5. `.nimi/spec/platform/kernel/nimi-app-admission-contract.md`
6. `.nimi/spec/platform/kernel/app-slice-admission-contract.md`
7. `.nimi/spec/platform/kernel/kit-contract.md`
8. `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`
9. `.nimi/spec/runtime/kernel/app-messaging-contract.md`
10. `.nimi/spec/runtime/kernel/config-contract.md`
11. `.nimi/spec/sdk/kernel/nimi-app-client-contract.md`
12. `.nimi/spec/sdk/kernel/runtime-contract.md`
13. `.nimi/spec/sdk/kernel/boundary-contract.md`
14. `.nimi/spec/sdk/kernel/surface-contract.md`
15. `.nimi/spec/sdk/kernel/ai-provider-contract.md`

## Responsibility Model

Default chain:

`Runtime or Realm authority -> SDK projection/DX -> Kit reusable primitive -> app consumer`

- Runtime owns validated local execution, lifecycle, readiness, jobs, provider
  and model routing, app lifecycle, local memory authority, audit, and
  fail-closed enforcement.
- Runtime Agent Chat is Runtime Agent lifecycle. It depends on
  `RuntimeAgentService`, explicit agent identity, `ConversationAnchor`, agent
  memory policy, turn planning, presentation/action projection, and agent
  events.
- Ordinary app AI sessions are not Runtime-owned by default. Runtime owns the
  AI consume substrate; app or Realm owns product session truth unless spec
  admits another owner.
- Realm owns cloud canonical business truth, account/social/group truth, and
  cross-device domain commits.
- Cognition owns admitted cognition records, memory/knowledge access policy,
  and cognition substrate semantics where spec admits it.
- SDK owns typed app-facing access, parsers, schemas, request builders, stream
  assemblers, structured-output helpers, framework adapters, test harnesses,
  mock transports, and non-authoritative client orchestration. SDK must not own
  platform truth.
- Kit owns reusable UI, shell, bridge, accessibility, token, and headless
  product primitives. Kit must not own app-specific product behavior.
- Apps own product-specific screens, user-intent wiring, view-model
  composition, ephemeral UI state, bounded OS helpers, and product data that is
  not Runtime/Realm/Cognition-owned.

## Boundary Decision Algorithm

For each Desktop or Tester behavior under audit:

1. If it is canonical durable truth, assign it to Runtime, Realm, Cognition, or
   Platform before touching SDK, Kit, or app code.
2. If it reads or constructs platform paths, registries, config, method IDs,
   permissions, capabilities, provider/model routing, lifecycle state, or
   admission state, do not leave it app-local without a written authority note.
3. If an SDK projection or DX helper exists, apps must consume it.
4. If reusable developer ergonomics are missing, SDK may own them only as
   non-authoritative composition over admitted public surfaces.
5. If reusable UI, shell, bridge, accessibility, or headless behavior is
   duplicated, prefer Kit.
6. If ownership is unclear, stop and write an authority fork note.

## Desktop Audit Targets

Audit Desktop with extra suspicion for:

- root config, product-control, data/cache/temp root, or path construction
- renderer stores that become executable truth
- Tauri commands that materialize platform facts instead of bounded OS helpers
- duplicated method IDs, client shapes, registries, decoders, or enums
- provider/model routing, model catalogs, AI execution, memory, jobs, sessions
- SDK DX copied into app code
- Kit UI, bridge, shell, token, accessibility, or headless primitives copied
  into app code
- Desktop-only implementations that Tester or another Nimi app also needs

## Closed Decision Index

This index prevents repeated review. It is not authority. Use the referenced
spec/code/tests as the source of truth.

- Local/platform roots: Runtime owns app storage, package readiness, and
  product-control production records; Kit owns runtime config resolution, data
  root bridge helpers, runtime bridge generated shapes, and governed projection
  materializers. Desktop commands are bridge/consumer adapters.
- First-run and AIConfig: SDK owns product-control projection, first-run
  materialization projection, storage-dir projection, AIProfile CAS DX, and
  local-image dependency request helpers. Runtime owns readiness/evidence.
  Desktop may submit explicit host evidence only where spec admits it.
- Realm and permission projections: Realm owns social/chat/account commits.
  SDK Realm helpers stay transport/projection only. Kit owns reusable
  notification presentation. Platform owns permission taxonomy and grant-state
  vocabulary; SDK may expose typed S-PERM client/mocks without grant truth.
- Chat and AI loops: Runtime Agent Chat belongs to Runtime Agent lifecycle.
  Ordinary Nimi Chat product session truth remains app/Realm unless spec
  changes. `sdk/src/ai-app/**`, Runtime Agent turn runner, and Runtime
  media/scenario job runners are SDK DX only; Runtime keeps execution, jobs,
  routing, memory, audit, and fail-closed authority.
- Kit chat and model UI: Kit owns reusable chat/headless primitives, provider
  registration, session view state, SDK-runner mapping, and model picker UI
  preview. Kit must not synthesize route/model tokens or own product session
  truth.
- Runtime/Cognition memory: host-local memory embedding config is not canonical
  memory. Runtime/Cognition own resolved state, bind/rebuild/cutover facts.
  RuntimeAgentService owns app-facing canonical agent memory bank status/bind;
  SDK only projects typed requests/responses.
- Offline, proxy, and handoff residues: Desktop offline cache/outbox is
  transport/cache only; Realm owns commit truth. Desktop HTTP proxy is a
  bounded OS/network helper. Runtime-to-Realm group handoff stays split between
  SDK Runtime candidate surface and SDK Realm commit extension.
- Resource residues: Avatar/Agent Center local resources are legal only as
  private import/configuration evidence, not launch/carrier truth. Account
  app-library/grants are Runtime Account/App lifecycle projections; Desktop
  commands remain bridge adapters.

## Dual-App Proof Rule

When extracting Desktop responsibility into Runtime, Realm, Cognition, SDK, or
Kit:

1. Desktop consumes the shared surface and deletes app-local ownership.
2. Tester consumes the same shared surface in a materially different flow.

Tester is not a demo. It is the ecosystem-level proof.

## Required Preflight

Before implementation of authority-bearing refactors, write:

```text
Spec Status:
Authority Owner:
Work Type:
Parallel Truth:
Candidate Owner(s):
Desktop Current Behavior:
Tester Proof Path:
Files To Audit:
Expected Deletion:
Verification Gates:
```

`Work Type=alignment` follows existing authority. `Work Type=redesign` changes
authority and requires `.nimi/spec/**` alignment before code.

## Implementation Rules

- No legacy compatibility path.
- No pseudo-success, fake fallback, or MVP simplification.
- No app bypass of SDK for Runtime or Realm private APIs.
- No provider/model hardcoding in app code.
- No app-local path construction for ecosystem roots when Runtime/SDK/Kit owns
  the projection.
- Do not move authority into SDK. SDK exposes typed access and DX only.
- Do not move app-specific product behavior into Kit.
- Framework adapters such as Vercel AI, LangChain, Agno, or Python bridges must
  expose capability gaps explicitly.
- Prefer deletion of duplicated app-local logic after a shared surface exists.

## Verification Pattern

Run narrow gates for touched layers, then broaden when shared contracts change:

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/desktop test
pnpm --filter @nimiplatform/tester test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/tester/src-tauri/Cargo.toml
```

When proto, Runtime, or spec changes are touched, also run the relevant
proto/spec/runtime gates from root `AGENTS.md`.
