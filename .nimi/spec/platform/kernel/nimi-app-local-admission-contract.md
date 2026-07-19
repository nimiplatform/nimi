# Nimi App Local Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

Defines the Apps listing/inventory, PC-local record, provenance, and Developer
Mode portion of `P-NAPP-*`. Verified catalog/release and protected-launch
authority and shared owner allocation remain in `nimi-app-admission-contract.md`;
both documents belong to the same Platform owner domain.

## P-NAPP-030 — Listing Closure Field Set

`MUST`：the Apps listing predicate admitted by `P-NAPP-009` is
composed, at projection time, from the following typed conjunction:

- `admission_status` equals `admitted`; AND
- `ordinary_visibility` equals `ordinary-visible`; AND
- the registry row resolves the following six fields against their
  admitted refs:
  - `trust_tier_ref` (`P-NAPP-004` floor),
  - `package_kind` (`P-NAPP-001`),
  - `release_descriptor_ref` (`P-NAPP-014`),
  - `permission_requirements` (`P-PERM-007`; an empty list is resolved),
  - `runtime_registration_mode` (`P-NAPP-006`),
  - `storage_policy_ref` (`P-NAPP-015` / `P-NAPP-027`); AND
- no host, runtime, or Realm projection emits a fail-close on the row
  marking it `unsupported` or `blocked`.

The conjunction is the explicit listing-closure field set; this rule
records its composition but does not redefine `P-NAPP-009`. Removing
any conjunct fails the row out of `ordinary-visible` projection per
the existing `P-NAPP-009` `MUST` body.

`MUST NOT`：this rule MUST NOT introduce a new listing predicate
parallel to `P-NAPP-009`. The Apps `ordinary-visible` projection has
a single admitted predicate (owned by `P-NAPP-009`); this rule is
the explicit field-set composition that predicate evaluates over.

`MUST NOT`：the listing predicate MUST NOT be reduced to a subset of
the six resolved-field conjuncts. Each conjunct is independently
required; collapsing two (e.g. treating `permission_requirements`
resolution as implied by `release_descriptor_ref` resolution) fails
the row out of `ordinary-visible` projection by violating the
admitted conjunction.

## P-NAPP-031 — Unified Apps Inventory Source Model

`MUST`：Desktop/SDK inventory preserves distinct owner projections:

- `catalog` — Platform verified discovery/release metadata;
- `account` — Runtime-authenticated account eligibility projection;
- `local_record` — Runtime K-APP local principal/lifecycle projection.

Source identity remains inspectable. Joining rows by display `app_id` cannot
merge principals, permission posture, storage, audience, or sessions. Catalog,
account, local record, and current permission posture are separate facts and no
inventory composer may turn one into another.

## P-NAPP-032 — Local Record Creation Boundary

A mutable project enters only through `local_development`; an immutable package
remains typed unavailable until 0P admits the package-to-opaque-lineage mapping.
Workspace adoption, workspace scanning, file presence, npm/npx installation,
cloned source, process liveness, or app-local specs cannot create a principal,
record, provenance, permission decision, launch lease, or session. No alias or
inventory-only record may provide another positive path.

## P-NAPP-035 — Production Developer Mode And Local Development

`local_development` is the sole mutable third-party provenance class and uses
the same principal, launch/session, permission, and owner-operation coordinator
as immutable classes. The global Developer Mode toggle grants nothing. A
project's first authorization requires fresh presence and an explicit
`run_once` or `allow_project` decision.

Authorization binds canonical project-root file identity, declared app id,
permission-requirement fingerprint, current account, fixed shell/entry policy,
and development authorization. The top-level `permissions` list contains only
closed public `{ id, reason }` requirements admitted by `P-PERM-002`; it is
request eligibility only and never substitutes for an owner-issued selector or
permission decision. The current admitted list is empty, so a non-empty local
manifest fails before project approval. Every build/host replacement receives a
new lease, process binding, and local-app session. Controlled HMR/rebuild/restart,
supervisor replacement, Desktop restart, and Runtime restart/upgrade/reinstall
may reuse `allow_project` without repeated consent while the canonical project,
account, permission-requirement fingerprint, shell/entry policy, and risk
disclosure revision remain exact. Runtime boot epoch and supervisor-run identity
are technical-session inputs and never durable consent inputs. Account switch,
mode-off, supervisor end, and Runtime replacement revoke live carriers but do
not revoke exact `allow_project` consent. Revoke, root/app/account/permission-
requirement/shell/entry mismatch, risk expansion, copied project, or integrity
failure invalidates or requires fresh approval for the applicable authority.

The Runtime-owned `allow_project` consent row lives under the stable protected
service authority root, outside candidate-, acceptance-round-, and selected
product-data roots. Candidate installation may rebuild candidate-local
principal/record projections from that row, but must not replace, copy, or
reinterpret the consent store.

The public permission-requirement list may be empty. An application that uses only
its own native host, app-owned OS storage, or the bounded app-private storage
base entitlement is still a valid local-development project. App-private base
entitlements and exact app-owned host commands are not inserted into the
permission-requirement fingerprint; changes to the native host remain
covered by the existing host/payload digest, shell/entry, process, and project
generation bindings. After a public permission is atomically admitted, any
change to the manifest permission-requirement list changes the fingerprint and
requires the existing reapproval flow.

`allow_project` remains Runtime-owned when mode is off, the account is absent,
or no supervisor is running; it never auto-runs. A later explicit dev launch
reuses it without presence only after exact binding verification. `run_once`
ends with the supervisor run or any invalidation trigger. Development may use a controlled production
account through Runtime-mediated APIs but receives no token, bearer, stronger
permission, or persistent Nimi-managed logon/boot autostart. UI must disclose
that Nimi permissions constrain Nimi APIs, not all ordinary OS rights of native
development code under the selected launch profile. For the admitted Windows
row this preserves the current disclosure about ordinary Windows rights.
The renderer receives no raw filesystem, account, credential, partition, or
generic host proxy. Electron and Tauri may register exact app-owned commands in
the native host; those commands are app authority, not Nimi permissions, and may not
tunnel protected Runtime/Realm operations.

## P-NAPP-036 — Closed Local Provenance And Principal Relationship

`tables/nimi-app-local-trust-classes.yaml` is the executable authority for the
closed `verified | user_imported | local_development` third-party provenance
set, transition seams, bundled-component exclusions, and principal
relationship. Trust class is Runtime-derived record state and has no Nimi API
permission effect. A caller/request cannot select or upgrade it.

The security subject is Runtime's random/non-reused
`local_app_principal_id`, partitioned by Runtime-derived
`local_os_user_anchor`. Opaque immutable lineage, attestation refs,
provenance revision, execution-profile ref, and host/payload digest slots are
frozen by 0K. 0P may map package and attestation inputs into those slots but
cannot rename or reshape them. Promotion invalidates leases/sessions and never
creates a permission decision. Shipped Zhiyu remains bundled; its integration build is an isolated
development principal.
