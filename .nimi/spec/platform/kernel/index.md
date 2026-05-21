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
| `PKG` | Package authority admission and host-local projection | `package-authority-admission-contract.md` |
| `AIPS` | AIProfile selection policy + factory catalog contract | `ai-profile-selection-policy-contract.md` |
| `HOME` | Nimi Home product entry/shell authority | `nimi-home-contract.md` |
| `SUPD` | Nimi product self-update authority | `nimi-self-update-contract.md` |
| `PKGREL` | Nimi package/release/update identity authority | `nimi-package-release-contract.md` |
| `COLD` | Cold-start authority owner split | `cold-start-authority-contract.md` |
| `NAPP` | Nimi App admission contract | `nimi-app-admission-contract.md` |
| `MOEX` | Mod / Extension retirement contract | `mod-extension-retirement-contract.md` |
| `AGID` | Agent identity primitive floor contract | `agent-identity-floor-contract.md` |
| `PERM` | App permission product-facing authority contract | `app-permission-contract.md` |
| `FPI` | Nimi first-party integration contract | `nimi-first-party-integration-contract.md` |
| `FPM` | Nimi first-party migration contract | `nimi-first-party-migration-contract.md` |
| `ECO` | Nimi ecosystem (third-party / world-game / engine-seam / economy / no-Steam-copy) contract | `nimi-ecosystem-contract.md` |
| `GOV` | Governance contract | `governance-contract.md` |
| `RELG` | Release gate contract (operational refinement of `P-GOV-003/011/021/023`) | `release-gate-contract.md` |
| `MIG` | Local config migration and repair contract | `local-config-migration-contract.md` |

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
| 260–269 | Local config migration / repair authority (`~/.nimi` cross-file `schemaVersion`, repair routing, `nimi_data` migration flow) |

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
| `package-authority-admission-contract.md` | `P-PKG-*` | Package-local spec admission, package-vs-host projection boundary, and audit expansion rules |
| `ai-profile-selection-policy-contract.md` | `P-AIPS-*` | Platform-owned factory AIProfile catalog + AIProfile selection policy authority, dimensioned alias matrix, apply chain into `AIProfile`/`AIConfig`/`AISnapshot`, selection policy inputs/outputs, cloud/local/hybrid/privacy posture rules, materialization projection contract, no-provider-model-constant guard, first-party app hint rule |
| `nimi-home-contract.md` | `P-HOME-*` | Nimi Home product entry/shell authority, hosted-shell binding, non-owner rules, surface registry requirement, AIProfile selection consumption, Agent Chat placement boundary, mandatory `AIScopeRef`, no-private-path rule, Apps non-owner rule, first-screen rule |
| `nimi-self-update-contract.md` | `P-SUPD-*` | Nimi product self-update policy, release channel/trust/compatibility/rollback owner split with Home / Runtime / App registry / Runtime local environment, fail-closed self-update, existing desktop self-update supersession, web self-update boundary |
| `nimi-package-release-contract.md` | `P-PKGREL-*` | Installable product name, atomic bundle identity, release channel identity, updater endpoint/pubkey policy, install-gateway handoff scope, failure projection requirement, three-distinct-update-surface rule, no-child-wave-split rule |
| `cold-start-authority-contract.md` | `P-COLD-*` | Cold-start authority owner split (process start, Runtime bootstrap, account unauthenticated, host capability detection, default profile recommendation, local dependency setup, first app/library projection), fail-closed-only state set |
| `nimi-app-admission-contract.md` | `P-NAPP-*` | Nimi App admission authority, registry row schema (app_id, publisher, trust_tier_ref, package_kind, signature/update policy refs, AIProfile selection reference, capability set / local compute pack / runtime registration mode / permission scope refs, health/repair projection, ordinary visibility, release descriptor, storage policy, admission_status), third-party PR admission and immutable descriptor verification, app-slice admission orthogonality, first-party seed scope, mechanical guard `check:no-public-mod-extension-admission` |
| `mod-extension-retirement-contract.md` | `P-MOEX-*` | Public Mod / Public Extension non-admission, developer/internal/retirement-only posture for existing nimi-hook / mod governance / mod workspace / SDK mod surfaces, no shared Nimi Content Pack channel, app-internal content package boundary, Asset Market non-generic-channel disposition |
| `agent-identity-floor-contract.md` | `P-AGID-*` | Account-scoped durable agent identity primitive floor, family / persona / projection semantics, app-specific projection lifecycle, Runtime `ConversationAnchor` continuity binding rule, Agent Chat transcript / history owner rule, chat-derived memory projection rule, no-app-local-mint rule |
| `app-permission-contract.md` | `P-PERM-*` | App permission product-facing authority: closed permission taxonomy, grant lifecycle, audit event mapping, fail-closed denial state machine, cross-app authorization rules, permission_scope_ref schema, spend metering, first-party seed grant set, cross-kernel backend retention |
| `nimi-first-party-integration-contract.md` | `P-FPI-*` | First-party Nimi App integration contract: hardcut targets (Avatar, ParentOS), single registry source, AIProfile selection reference consumption, permission scope ref consumption, runtime registration consumer relationship, Avatar master gate dependency, no-standalone-ordinary-user-truth rule, Avatar kernel authority retention |
| `nimi-first-party-migration-contract.md` | `P-FPM-*` | First-party migration contract: required migration questions, migration failure fail-closed state machine, no-silent-user-state-reset rule, source-development marker rule, zero-dual-track-period-after-hard-cut, per-app implementation plan requirement |
| `nimi-ecosystem-contract.md` | `P-ECO-*` | Nimi ecosystem authority: third-party developer onboarding, trust tier behavior expansion (ceiling / review / kill-switch), world / game app class posture, engine SDK future-seam boundary, economy posture child-proposal reference, no-Steam-copy negative gate list, cross-wave invariants |
| `governance-contract.md` | `P-GOV-*` | License matrix, release gates, governance tasks |
| `release-gate-contract.md` | `P-RELG-*` | Release-gate registry authority, projection-only execution surfaces (preflight, lint chain, CI step blocks), evidence JSON shape, verdict semantics, drift gate self-bootstrap |
| `local-config-migration-contract.md` | `P-MIG-*` | `~/.nimi` cross-file config migration and repair authority: governed config file family, mandatory `schemaVersion`, fail-closed read, shared migration framework (ordered registry, backup, atomic rewrite, idempotent replay), repair routing for unknown version and broken pointer, no-data-orphaning invariant, `nimi_data` directory ownership authority, `nimi_data` migration flow, destructive cleanup confirmation; aligns with but does not redefine Runtime `K-CFG-014..016` |

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
| `tables/nimi-ui-compositions.yaml` | `design-pattern-contract.md` | Core exception composition registry only; non-core app-owned compositions belong in app-local kit manifests |
| `tables/nimi-ui-allowlists.yaml` | `design-pattern-contract.md` | Core/shared design escape hatches; non-core app escapes belong in app-local kit manifests |
| `tables/nimi-kit-registry.yaml` | `kit-contract.md` | Kit sub-module registry with kind, exports, dependency direction, and admission metadata |
| `tables/canonical-capability-catalog.yaml` | `capability-catalog-contract.md` | Canonical `CanonicalCapabilityId` rows with structured sourceRef, i18n keys, runtime evidence class, and deferred entries |
| `tables/app-slice-admissions.yaml` | `app-slice-admission-contract.md` | Active app-local spec slices admitted by `.nimi/spec` as subordinate audit authority |
| `tables/package-authority-admissions.yaml` | `package-authority-admission-contract.md` | Active package-local spec roots admitted by `.nimi/spec` as package audit authority |
| `tables/ai-profile-factory-catalog.yaml` | `ai-profile-selection-policy-contract.md` | Admitted factory AIProfile rows dimensioned over privacy_posture x compute_posture x capability_set x routing_policy with selection-policy inputs referencing Runtime host capability profiles, local compute packs, and local environment dependency families |
| `tables/first-run-state-machine.yaml` | `cold-start-authority-contract.md` | Canonical first-run product-control state machine with state copy floor, entry conditions, allowed user actions, and exit conditions |
| `tables/product-control-record-schema.yaml` | `cold-start-authority-contract.md` | Canonical `~/.nimi/nimi.json` product-control record schema invariants, selected `nimi_data` rules, local install-level rules, and `ready_for_use` evidence requirements |
| `.nimi/spec/desktop/kernel/tables/nimi-home-surfaces.yaml` | `nimi-home-contract.md`, `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` | Desktop-hosted Nimi Home surface placement registry consumed by `D-HOME-*` rows; non-owner cross-reference recorded here so the Platform `Nimi Home` ontology has a clear view of the hosted-shell surface registry source |
| `tables/nimi-app-registry.yaml` | `nimi-app-admission-contract.md` | Admitted Nimi App registry rows (first-party seed for Avatar and ParentOS) with typed references to trust tier, factory AIProfile selection, canonical capability ids, local compute packs, runtime registration mode, permission scope (Wave 4 placeholder), and admission status |
| `tables/nimi-app-release-descriptors.yaml` | `nimi-app-admission-contract.md` | Immutable release descriptor schema and admitted bundled first-party descriptors; external app versions must freeze source ref, artifact locator, sha256, size, signature/provenance, runtime entry, permissions, and storage policy before install |
| `tables/nimi-app-trust-tiers.yaml` | `nimi-app-admission-contract.md` (Wave 3) and Wave 6 ecosystem expansion | Trust tier enum rows `nimi-first-party`, `nimi-verified-partner`, `nimi-community` with Wave 3 signature/permission/review/kill-switch seam placeholders; Wave 6 expands behavior |
| `tables/audit-evidence-roots.yaml` | `web-release-contract.md`, `kit-contract.md`, `package-authority-admission-contract.md` | Authority-specific implementation and host-local evidence roots admitted for spec-first audit planning |
| `tables/rule-evidence.yaml` | `protocol-contract.md`, `architecture-contract.md`, `ai-last-mile-contract.md`, `ai-scope-contract.md`, `design-pattern-contract.md`, `kit-contract.md`, `capability-catalog-contract.md`, `ai-profile-selection-policy-contract.md`, `nimi-home-contract.md`, `nimi-self-update-contract.md`, `nimi-package-release-contract.md`, `cold-start-authority-contract.md`, `nimi-app-admission-contract.md`, `mod-extension-retirement-contract.md`, `agent-identity-floor-contract.md`, `app-permission-contract.md`, `nimi-first-party-integration-contract.md`, `nimi-first-party-migration-contract.md`, `nimi-ecosystem-contract.md`, `governance-contract.md` | Platform formal rule → executable evidence mapping |
| `tables/release-gate-registry.yaml` | `release-gate-contract.md` | Single source of release-gate identity (gate id, command, tier, target, prerequisites, evidence shape, blocker semantics) projected into preflight, lint chain, and CI step blocks. Populated in topic `2026-05-10-release-preflight-gate-authority-hardcut` Wave 1. |
| `tables/nimi-data-directory-ownership.yaml` | `local-config-migration-contract.md` | Canonical `nimi_data` data-root directory ownership matrix: per first-level directory owner, product meaning, and cleanup rule. Authority `P-MIG-006`. |
| `tables/local-config-file-registry.yaml` | `local-config-migration-contract.md` | Canonical membership registry for the `~/.nimi` governed config file family: per file the schema-owner topic and migration execution authority. Authority `P-MIG-001`, `P-MIG-003`. |

## Version Terminology

| Term | Meaning |
|---|---|
| **V1** | Protocol major version. Indicates the overall protocol generation (version negotiation, envelope format, primitive contracts). Used in kernel contract prose. |
| **V0.1** | Primitive field constraint initial set. Indicates the first release of per-primitive field definitions in `tables/protocol-primitives.yaml`. A V0.1 field set operates under the V1 protocol. |

## Downstream Reference Constraint

Domain documents under `.nimi/spec/platform/` must reference at least one `P-*` Rule ID for each kernel import. Structured tables in `tables/` must use `P-*` Rule IDs in their `source_rule` field.
