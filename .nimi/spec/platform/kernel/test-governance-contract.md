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

## P-TEST-009 — LocalAgent behavior expectations are derived only from typed source, world, relationship, and knowledge truth.

LocalAgent behavior admission derives its fixed expectation manifest from the
admitted typed source snapshot and its canonical world, relationship, and
knowledge inputs. Deterministic facts, identifiers, hashes, boundaries, and
cross-agent leakage markers remain deterministic assertions; semantic style
and pacing are rubric-scored. A test, evaluator, app, score, or transcript may
not author or revise personality truth.

- AUTHORITY-RELATION subject=platform-test-governance action=derive object=localagent-behavior-expectations value=typed-source-world-relationship-knowledge polarity=require
- AUTHORITY-RELATION subject=test-or-evaluator action=author object=localagent-personality-truth value=denied polarity=forbid

## P-TEST-010 — Deterministic context admission and real Electron acceptance keep their existing classifications.

The deterministic context gate uses the existing `behavior_unit` T4 class and
must prove from the provider-visible Runtime request that the admitted source,
world, relationship, knowledge, transcript, and memory inputs reached their
typed lanes with the expected hashes, budget, exclusions, and exact provider
call count. Real mouse, keyboard, input, click, DOM, and screenshot acceptance
uses the existing `product_acceptance` T6 class. Neither gate creates a new
LocalAgent-specific classification or substitutes for live-provider behavior
proof.

- AUTHORITY-RELATION subject=localagent-deterministic-context-admission action=classify object=test-governance value=behavior-unit-t4 polarity=require
- AUTHORITY-RELATION subject=localagent-electron-product-acceptance action=classify object=test-governance value=product-acceptance-t6 polarity=require
- AUTHORITY-RELATION subject=provider-visible-request-capture action=prove object=localagent-context-admission value=required polarity=require

## P-TEST-011 — Real subject behavior and semantic evaluator execution use live_provider_proof T7 after environment evidence.

Real provider behavior admission runs the subject through the ordinary Runtime
Agent turn surface and the product's real application path. Subject and
semantic evaluator provider calls both use the existing `live_provider_proof`
T7 classification with release eligibility only after `after_env_evidence`;
the Electron interaction portion remains `product_acceptance`. A fixture,
canned reply, missing credential, missing route, or unavailable evaluator
cannot be renamed or counted as live behavior admission.

- AUTHORITY-RELATION subject=localagent-live-subject-and-semantic-evaluator action=classify object=test-governance value=live-provider-proof-t7-after-env-evidence polarity=require
- AUTHORITY-RELATION subject=fixture-or-canned-reply action=substitute object=live-provider-behavior-admission value=denied polarity=forbid

## P-TEST-012 — Subject and evaluator independence requires distinct complete Runtime route fingerprints.

Admission requires Runtime-produced subject and evaluator fingerprints that
each bind `providerId`, `modelId`, and a resolved model revision or model
fingerprint. The complete fingerprints must differ; any missing component,
unproven resolution, or collision blocks the batch. Provider/model selection
comes from Runtime AI Config and catalog resolution. Apps and test runners may
not call a provider or model directly, and may not embed provider/model
constants.

- AUTHORITY-RELATION subject=localagent-behavior-admission action=require object=subject-evaluator-route-fingerprints value=complete-and-distinct polarity=require
- AUTHORITY-RELATION subject=app-or-test-runner action=call object=provider-or-model-directly value=denied polarity=forbid
- AUTHORITY-RELATION subject=app-or-test-runner action=hardcode object=provider-or-model-selection value=denied polarity=forbid

## P-TEST-013 — Evaluator results are strict, calibrated, fixed-batch, and fail closed.

The evaluator input allowlist is exactly the source-derived expectation
manifest, the fixed rubric, and the subject transcript. Semantic evaluator
output must satisfy the fixed strict JSON schema; unknown fields, malformed
output, unknown scores, or reason-code mismatch fail closed. Before any subject
score is admitted, every dimension has one fixed known-pass control and one
fixed deliberate-fail control. Any control misclassification, constant scoring,
schema failure, or route collision rejects the whole batch. Thresholds,
controls, rubric, and schema are immutable within a batch, and evaluator trials
have no automatic retry.

- AUTHORITY-RELATION subject=semantic-evaluator-result action=admit object=behavior-score value=strict-json-schema-only polarity=require
- AUTHORITY-RELATION subject=behavior-evaluator-calibration action=require object=known-pass-and-deliberate-fail-controls value=every-dimension polarity=require
- AUTHORITY-RELATION subject=behavior-batch action=change object=threshold-controls-rubric-schema-after-start value=denied polarity=forbid
- AUTHORITY-RELATION subject=behavior-evaluator action=retry object=trial value=denied polarity=forbid

## P-TEST-014 — Every raw trial is retained; evaluator evidence cannot mutate product or personality truth.

Every subject, deterministic-evaluator, semantic-evaluator, calibration,
provider, transport, and schema outcome remains in the raw trial ledger and in
the original denominator. Evaluator execution and results are evidence only:
they cannot mutate Realm source, Runtime source snapshot, LocalAgent,
conversation turn/message/transcript, memory, anchor, or other product state.
An evaluator score never becomes personality truth and cannot change later
context composition or model-visible inputs.

- AUTHORITY-RELATION subject=behavior-batch-ledger action=retain object=all-raw-trials value=required polarity=require
- AUTHORITY-RELATION subject=behavior-evaluator action=mutate object=source-snapshot-localagent-transcript-memory-state value=denied polarity=forbid
- AUTHORITY-RELATION subject=evaluator-score action=become object=personality-truth value=denied polarity=forbid

## P-TEST-015 — LocalAgent acceptance uses the closed L0–L5 execution layers and their hard budgets.

LocalAgent tests use the execution-layer contract in
`tables/test-governance-policy.yaml`: L0 static/unit, L1 module
integration/contract, L2 core product journey, L3 extended/risk journey, L4
exhaustive deterministic, and L5 live behavior. The minimum sufficient layer
is selected by the product fact being proved. Enumeration, property,
schema-mutation, and high-repeat negative coverage stays in L0/L1/L4 and may
not create an Electron Cartesian product. An L2 or L3 budget breach is a test
architecture failure; increasing a timeout is not an admission remedy.

- AUTHORITY-RELATION subject=localagent-acceptance action=classify object=execution-layer value=l0-through-l5-closed-set polarity=require
- AUTHORITY-RELATION subject=enum-property-schema-mutation action=execute object=electron-cartesian-product value=denied polarity=forbid
- AUTHORITY-RELATION subject=journey-budget-breach action=resolve object=timeout-increase-only value=denied polarity=forbid

## P-TEST-016 — Acceptance points are product facts; checkpoints collect them inside pollution-bounded Journey Trials.

An acceptance point identifies one independently traceable product fact. A
checkpoint is the position inside a product Journey where one or more facts
are observed. A Journey Trial starts from one clean environment and may emit
many checkpoint and leaf results. Environment isolation follows account,
source, agent, transcript, memory, destructive-state, and platform pollution
boundaries; it never follows leaf count. Ordinary new assertions extend an
existing checkpoint unless they require a distinct user path, state machine,
initial subject, destructive boundary, recovery boundary, or native platform.
Every Journey repeat allocates fresh logical account, world, source, Runtime
source, and LocalAgent identities wherever those entities exist, and records
the observed identities in `environmentIdentity`. A fresh filesystem root does
not admit a repeat that reuses logical product identity.

- AUTHORITY-RELATION subject=acceptance-point action=identify object=product-fact value=independently-traceable polarity=require
- AUTHORITY-RELATION subject=journey-trial action=emit object=leaf-results value=many-per-clean-environment polarity=require
- AUTHORITY-RELATION subject=leaf-count action=determine object=environment-process-starts value=denied polarity=forbid
- AUTHORITY-RELATION subject=journey-repeat action=allocate object=logical-product-identities value=fresh-and-observed polarity=require

## P-TEST-017 — Acceptance catalog, Journey registry, and execution policy are separate non-authoritative support inputs.

The acceptance-point catalog owns leaf identity, iteration owner, group,
requirement, assertion identity, minimum sufficient layer, and evidence class.
The Journey registry owns environments, prerequisites, checkpoints, leaf
coverage, isolation, repeats, and budgets. The execution policy owns local,
PR, stability, extended, exhaustive, and live gate selection. No file may mix
these ownership roles. All 169 LocalAgent leaves remain catalogued; I7 owns
145 deterministic leaves, while the 24 P leaves remain I8-owned L5 structure
and produce no I7 result, pass, skip, or blocked record.

- AUTHORITY-RELATION subject=localagent-test-support-inputs action=separate object=catalog-journey-policy value=required polarity=require
- AUTHORITY-RELATION subject=i7-execution action=emit object=i8-p-leaf-result value=denied polarity=forbid
- AUTHORITY-RELATION subject=localagent-leaf-catalog action=retain object=leaf-identities value=169 polarity=require

## P-TEST-018 — Journey results, checkpoints, leaf results, artifacts, and prerequisite outcomes fail closed.

Every Journey result binds source state, environment identity, duration,
checkpoints, leaf results, artifacts, process problems, privacy, and outcome.
Each checkpoint binds prerequisites, timestamps, Runtime/source/agent/turn
correlations, assertions, artifact references, and outcome. Each leaf result
binds its Journey Trial, checkpoint IDs, assertion IDs, evidence references,
outcome, and failure class. A failed prerequisite makes every dependent leaf
`failed` or `blocked_by_failed_prerequisite`; neither blocked, skipped,
missing, nor unexecuted can count as pass. Artifact hashes, source digests,
privacy, process errors, and provider-visible lane evidence are admission
inputs, not optional diagnostics.

- AUTHORITY-RELATION subject=failed-checkpoint-prerequisite action=permit object=dependent-leaf-pass value=denied polarity=forbid
- AUTHORITY-RELATION subject=blocked-skipped-missing-unexecuted action=count object=acceptance-pass value=denied polarity=forbid
- AUTHORITY-RELATION subject=journey-evidence action=bind object=source-artifact-privacy-process-provider-integrity value=required polarity=require

## P-TEST-019 — Required regression gates are Journey-based and budget-enforced; leaf-per-process is forbidden.

The required local/PR path runs L0+L1+one L2 core Journey within the policy
budget. Core stability runs three independent L2 Journey Trials; extended
and exhaustive gates run only their policy-selected work. L5 live behavior is
separate and never blocks ordinary deterministic feedback. A required runner,
package script, checker, or fallback that starts a complete
Runtime/Desktop/Zhiyu environment once per leaf is forbidden. Process-start
counts must match the Journey environment declaration, not `leaf × repeat`.

- AUTHORITY-RELATION subject=required-local-pr-gate action=run object=l0-l1-l2-core value=budget-enforced polarity=require
- AUTHORITY-RELATION subject=required-runner action=start object=full-environment-per-leaf value=denied polarity=forbid
- AUTHORITY-RELATION subject=process-start-count action=derive object=journey-environment-declaration value=required polarity=require
