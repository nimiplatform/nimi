# Decision Review: Release Gate Owner Namespaces For App Tools And Tester

decision_review_id: decision-review-release-gate-app-tools-tester-owners
date: 2026-06-28
disposition: superseded
decision: Admit `app-tools` and `tester` as release-gate owner namespace segments under P-RELG-008 so scaffold publication safety and dual-shell proof-app parity can be registered as first-class platform release gates.
replaced_scope: Release gate owner allow-list did not contain namespaces for app authoring scaffold gates or tester proof-app shell parity gates.
active_replacement_scope: `.nimi/spec/platform/kernel/release-gate-contract.md` P-RELG-008 plus `scripts/lib/release-gate/registry-loader.mjs` OWNER_ALLOWLIST admit `app-tools` and `tester`.

## Rationale

`@nimiplatform/app-tools` owns scaffold-managed glue and generated-app smoke proof. `apps/tester` owns the internal proof/reference app composition and must prove Electron/Tauri shell parity when used as an explicit `tester-reference` profile. Collapsing these gates under an unrelated existing owner namespace would weaken P-RELG-008 by hiding the subsystem that owns the operational evidence.

## Boundaries

- `app-tools` gates may verify scaffold authoring, generated app smoke, doctor/update safety, and template publication blockers.
- `tester` gates may verify proof-app shell parity and reference-app acceptance evidence.
- Neither namespace owns public Nimi App admission, permission grants, Runtime account/session custody, SDK transport truth, Kit shell implementation, or release descriptor truth.
- Gate rows remain platform-managed registry truth under `.nimi/spec/platform/kernel/tables/release-gate-registry.yaml`.
