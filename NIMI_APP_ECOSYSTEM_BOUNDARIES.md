# Nimi App Ecosystem Responsibility Entrypoint

Status: non-authoritative AI handoff.

Spec Status: alignment against existing `.nimi/spec/**`.
Authority Owner: `.nimi/spec/**`, plus nearest `AGENTS.md` for local working rules.
Work Type: alignment unless the task explicitly changes canonical ownership.
Parallel Truth: forbidden. If this file conflicts with `.nimi/spec/**`, the spec wins.

Use this file when a new AI session needs to audit or refactor Desktop, Tester, or another Nimi app without the prior discussion context.

## Required Reading Order

1. Root `AGENTS.md`.
2. Nearest app `AGENTS.md`, especially `apps/desktop/AGENTS.md` and `apps/tester/AGENTS.md`.
3. `.nimi/spec/INDEX.md`.
4. `.nimi/spec/platform/kernel/nimi-ecosystem-contract.md`.
5. `.nimi/spec/platform/kernel/nimi-app-admission-contract.md`.
6. `.nimi/spec/platform/kernel/app-slice-admission-contract.md`.
7. `.nimi/spec/platform/kernel/kit-contract.md`.
8. `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`.
9. `.nimi/spec/runtime/kernel/app-messaging-contract.md`.
10. `.nimi/spec/runtime/kernel/config-contract.md`.
11. `.nimi/spec/sdk/kernel/nimi-app-client-contract.md`.
12. `.nimi/spec/sdk/kernel/runtime-contract.md`.
13. `.nimi/spec/sdk/kernel/boundary-contract.md`.
14. `.nimi/spec/sdk/kernel/surface-contract.md`.
15. `.nimi/spec/sdk/kernel/ai-provider-contract.md`.
16. `.nimi/spec/sdk/kernel/runtime-agent-participation-client-contract.md`.

Do not start implementation before the reading set is checked against the files touched by the task.

## Responsibility Model

The default ownership chain is:

`Runtime or Realm authority -> SDK projection -> Kit reusable surface where applicable -> app consumer`

Desktop is not the default owner of platform facts. Treat Desktop as a Nimi app by default, with narrow host/bootstrap exceptions only when the spec or app-local AGENTS admits them.

Runtime owns local product authority that requires validation, admission, fail-closed state, execution, materialization, lifecycle, or audit. Examples include app storage truth, runtime app lifecycle, local execution, model routing, readiness, memory, capability facts, and runtime config.

Realm owns cloud canonical business truth and cross-device or multi-user product truth.

SDK owns typed app-facing access to Runtime and Realm. SDK may expose projections, method IDs, schemas, decoders, transport adapters, reason-code handling, developer-experience helpers, and non-authoritative client orchestration. SDK must not become a hidden truth owner.

SDK developer-experience ownership is positive but bounded: request builders, stream assemblers, structured-output helpers, framework adapters, local tool-loop coordination, mock/test transports, and app-facing facade composition may live in SDK when they are explainable as composition over admitted public surfaces. Their output is ephemeral consumer state or an explicit request to Runtime / Realm / Cognition. They must not own provider/model routing, fallback policy, durable session truth, canonical memory, app lifecycle, permission grants, audit truth, or agent execution semantics.

Kit owns reusable UI, shell, bridge, composition, token, accessibility, and headless product primitives. Apps should consume Kit before forking common UI or bridge behavior locally.

The app owns product-specific screens, user-intent wiring, view-model composition, ephemeral UI state, and product-specific data that is not Runtime-owned or Realm-owned. App Tauri code may own bounded OS helpers, but not platform authority.

## Boundary Decision Algorithm

For every Desktop or Tester behavior under audit, answer these questions before changing code:

1. Is this canonical durable truth?
   - Cross-device, social, account, entitlement, or backend workflow truth belongs to Realm.
   - Local execution, local lifecycle, app roots, capability, model, memory, readiness, or validated environment truth belongs to Runtime.
2. Is the app reading or constructing a platform path, registry, config, method ID, permission, capability, provider, model, app lifecycle state, or admission state?
   - If yes, it is probably Runtime, SDK, Kit, or spec-owned. Do not leave it as app-local logic without a written authority note.
3. Does an SDK projection exist?
   - If yes, the app must use it.
   - If no and the concept is reusable platform truth, add or extend Runtime/SDK first, then migrate the app.
4. Is the behavior reusable developer ergonomics rather than platform truth?
   - If it is a builder, parser, stream assembler, framework adapter, test harness, local tool-loop, or ephemeral client orchestration over public surfaces, it may belong in SDK.
   - If it persists durable truth, chooses provider/model routing, emits canonical events, writes memory/session/app lifecycle state, or enforces permissions, promote it to the owning Runtime / Realm / Cognition / Platform authority first.
5. Is the behavior reusable UI, shell composition, bridge plumbing, design token usage, or headless app primitive?
   - If yes, prefer Kit or scaffold-managed shell infrastructure.
6. Is the behavior truly product-specific and bounded to one app?
   - It may remain in the app only if it does not duplicate Runtime, Realm, SDK, Kit, admission, permission, or config authority.

## Desktop-Specific Audit Targets

Desktop needs extra suspicion because it historically behaved like a single privileged app. Audit these patterns first:

- Direct reads of root config, data roots, app roots, cache roots, temp roots, or product-control state outside admitted bootstrap paths.
- Renderer-local stores that become executable truth for runtime, model, provider, memory, capability, app lifecycle, chat authority, or permissions.
- Tauri commands that materialize platform data without going through Runtime/SDK or an admitted OS-helper boundary.
- Duplicate method IDs, generated client shapes, app registries, capability registries, or hardcoded platform enums.
- App-local developer helpers that should be shared SDK ergonomics, especially repeated request builders, stream parsers, typed adapter code, structured-output repair logic, local tool-loop wrappers, or test transports.
- UI primitives or shell behavior copied locally when Kit already owns the pattern.
- Desktop-only implementation of a concept that Tester or a future app also needs.

## Closed Audit Ledger

Use this ledger to avoid re-reviewing already-closed domains as fresh drift. Treat it as handoff memory only; `.nimi/spec/**` remains the authority.

Closed slices:

- Product-control typed projection: `ProductControlState`, product-control record parsers, first-run screen projection, admission projection, and recovery classification are SDK projection/DX responsibilities. Desktop consumes them through its bridge and first-run/support adapters; Tester consumes them in Settings diagnostics. Do not reclassify these helpers as app-owned unless the spec changes.
- Runtime config path: Kit shell bridge must resolve Runtime config at `~/.nimi/runtime/config.json` unless `NIMI_RUNTIME_CONFIG_PATH` is explicitly set. Root `~/.nimi/config.json` is not an active fallback truth path.
- Nimi data root: Kit `desktop_paths::resolve_nimi_data_dir` must fail closed without an admitted host data-root hook. Silent `~/.nimi/data` defaulting and `~/.nimi/desktop-paths.json` reads are legacy drift, not scaffold truth.
- Tester runtime media invocation: Tester must resolve image/video/audio requests through AIConfig selected bindings and scheduling preflight. `model: "auto"` is not an app-owned executable route token.
- Desktop Runtime Config localStorage: stored renderer state may keep UI preferences and endpoint text, but must not rehydrate local runtime inventory (`local.models` or `local.nodeMatrix`) as readiness/capability truth.
- Desktop product-control Runtime gRPC method IDs: exact gRPC method ID strings belong to Kit shell runtime bridge constants/generated method-id infrastructure; Desktop Tauri product-control code must not hardcode them locally.
- AIProfile preview/apply freshness: SDK owns the developer-experience seam for `previewApply` + `apply` with an optional `expectedBaseVersion`; Kit must pass `preview.baseVersion` through preview-gated confirm flows; Desktop and Tester host services remain the write authorities and must fail closed on stale CAS. Do not reclassify this seam as app-owned product truth.

Known remaining authority forks:

- First-run `data_root_selected` presentation still maps to the interactive Local AI phase in SDK projection to preserve current Desktop behavior, while the spec table describes it as a device/environment scan step. Treat this as an alignment task against existing spec unless product explicitly decides that immediate install-level selection is the desired canonical behavior; only then open a spec-fork.
- Desktop renderer still submits a setup-state transition derived from first-run materialization projection via `product_control_record_set_first_run_setup_state`. The backend rejects ready shortcuts, but durable non-ready setup-state ownership is still too renderer-shaped. A future Runtime/product-control owner slice should make the backend recompute the transition from Runtime evidence before writing `~/.nimi/nimi.json`.
- SDK first-run materialization still infers recovery retryability from Runtime failure details. Runtime should eventually provide typed `recoveryDisposition` / `reasonCode`; SDK should filter typed fields only.

## Dual-App Proof Rule

When extracting a Desktop responsibility into Runtime, SDK, or Kit, prove it through two consumers:

1. Desktop uses the new shared surface and removes the app-local ownership.
2. Tester uses the same shared surface in a different product flow.

The Tester implementation is not a demo. It is the consumer proof that the extracted responsibility is actually ecosystem-level.

## Required Preflight For Refactors

Before implementing a responsibility refactor, write this preflight in the session:

```text
Spec Status:
Authority Owner:
Work Type:
Parallel Truth:
Candidate Owner:
Desktop Current Behavior:
Tester Proof Path:
Files To Audit:
Expected Deletion:
Verification Gates:
```

If the candidate owner is unclear, stop at audit and produce an authority fork note instead of patching.

## Implementation Rules

- No legacy shims.
- No pseudo-success or fake fallback.
- No direct Runtime or Realm private bypass from apps.
- No provider/model hardcoding in app code.
- No app-local path construction for ecosystem storage roots when Runtime/SDK can provide a projection.
- No moving code into SDK if SDK would become the truth owner instead of a projection or developer-experience layer.
- SDK may host developer-experience helpers and non-authoritative client orchestration, but those helpers must stay ephemeral or submit explicit typed requests to Runtime / Realm / Cognition before any product truth is committed.
- Framework adapters such as Vercel AI, LangChain, Agno, or Python bridges must expose capability gaps explicitly and must not claim unsupported Runtime semantics as successful parity.
- No moving UI into Kit unless it is actually reusable across apps.
- Prefer deletion of duplicated app logic over wrapping it.

## Verification Pattern

Run the narrow gates for touched layers, then broaden if shared contracts changed:

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/desktop typecheck
pnpm --filter @nimiplatform/tester typecheck
pnpm --filter @nimiplatform/tester test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/tester/src-tauri/Cargo.toml
```

When proto, Runtime, or spec changes are touched, also run the relevant proto/spec/runtime gates from root `AGENTS.md`.
