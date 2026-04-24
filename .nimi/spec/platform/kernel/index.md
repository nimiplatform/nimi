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
| `DESIGN` | Nimi design pattern contract | `design-pattern-contract.md` |
| `KIT` | Kit shared platform infrastructure | `kit-contract.md` |
| `APP` | App-slice admission contract | `app-slice-admission-contract.md` |
| `WEB` | Web and release gateway contract | `web-release-contract.md` |
| `PKG` | Package authority admission and host-local projection | `package-authority-admission-contract.md` |
| `GOV` | Governance contract | `governance-contract.md` |

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

## Document Ownership Matrix

| Kernel Document | Rule ID Range | Description |
|---|---|---|
| `protocol-contract.md` | `P-PROTO-*` | Version negotiation, envelope, app auth, primitives, error codes, compliance |
| `architecture-contract.md` | `P-ARCH-*` | Six-layer architecture, communication rules, credential planes |
| `ai-last-mile-contract.md` | `P-ALMI-*` | Hook Action Fabric, Principal model, execution protocol |
| `design-pattern-contract.md` | `P-DESIGN-*` | Cross-app Nimi UI Toolkit authority, generated primitive contract, scheme plus accent theme model, adoption registry, and hard gate |
| `kit-contract.md` | `P-KIT-*` | Kit package authority, sub-module contracts (UI, Auth, Core, Telemetry), and hard gate |
| `app-slice-admission-contract.md` | `P-APP-*` | App-local spec admission, subordinate authority scope, evidence roots, and audit expansion rules |
| `web-release-contract.md` | `P-WEB-*` | Web surface, install gateway, Cloudflare adapter, and release evidence ownership |
| `package-authority-admission-contract.md` | `P-PKG-*` | Package-local spec admission, package-vs-host projection boundary, and audit expansion rules |
| `governance-contract.md` | `P-GOV-*` | License matrix, release gates, governance tasks |

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
| `tables/nimi-ui-themes.yaml` | `design-pattern-contract.md` | Foundation scheme values plus app accent pack values for the toolkit token taxonomy |
| `tables/nimi-ui-adoption.yaml` | `design-pattern-contract.md` | Governed module registry, supported schemes, and accent pack selection |
| `tables/nimi-ui-compositions.yaml` | `design-pattern-contract.md` | Explicit registry for app-owned composition components and thin wrappers that must not become parallel primitive authority |
| `tables/nimi-ui-allowlists.yaml` | `design-pattern-contract.md` | Approved design escape hatches |
| `tables/nimi-kit-registry.yaml` | `kit-contract.md` | Kit sub-module registry with kind, exports, dependency direction, and admission metadata |
| `tables/app-slice-admissions.yaml` | `app-slice-admission-contract.md` | Active app-local spec slices admitted by `.nimi/spec` as subordinate audit authority |
| `tables/package-authority-admissions.yaml` | `package-authority-admission-contract.md` | Active package-local spec roots admitted by `.nimi/spec` as package audit authority |
| `tables/audit-evidence-roots.yaml` | `web-release-contract.md`, `kit-contract.md`, `package-authority-admission-contract.md` | Authority-specific implementation and host-local evidence roots admitted for spec-first audit planning |
| `tables/rule-evidence.yaml` | `protocol-contract.md`, `architecture-contract.md`, `ai-last-mile-contract.md`, `design-pattern-contract.md`, `kit-contract.md`, `governance-contract.md` | Platform formal rule → executable evidence mapping |

## Version Terminology

| Term | Meaning |
|---|---|
| **V1** | Protocol major version. Indicates the overall protocol generation (version negotiation, envelope format, primitive contracts). Used in kernel contract prose. |
| **V0.1** | Primitive field constraint initial set. Indicates the first release of per-primitive field definitions in `tables/protocol-primitives.yaml`. A V0.1 field set operates under the V1 protocol. |

## Downstream Reference Constraint

Domain documents under `.nimi/spec/platform/` must reference at least one `P-*` Rule ID for each kernel import. Structured tables in `tables/` must use `P-*` Rule IDs in their `source_rule` field.
