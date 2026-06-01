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
- Desktop Runtime Config model manifest cache: Runtime owns local model/asset inventory and readiness. Desktop must not persist or hydrate a browser/IndexedDB `model-manifests` fallback; local model lists must come from Runtime/SDK local asset projections when Runtime is reachable.
- Product-control storage directory projection: SDK owns the non-authoritative `ProductControlSelectedDataRootProjection -> ProductControlStorageDirsProjection` helper for app-facing storage display/config-sync inputs. Desktop must not keep renderer-local path separator/join/dirname helpers to derive `<nimi_data>/models`, `<nimi_data>/logs`, `<nimi_data>/cache/media`, or `~/.nimi/runtime/local-state.json`; it consumes the SDK projection through its bridge. Tester Settings consumes the same helper with fixture product-control data as the second-app proof.
- Local image runtime dependency request projection: Runtime owns local environment plan validation and materialization for image-native dependencies. SDK may own the non-authoritative device-profile-to-request helper that builds the typed `local-image-native` environment plan request over Runtime local service; Desktop must not keep app-local `stable-diffusion.cpp.{metal,cuda,cpu}` routing constants. Tester Settings consumes the same SDK helper with fixture device profile data as the second-app proof.
- Desktop product-control Runtime gRPC method IDs: exact gRPC method ID strings belong to Kit shell runtime bridge constants/generated method-id infrastructure; Desktop Tauri product-control code must not hardcode them locally.
- AIProfile preview/apply freshness: SDK owns the developer-experience seam for `previewApply` + `apply` with an optional `expectedBaseVersion`; Kit must pass `preview.baseVersion` through preview-gated confirm flows; Desktop and Tester host services remain the write authorities and must fail closed on stale CAS. Do not reclassify this seam as app-owned product truth.
- First-run materialization ownership: Runtime provides typed dependency job `reason_code` and `recovery_disposition`; SDK first-run materialization projections consume only those typed fields; Desktop backend recomputes first-run setup-state transitions from Runtime evidence instead of accepting renderer-submitted product-control setup-state truth; Tester Settings consumes the same projection and recovery disposition. Do not re-open this as Desktop renderer ownership unless Runtime evidence is no longer the source.
- Notification headless presentation helpers: SDK Realm notification helpers own typed Realm transport, DTO projection, and read/list request wrappers only. Reusable filter tab classification, server-filter derivation for UI tabs, badge-key derivation, and gift-review action eligibility belong to `@nimiplatform/kit/core/notifications`; Desktop notification panel and Tester Settings are the two consumers. Do not reclassify these badge/filter helpers as SDK projection or app-local logic unless `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml` changes.
- Realm agent/social read-model fail-closed behavior: SDK may fall back from agent ID lookup to handle lookup only for explicit Realm not-found responses; non-404 Realm failures must propagate. Pending friend-request profile resolution must fail closed instead of fabricating placeholder social contacts. World banner enrichment remains additive SDK DX and may return the original profile, but it must not be treated as canonical world truth by apps.
- Desktop Agent Chat anchor binding: Runtime owns durable Agent anchor/session truth. Desktop may keep an in-memory same-renderer binding only to bridge the just-opened anchor before Runtime conversation summaries refresh; it must prefer Runtime summaries when present and must not persist or hydrate `localAgentRef -> conversationAnchorId` from browser storage. Smoke tests may inspect the in-memory binding and must verify the Runtime anchor through SDK smoke verification before accepting it.
- Desktop offline cache/outbox split: Realm owns Chat/Social commit truth. D-OFFLINE admits a Desktop shell/scaffold outbox only as a pending intent transport; it is not Realm truth and must flush through Realm/SDK public APIs. `OfflineCacheManager` is restricted to D-OFFLINE-005 read-model caches; chat/post-interaction pending mutation storage belongs to `OfflineOutboxManager`. Generic social outbox must not carry Friendship, AgentFriend, LocalAgent provision, or LocalAgent termination intent; those mutations fail closed offline unless Realm Social provides a backend-authored durable intent. Do not put durable mutation queue methods back on the cache manager or a revived DataSync facade.
- SDK routeDecision evidence projection: Runtime owns canonical route decision evidence. SDK runtime helpers, convenience wrappers, and AI provider adapters may project Runtime-provided `CLOUD` or `LOCAL` into app-facing metadata, but missing or `UNSPECIFIED` Runtime evidence must remain absent. SDK must not synthesize `local` route truth for missing `routeDecision`, including stream finish metadata and `ai.route.decision` telemetry.
- Kit model picker selection boundary: Kit may preview/highlight the first available model candidate for UI continuity, but it must not call `onSelectModel` or `onSelectionChange` for that candidate automatically. Committed route selection truth must come from explicit user/caller action or from Runtime/SDK selected-binding evidence. Desktop and Tester continue to write AIConfig only from explicit picker selections.
- Kit Tauri runtime bridge metadata identity: `kit/shell/tauri` must not default missing Runtime bridge metadata to Desktop identity. Shared bridge metadata must require explicit app identity from the SDK/app caller, may derive participant/caller IDs from that explicit app ID, and must fail closed when `appId` is absent. Desktop and Tester consume the same shared bridge; app branding belongs in app/SDK metadata inputs, not Kit fallback truth.
- Memory embedding editable config boundary: `.nimi/spec/runtime/kernel/rpc-surface.md` states that memory embedding editable config is not a `RuntimeCognitionService` public method family and that live-config read/write remains a host-local typed surface. Desktop may own the host-local adjacent config surface and persistence for binding intent; SDK owns the typed config shape/projection and Runtime private-path helpers; Runtime/Cognition own resolved state, canonical bind, rebuild, and cutover facts. Do not migrate this local editable config blindly into Runtime/Cognition unless the spec changes.
- Desktop runtime bridge generated shape / unary codec residue: generated Runtime bridge proto/method shapes, method-id constants, and reusable unary payload encode/decode helpers are owned by `kit/shell/tauri`. Desktop must consume `nimi_shell_tauri::runtime_bridge` and must not keep `apps/desktop/src-tauri/src/runtime_bridge/**` generated files, `.gitignore` masks for that directory, a local `mod runtime_bridge`, hardcoded Runtime method ids, or app-local generic base64/prost unary bridge helpers. Tester Tauri consumes the same Kit unary codec helper as the second-app proof.
- Platform projection materializer boundary: Kit owns governed Platform projection materializers for installed catalog-derived files such as `~/.nimi/apps/registry.json` and `~/.nimi/profiles/factory-index.json`. The materializer may write only when the projection is absent, must return typed repair for corrupt/future-schema files without overwrite, and must be reusable by Tester. Desktop product-control pointers may only resolve discoverability paths; Desktop Apps bridge may invoke the Kit materializer at the consumer boundary.
- Apps package readiness boundary: Runtime `GetAppStorage` is the only source for app `data/cache/tmp` roots and active release root (`K-APP-022`), and Runtime `GetAppPackageReadiness` is the only source for active release / install evidence package readiness (`K-APP-023`). Kit/Desktop must not scan `<nimi_data>/apps/**/install-evidence.json` or bridge SDK install-evidence rows. `~/.nimi/apps/packages.json` is only a discoverability pointer/schema artifact unless a future spec re-admits a Runtime-authored projection writer. Desktop Apps status uses SDK `loadPackageReadiness` backed by Runtime app lifecycle; Tester Settings proves the bridge parser without install evidence and Tester Tauri consumes the shared Kit bridge projection.

Known remaining authority forks:

- None currently recorded in this handoff file.

Continue to treat this as non-authoritative memory; if a future audit finds a conflict with `.nimi/spec/**`, the spec wins and this ledger must be corrected.

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
