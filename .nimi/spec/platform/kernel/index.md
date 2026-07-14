# Platform Kernel Authority

## Scope

Platform kernel is the single authoritative source for cross-domain platform protocol rules.
Every platform domain document (vision, architecture, protocol, ai-last-mile, design-pattern, governance) must explicitly reference kernel Rule IDs; it must not duplicate kernel prose.

## Rule ID Format

`P-<DOMAIN>-NNN`

| Domain | Mnemonic | Kernel Document |
|---|---|---|
| `VISION` | North Star vision rules | _(domain-only, no kernel contract)_ |
| `ARCH` | Architecture contract | `architecture-contract.md` |
| `PROTO` | Protocol contract | `protocol-contract.md` |
| `ALMI` | AI Last Mile contract | `ai-last-mile-contract.md` |
| `AISC` | AI scope identity contract | `ai-scope-contract.md` |
| `DESIGN` | Nimi design pattern contract | `design-pattern-contract.md` |
| `KIT` | Kit shared platform infrastructure | `kit-contract.md` |
| `CAPCAT` | Canonical capability catalog contract | `capability-catalog-contract.md` |
| `APP` | App-slice admission contract | `app-slice-admission-contract.md` |
| `WEB` | Web and release gateway contract | `web-release-contract.md` |
| `PKG` | Package authority admission, host-local projection, and external-host workflow boundary | `package-authority-admission-contract.md` |
| `AIPS` | AIProfile selection policy + factory catalog contract | `ai-profile-selection-policy-contract.md` |
| `HOME` | Nimi Home product entry/shell authority | `nimi-home-contract.md` |
| `SUPD` | Nimi product self-update authority | `nimi-self-update-contract.md` |
| `PKGREL` | Nimi package/release/update identity authority | `nimi-package-release-contract.md` |
| `COLD` | Cold-start authority owner split | `cold-start-authority-contract.md` |
| `NAPP` | Nimi App admission contract | `nimi-app-admission-contract.md`, `nimi-app-local-admission-contract.md` |
| `MOEX` | Mod / Extension retirement contract | `mod-extension-retirement-contract.md` |
| `AGID` | Agent identity primitive floor contract | `agent-identity-floor-contract.md` |
| `PERM` | App permission product-facing authority contract | `app-permission-contract.md` |
| `FPI` | Nimi first-party integration contract | `nimi-first-party-integration-contract.md` |
| `FPM` | Nimi first-party migration contract | `nimi-first-party-migration-contract.md` |
| `ECO` | Nimi ecosystem (third-party / world-game / engine-seam / economy / no-Steam-copy) contract | `nimi-ecosystem-contract.md` |
| `GOV` | Governance contract | `governance-contract.md` |
| `RELG` | Release gate contract (operational refinement of `P-GOV-003/011/021/023`) | `release-gate-contract.md` |
| `TEST` | Test governance and inventory | `test-governance-contract.md` |
| `MIG` | Local config migration and repair contract | `local-config-migration-contract.md` |
| `AUDIT` | Nimi App audit pipeline contract | `nimi-app-audit-pipeline-contract.md` |
| `DEV` | Nimi App developer workflow contract | `nimi-app-developer-workflow-contract.md` |
| `SCAF` | Nimi App scaffolding and app-authoring contract | `nimi-app-scaffolding-contract.md` |
| `PROP` | Nimi proposal intake contract | `nimi-proposal-intake-contract.md` |
| `DOPEN` | Running Desktop Open Intent contract | `desktop-open-intent-contract.md` |
| `AGENT-CENTER` | Reusable Kit Agent Center ownership and bounded Runtime LocalAgent projection consumption | `agent-center-contract.md` |

## Numbering Convention

| Segment | Semantics |
|---|---|
| 001–009 | Domain invariants (version negotiation, profile, primitive sovereignty) |
| 010–019 | Envelope / field rules (request format, gRPC mapping) |
| 020–029 | Authorization semantics / scope extension |
| 030–039 | Authorization policy / delegation |
| 040–049 | Catalog lifecycle / policy update |
| 050–059 | World-App product relationship |
| 060–069 | App mode domain boundary |
| 070–079 | Cross-primitive consistency / admission |
| 080–089 | Design pattern foundation / primitive contracts |
| 090–099 | Design gates / governance hardcuts |
| 100–105 | Primitive-specific rules (protocol only) |
| 110–119 | App-slice admission and subordinate authority |
| 120–129 | Web and release gateway ownership |
| 130–139 | Package authority admission and host-local projection |
| 140–149 | AIProfile selection policy + factory catalog authority |
| 150–159 | Nimi Home product entry/shell authority |
| 160–169 | Nimi product self-update authority |
| 170–179 | Nimi package/release/update identity authority |
| 180–189 | Cold-start authority owner split |
| 186–189 | First-run state machine and product-control record schema invariants |
| 190–199 | Nimi App admission authority |
| 200–209 | Mod / Extension retirement authority |
| 210–219 | Agent identity primitive floor authority |
| 220–229 | App permission product-facing authority |
| 230–239 | Nimi first-party integration authority |
| 240–249 | Nimi first-party migration authority |
| 250–259 | Nimi ecosystem authority (third-party / world-game / engine-seam / economy / no-Steam-copy) |
| 260–269 | Local config migration / repair authority (`~/.nimi` cross-file `schemaVersion`, repair routing, `nimi_data` directory ownership / cleanup) |
| 270–279 | Nimi App audit pipeline authority (publish-to-admission gate sequence, typed evidence-class composition, AI-audit triage-and-evidence-only posture, solo-reviewer classification within `P-ECO-004` bounds, `nimi audit` non-gate posture, review-evidence shape) |
| 280–289 | Nimi App developer workflow authority (developer repo layout, ordered developer workflow step sequence, developer-side `nimi audit` dry-run, immutable submission, PR-based admission workflow obligations consuming `P-NAPP-013`) |
| `P-SCAF-*` | Nimi App scaffolding authority (app-authoring ownership, A0-A5 accepted inputs, standalone/workspace-app profiles, submitted-manifest and build-profile inputs, permission declaration transparency, managed file taxonomy, `nimi-app create|init|doctor|update`, nimicoding projection ownership, local harness evidence role, app-slice exception, model-test admission dependency) |
| `P-PROP-*` | Nimi proposal intake authority (conversation-originated non-executing proposal record identity, closed proposal kind set, proposal intake state machine, owner handoff boundary, source conversation anchor reference boundary, audit transition obligation, SDK/app consumer boundary) |
| `P-DOPEN-*` | Running Desktop Open Intent authority (other-app-to-running-Desktop closed intent protocol, running-only boundary, Desktop target catalog references, sourceHost semantics, result code producer mapping, and acceptance evidence manifest requirement) |

## Document Ownership Matrix

| Kernel Document | Rule ID Range | Description |
|---|---|---|
| `protocol-contract.md` | `P-PROTO-*` | Version negotiation, envelope, app auth, primitives, error codes, compliance |
| `architecture-contract.md` | `P-ARCH-*` | Six-layer architecture, communication rules, credential planes |
| `ai-last-mile-contract.md` | `P-ALMI-*` | Hook Action Fabric, Principal model, execution protocol |
| `ai-scope-contract.md` | `P-AISC-*` | Canonical AI scope identity, lifecycle, non-inheritance, and allowed consumer boundary |
| `design-pattern-contract.md` | `P-DESIGN-*` | Cross-app Nimi UI Toolkit authority, generated primitive contract, scheme plus accent theme model, adoption registry, and hard gate |
| `kit-contract.md` | `P-KIT-*` | Kit package authority, sub-module contracts (UI, Auth, Core, Telemetry), and hard gate |
| `capability-catalog-contract.md` | `P-CAPCAT-*` | Canonical capability catalog cross-layer identity authority, runtime source resolver semantics, deferred entry admission |
| `app-slice-admission-contract.md` | `P-APP-*` | App-local spec admission, subordinate authority scope, evidence roots, and audit expansion rules |
| `web-release-contract.md` | `P-WEB-*` | Web surface, install gateway, Cloudflare adapter, and release evidence ownership |
| `package-authority-admission-contract.md` | `P-PKG-*` | Package-local spec admission, package-vs-host projection boundary, audit expansion, external AI host workflow ownership, and nimi-coding orchestration hardcut |
| `ai-profile-selection-policy-contract.md` | `P-AIPS-*` | Platform-owned factory AIProfile catalog + AIProfile selection policy authority, dimensioned alias matrix, apply chain into `AIProfile`/`AIConfig`/`AISnapshot`, selection policy inputs/outputs, cloud/local/hybrid/privacy posture rules, materialization projection contract, no-provider-model-constant guard, first-party app hint rule |
| `nimi-home-contract.md` | `P-HOME-*` | Nimi Home product entry/shell authority, hosted-shell binding, non-owner rules, surface registry requirement, AIProfile selection consumption, Agent Chat placement boundary, mandatory `AIScopeRef`, no-private-path rule, Apps non-owner rule, first-screen rule |
| `nimi-self-update-contract.md` | `P-SUPD-*` | Nimi product self-update policy, release channel/trust/compatibility/rollback owner split with Home / Runtime / App registry / Runtime local environment, fail-closed self-update, existing desktop self-update supersession, web self-update boundary |
| `nimi-package-release-contract.md` | `P-PKGREL-*` | Installable product name, atomic bundle identity, release channel identity, updater endpoint/pubkey policy, install-gateway handoff scope, failure projection requirement, three-distinct-update-surface rule, no-unrecorded-packaging-identity-split rule |
| `cold-start-authority-contract.md` | `P-COLD-*` | Cold-start authority owner split (process start, Runtime bootstrap, account unauthenticated, host capability detection, default profile recommendation, local dependency setup, first app/library projection), fail-closed-only state set |
| `nimi-app-admission-contract.md` | `P-NAPP-001..P-NAPP-015`, `P-NAPP-018..P-NAPP-029`, `P-NAPP-033..P-NAPP-034` | Nimi App verified catalog/release admission authority, `app_id` display/routing identity, descriptor/review/storage posture, opaque immutable package seam, catalog-track separation, and protected local-app launch |
| `nimi-app-local-admission-contract.md` | `P-NAPP-030..P-NAPP-032`, `P-NAPP-035..P-NAPP-036` | Same-owner listing/inventory and local-record boundary, production Developer Mode, closed provenance, and random Runtime principal relationship |
| `mod-extension-retirement-contract.md` | `P-MOEX-*` | Public Mod / Public Extension non-admission, developer/internal/retirement-only posture for existing nimi-hook / mod governance / mod workspace / SDK mod surfaces, no shared Nimi Content Pack channel, app-internal content package boundary; Asset Market disposition retired (P-MOEX-005 sentinel) |
| `agent-identity-floor-contract.md` | `P-AGID-*` | Account-scoped durable agent identity primitive floor, family / persona / projection semantics, app-specific projection lifecycle, Runtime `ConversationAnchor` continuity binding rule, Agent Chat transcript / history owner rule, chat-derived memory projection rule, no-app-local-mint rule |
| `app-permission-contract.md` | `P-PERM-*` | App permission taxonomy plus PC-local account+principal grant owner split, exact resource fingerprint, presence, principal-keyed storage/audience, trust-class non-effect, audit and fail-close rules |
| `nimi-first-party-integration-contract.md` | `P-FPI-*` | First-party Nimi App integration contract: hardcut target (Avatar), single registry source, AIProfile selection reference consumption, permission scope ref consumption, runtime registration consumer relationship, Avatar master gate clearance, no-standalone-ordinary-user-truth rule, Avatar kernel authority retention |
| `nimi-first-party-migration-contract.md` | `P-FPM-*` | First-party migration contract: required migration questions, migration failure fail-closed state machine, no-silent-user-state-reset rule, source-development marker rule, zero-dual-track-period-after-hard-cut, per-app implementation plan requirement |
| `nimi-ecosystem-contract.md` | `P-ECO-*` | Nimi ecosystem authority: third-party developer onboarding, trust tier behavior expansion (ceiling / review / kill-switch), world / game app class posture, engine SDK future-seam boundary, economy posture non-admission boundary, no-Steam-copy negative gate list, cross-cutting invariants |
| `governance-contract.md` | `P-GOV-*` | License matrix, release gates, governance tasks, final-authority-only spec language, and release-promise freeze authority |
| `release-gate-contract.md` | `P-RELG-*` | Release-gate registry authority, projection-only execution surfaces (preflight, lint chain, CI step blocks), evidence JSON shape, verdict semantics, drift gate self-bootstrap |
| `test-governance-contract.md` | `P-TEST-*` | Cross-domain test classification vocabulary, census authority, fail-closed inventory ratchet, per-domain non-authoritative support inventories, trust-gate eligibility hard blocks, LocalAgent behavior/evaluator admission, and budgeted Journey-based deterministic acceptance without personality-truth ownership |
| `local-config-migration-contract.md` | `P-MIG-*` | `~/.nimi` cross-file current-schema validation and repair authority: governed config file family, mandatory `schemaVersion`, fail-closed current-version read, no automatic old-schema upgrade, repair routing for unknown version and broken pointer, no-data-orphaning invariant, `nimi_data` directory ownership authority, and destructive cleanup confirmation floor; aligns with but does not redefine Runtime `K-CFG-014..016` |
| `nimi-app-audit-pipeline-contract.md` | `P-AUDIT-*` | Nimi App audit pipeline authority: publish-to-admission gate sequence (`submit → preflight → audit → review → admit`), typed audit-pipeline composition by evidence classes (`malicious-package-scanner`, `known-vuln-scanner`, `sast`, `repository-posture-scorer`, `malware-reputation-scanner`, `ai-audit`; swappable adapter slots, no vendor names), AI-audit triage-and-evidence-only posture with `ai_only_review` and `self_attested_scan` forbidden shortcuts, solo-reviewer MANUAL/AUTOMATED classification within `P-ECO-004` already-admitted bounds (lever weakens no admitted rule; `nimi-verified-partner` `review-manual-full` floor invariant; `nimi-community` lever-driven; `nimi-first-party` out of scope), developer-side `nimi audit` dry-run non-gate posture (forward-references `P-DEV-003`), review-evidence shape (`audit_evidence_ref`, `ai_audit_model_ref` mandatory when ai-audit in scope, `scanner_results_ref`) cross-referencing `P-NAPP-025` review-decision schema without redefinition; review-state transition audit-event obligation (`P-AUDIT-007`; every transition between admitted `P-ECO-004` review states emits a typed audit event recording `from_state`, `to_state`, `transition_cause`, `decided_at`, `adjudicator_ref`; `P-ECO-004` state-set and tier-to-adjudicator authority preserved, `P-AUDIT-007` admits the state-transition audit-event obligation only) |
| `nimi-app-developer-workflow-contract.md` | `P-DEV-*` | Developer repository/submission workflow, one production Developer Mode and Dev Trust Set, run_once/remember-dormant-reactivate lifecycle, production account mediation, native execution disclosure, no persistent dev autostart, and external-AI-host-exclusive workflow lifecycle boundary |
| `nimi-app-scaffolding-contract.md` | `P-SCAF-*` | Nimi App scaffolding and app-authoring authority: app-authoring ownership, accepted A0-A5 inputs, `standalone` / `workspace-app` profile split, `nimi.app.yaml` as submitted-manifest input only, build-profile requirements, permission declarations as transparency/review input only, managed file taxonomy, `nimi-app create|init|doctor|update`, init/doctor/update developer-scaffold semantics, nimicoding projection ownership, local acceptance harness as local evidence only, no public Nimi App admission/install truth from scaffolding, explicit `workspace-app` app-slice admission exception under `P-APP-*`, and A5 model-test admission dependency |
| `nimi-proposal-intake-contract.md` | `P-PROP-*` | Nimi proposal intake authority: conversation-originated non-executing proposal record identity, closed proposal kind set (`capability_proposal`, `workflow_draft_request`, `nimi_app_request`, `delegated_tool_request`, `rejected_request`), required proposal record shape, intake state machine (`draft`, `submitted`, `under-review`, `revision-requested`, `rejected`, `accepted-for-admission`, `blocked`), owner handoff boundary into `P-DEV-*` / `P-NAPP-*` / `P-AUDIT-*`, Runtime/delegation, or future owner authority, source conversation anchor reference boundary, transition audit obligation, and SDK/app consumer boundary with no app-local proposal truth or execution shortcut |
| `desktop-open-intent-contract.md` | `P-DOPEN-*` | Running Desktop Open Intent authority: running-only protocol, Desktop target catalog references, sourceHost enum, result code producer mapping, and closeout evidence manifest requirement |
| `agent-center-contract.md` | `P-AGENT-CENTER-*` | Kit Agent Center reusable surface ownership, closed LocalAgentSourceContextStatus/AgentTurnContextSummary rendering boundary, app intent/presentation ownership, and no raw context or context assembler |

## Structured Fact Sources

| Table | Kernel Document | Description |
|---|---|---|
| `tables/protocol-error-codes.yaml` | `protocol-contract.md` | ~45 protocol error codes |
| `tables/protocol-primitives.yaml` | `protocol-contract.md` | 6 realm primitives field contracts |
| `tables/compliance-test-matrix.yaml` | `protocol-contract.md` | L0-L2 compliance test matrix |
| `tables/audit-events.yaml` | `protocol-contract.md` | Protocol audit event dictionary |
| `tables/app-authorization-presets.yaml` | `protocol-contract.md` | readOnly/full/delegate preset rules |
| `tables/participant-profiles.yaml` | `protocol-contract.md` | Realm/Runtime capability profiles |
| `tables/error-code-mapping.yaml` | `protocol-contract.md` | Platform protocol error → runtime reason code mapping |
| `tables/nimi-ui-tokens.yaml` | `design-pattern-contract.md` | Cross-app semantic design token registry, including typography, sizing, focus, opacity, and scrollbar tokens |
| `tables/nimi-ui-primitives.yaml` | `design-pattern-contract.md` | Executable shared primitive contract used for generated CSS and prop unions |
| `tables/nimi-ui-themes.yaml` | `design-pattern-contract.md` | Foundation scheme values and shared Nimi accent values for the toolkit token taxonomy |
| `tables/nimi-ui-adoption.yaml` | `design-pattern-contract.md` | Core exception registry only; non-core app adoption inventories belong in app-local kit manifests |
| `tables/nimi-ui-compositions.yaml` | `design-pattern-contract.md` | Platform density-mode guidance plus core exception composition registry; non-core app-owned compositions belong in app-local kit manifests |
| `tables/nimi-ui-allowlists.yaml` | `design-pattern-contract.md` | Core/shared design escape hatches; non-core app escapes belong in app-local kit manifests |
| `tables/nimi-kit-registry.yaml` | `kit-contract.md` | Kit sub-module registry with kind, exports, dependency direction, and admission metadata |
| `tables/canonical-capability-catalog.yaml` | `capability-catalog-contract.md` | Canonical `CanonicalCapabilityId` rows with structured sourceRef, i18n keys, runtime evidence class, and deferred entries |
| `tables/app-slice-admissions.yaml` | `app-slice-admission-contract.md` | Active app-local spec slices admitted by `.nimi/spec` as subordinate audit authority |
| `tables/package-authority-admissions.yaml` | `package-authority-admission-contract.md` | Active package-local spec roots admitted by `.nimi/spec` as package audit authority |
| `tables/delegated-projection-admissions.yaml` | `package-authority-admission-contract.md` | Active parent/external source authority projections admitted by `.nimi/spec` for host-local projection audit closure |
| `tables/ai-profile-factory-catalog.yaml` | `ai-profile-selection-policy-contract.md` | Admitted factory AIProfile rows dimensioned over privacy_posture x compute_posture x capability_set x routing_policy with selection-policy inputs referencing Runtime host capability profiles, local compute packs, and local environment dependency families |
| `tables/first-run-state-machine.yaml` | `cold-start-authority-contract.md` | Canonical first-run product-control state machine with state copy floor, entry conditions, allowed user actions, and exit conditions |
| `tables/product-control-record-schema.yaml` | `cold-start-authority-contract.md` | Canonical `<runtime_owner_state_root>/nimi.json` product-control record schema invariants, production fixed-service root binding, selected `nimi_data` rules, local install-level rules, and `ready_for_use` evidence requirements |
| `.nimi/spec/desktop/kernel/tables/nimi-home-surfaces.yaml` | `nimi-home-contract.md`, `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` | Desktop-hosted Nimi Home surface placement registry consumed by `D-HOME-*` rows; non-owner cross-reference recorded here so the Platform `Nimi Home` ontology has a clear view of the hosted-shell surface registry source |
| `tables/nimi-app-identity-surfaces.yaml` | `nimi-app-admission-contract.md`, `nimi-app-local-admission-contract.md` | Canonical active app identity surface mapping: `app_id` / SDK `appId` / Runtime caller app id equality, Tauri `identifier` derivation from `ai.nimi.apps.<app_id>`, and explicit app source roots for Desktop, Web, Avatar, and Tester |
| `tables/nimi-app-registry.yaml` | `nimi-app-admission-contract.md`, `nimi-app-local-admission-contract.md` | Admitted Nimi App registry rows (first-party seed for Avatar) with typed references to trust tier, factory AIProfile selection, canonical capability ids, local compute packs, runtime registration mode, permission scope (`permission_fabric_pending` until concrete scope sets are admitted), admission status, and distinct local-record inventory projection |
| `tables/nimi-app-release-descriptors.yaml` | `nimi-app-admission-contract.md` | Immutable release descriptor schema and admitted bundled first-party descriptors; external app versions must freeze source ref, artifact locator, sha256, size, signature/provenance, runtime entry, permissions, and storage policy before install |
| `tables/nimi-app-trust-tiers.yaml` | `nimi-app-admission-contract.md` and ecosystem expansion authority | Trust tier enum rows `nimi-first-party`, `nimi-verified-partner`, `nimi-community` with signature/permission/review/kill-switch policy refs |
| `tables/protected-local-executable-trust-sets.yaml` | `nimi-app-admission-contract.md` and Runtime `K-PLOCAL-003/005` | Closed bidirectional production/non-product Desktop、Linux control-carrier、Runtime service trust sets, signed release-record schema, launch/config authority and build isolation |
| `tables/nimi-app-local-development-admission.yaml` | `P-NAPP-035`, Runtime `K-PLOCAL-009` / `K-APP-027`, Desktop `D-IPC-019/020`, Kit `P-KIT-046`, scaffolding `P-SCAF-018`, SDK `S-TRANSPORT-014` | Production Developer Mode mutable-project authorization, isolated principal/record, zero-grant session, run_once/remember-dormant-reactivate, fixed-service process/session rotation, native risk disclosure and artifact/selected RuntimeAgent ceiling |
| `tables/nimi-app-local-trust-classes.yaml` | `P-NAPP-036` | Closed third-party local provenance classes, random principal relationship, bundled exclusions, promotion invalidation, opaque 0P seams, and no trust-class permission effect |
| `tables/audit-evidence-roots.yaml` | `web-release-contract.md`, `kit-contract.md`, `package-authority-admission-contract.md`, `governance-contract.md` | Authority-specific implementation and host-local evidence roots admitted for spec-first audit planning |
| `tables/rule-evidence.yaml` | `protocol-contract.md`, `architecture-contract.md`, `ai-last-mile-contract.md`, `ai-scope-contract.md`, `design-pattern-contract.md`, `kit-contract.md`, `capability-catalog-contract.md`, `ai-profile-selection-policy-contract.md`, `nimi-home-contract.md`, `nimi-self-update-contract.md`, `nimi-package-release-contract.md`, `cold-start-authority-contract.md`, `nimi-app-admission-contract.md`, `nimi-app-local-admission-contract.md`, `mod-extension-retirement-contract.md`, `agent-identity-floor-contract.md`, `app-permission-contract.md`, `nimi-first-party-integration-contract.md`, `nimi-first-party-migration-contract.md`, `nimi-ecosystem-contract.md`, `governance-contract.md`, `nimi-proposal-intake-contract.md` | Platform formal rule → executable evidence mapping |
| `tables/release-gate-registry.yaml` | `release-gate-contract.md` | Single source of release-gate identity (gate id, command, tier, target, prerequisites, evidence shape, blocker semantics) projected into preflight, lint chain, and CI step blocks. |
| `tables/test-governance-policy.yaml` | `test-governance-contract.md` | Closed cross-domain test classification vocabulary, gate-eligibility enum, hard blocks, reproducible census, module owner map, LocalAgent deterministic/live/evaluator policy, and L0–L5 Journey acceptance budgets. |
| `tables/release-promise-freeze.yaml` | `governance-contract.md` | Cross-domain release-promise freeze: public capability id, posture, canonical owner, login requirement, failure behavior, partial/deferred reason, and owner authority refs. Authority `P-GOV-026`. |
| `tables/nimi-data-directory-ownership.yaml` | `local-config-migration-contract.md` | Canonical `nimi_data` data-root directory ownership matrix: per first-level directory owner, product meaning, and cleanup rule. Authority `P-MIG-006`. |
| `tables/local-config-file-registry.yaml` | `local-config-migration-contract.md` | Canonical membership registry for the `~/.nimi` governed config file family: per file schema owner and current-schema validation authority. Authority `P-MIG-001`, `P-MIG-003`. |
| `tables/desktop-open-intents.yaml` | `desktop-open-intent-contract.md` | Closed protocol surface for other apps requesting an already-running Desktop process to open admitted Desktop-owned targets. Authority `P-DOPEN-001..P-DOPEN-008`. |
| `tables/desktop-open-intent-golden-vectors.yaml` | `desktop-open-intent-contract.md` | Parser and target conformance vectors for SDK, Kit, and Desktop Open Intent implementations. Authority `P-DOPEN-009`. |

## Version Terminology

| Term | Meaning |
|---|---|
| **V1** | Protocol major version. Indicates the overall protocol generation (version negotiation, envelope format, primitive contracts). Used in kernel contract prose. |
| **V0.1** | Primitive field constraint initial set. Indicates the first release of per-primitive field definitions in `tables/protocol-primitives.yaml`. A V0.1 field set operates under the V1 protocol. |

## Downstream Reference Constraint

Domain documents under `.nimi/spec/platform/` must reference at least one `P-*` Rule ID for each kernel import. Structured tables in `tables/` must use `P-*` Rule IDs in their `source_rule` field.
