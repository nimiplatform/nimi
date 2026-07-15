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
  - `permission_scope_ref` (`P-PERM-007`),
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
required; collapsing two (e.g. treating `permission_scope_ref`
resolution as implied by `release_descriptor_ref` resolution) fails
the row out of `ordinary-visible` projection by violating the
admitted conjunction.

## P-NAPP-031 — Unified Apps Inventory Source Model

`MUST`：Desktop/SDK inventory preserves distinct owner projections:

- `catalog` — Platform verified discovery/release metadata;
- `account` — Runtime-authenticated account eligibility projection;
- `local_record` — Runtime K-APP local principal/lifecycle projection.

Source identity remains inspectable. Joining rows by display `app_id` cannot
merge principals, grant state, storage, audience, or sessions. Catalog,
account, local record, and current grant are separate facts and no inventory
composer may turn one into another.

## P-NAPP-032 — Local Record Creation Boundary

A mutable project enters only through `local_development`; an immutable package
remains typed unavailable until 0P admits the package-to-opaque-lineage mapping.
Workspace adoption, workspace scanning, file presence, npm/npx installation,
cloned source, process liveness, or app-local specs cannot create a principal,
record, provenance, grant, launch lease, or session. No alias or inventory-only
record may provide another positive path.

## P-NAPP-035 — Production Developer Mode And Local Development

`local_development` is the sole mutable third-party provenance class and uses
the same principal, launch/session, grant, and owner-operation coordinator as
immutable classes. The global Developer Mode toggle grants nothing. Each
project requires fresh presence and an explicit `run_once` or
`remember_project` decision.

Authorization binds canonical project-root file identity, declared app id,
capability fingerprint, current account, fixed shell/entry policy, and
development authorization. The fingerprint may include closed, typed
`local_development.runtime_scoped_binding_requests`; those declarations are
request eligibility only and never substitute for a Runtime grant or
Runtime-issued scoped binding. Every build/host replacement receives a new lease,
process binding, and local-app session. Controlled HMR/rebuild/restart and
Runtime restart may rebind without repeated consent only while those durable
bindings and the supervisor run remain exact. Account switch, mode-off,
revoke, supervisor end, root/app/capability/shell/origin mismatch, or copied
project invalidates the applicable authority.

`remember_project` becomes dormant when mode is off and requires fresh
presence to reactivate; it never auto-runs. `run_once` ends with the supervisor
run or any invalidation trigger. Development may use a controlled production
account through Runtime-mediated APIs but receives no token, bearer, stronger
permission, or persistent Nimi-managed logon/boot autostart. UI must disclose
that Nimi grants constrain Nimi APIs, not all ordinary Windows rights of native
development code.

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
grants. Shipped Zhiyu remains bundled; its integration build is an isolated
development principal.
