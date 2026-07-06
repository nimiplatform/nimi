# Platform Test Governance Contract

## P-TEST-001 — Every test file is non-authoritative until classified; only spec is product authority.

Every test file is non-authoritative until classified; only spec is product authority.

## P-TEST-002 — Classification vocabulary is the closed set in `tables/test-governance-policy.yaml`; one class per test.

Classification vocabulary is the closed set in `tables/test-governance-policy.yaml`; one class per test.

## P-TEST-003 — Unclassified test file on disk is a hard failure (the ratchet).

Unclassified test file on disk is a hard failure (the ratchet).

## P-TEST-004 — Source-regex sentinels are allowed only for forbidden-import/API/copy; all others are rewrite candidates.

Source-regex sentinels are allowed only for forbidden-import/API/copy; all others are rewrite candidates.

## P-TEST-005 — Non-trusted classes require an explicit `removal_condition`; a quarantine with no exit is forbidden.

Non-trusted classes require an explicit `removal_condition`; a quarantine with no exit is forbidden.

## P-TEST-006 — `evidence_only` and `quarantine_unreviewed` may never enter release/regression gates; `live_provider_proof` skip ≠ pass.

`evidence_only` and `quarantine_unreviewed` may never enter release/regression gates; `live_provider_proof` skip ≠ pass.

## P-TEST-007 — The census (globs, excludes, helper globs) is authoritative in the policy table; the gate script is the only sanctioned census.

The census (globs, excludes, helper globs) is authoritative in the policy table; the gate script is the only sanctioned census.

## P-TEST-008 — Per-domain inventories are non-authoritative support inputs owned by the domain; a single platform vocabulary governs all (no parallel vocabulary).

Per-domain inventories are non-authoritative support inputs owned by the domain; a single platform vocabulary governs all (no parallel vocabulary).
