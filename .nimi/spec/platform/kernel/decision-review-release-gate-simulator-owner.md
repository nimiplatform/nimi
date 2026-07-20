# Decision Review: Simulator Release Gate Owner Namespace

decision_review_id: decision-review-release-gate-simulator-owner
date: 2026-07-20
disposition: accepted
decision: Admit `simulator` as a release-gate owner namespace under P-RELG-008 so the independent Simulator artifact and build-control evidence are not mislabeled as Web, app-tools, or spec-governance gates.
replaced_scope: The release-gate owner allow-list predates the admitted P-SIM product owner and has no namespace for executable Simulator evidence.
active_replacement_scope: `.nimi/spec/platform/kernel/release-gate-contract.md` P-RELG-008 and `scripts/lib/release-gate/registry-loader.mjs` OWNER_ALLOWLIST admit `simulator`.

## Rationale

P-SIM-001 and P-SIM-020 give the Simulator its own product, build, integration-qualification, and release-evidence ownership. `app-tools` owns only App-source conformance, Web owns only the public Web product, and spec-governance owns structural authority validation. Reusing any of those gate namespaces would hide the executable owner and weaken owner/gate traceability.

## Boundaries

- `simulator` gates may verify selected-source materialization, integrated module qualification, generated registry/resolver identity, the independent artifact, and Simulator-owned tests.
- The namespace does not own App UI, Kit/SDK/Runtime/Realm truth, public Nimi App admission, permissions, publication, or arbitrary third-party loading.
- Gate rows remain Platform-managed registry truth under `.nimi/spec/platform/kernel/tables/release-gate-registry.yaml`.
