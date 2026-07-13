# Local App Principal And Record Contract

> Owner Domain: `K-APP-*`

## Scope

This contract owns only the PC-local `LocalAppPrincipal` and
`LocalAppRecord` lifecycle seam. Protected launch/process/session facts remain
`K-PLOCAL-*`; account-and-principal grant truth remains `K-GRANT-*`; account
and credential custody remains `K-ACCSVC-*`; operation and resource semantics
remain with their existing owners.

## K-APP-028 Local OS-user Partition

Every principal and record is partitioned by a Runtime-derived
`local_os_user_anchor`. On Windows the anchor is derived from the verified
interactive-user SID established by `K-PLOCAL-003`; it is never accepted from
a request, environment variable, project, package, Desktop, SDK, or app.

The first Runtime data root admits exactly one active anchor. A different SID
or Fast User Switching context fails closed before principal, record, private
storage, grant, autostart, launch, session, or audit state can be read or
mutated. This is a single-PC partition and does not create device enrollment,
cross-PC recovery, or cloud truth.

## K-APP-029 Stable Local Security Principal

Runtime allocates a random, non-reused opaque `local_app_principal_id` for
each admission instance. The identifier, rather than `app_id` or provenance,
is the security subject for app-private storage, app-scoped audience/access,
grants, sessions, and audit.

An immutable principal carries an opaque `immutable_lineage_id`. Its package
key and attestation mapping is unavailable until 0P, but 0P may only populate
the frozen field. A development principal carries a Runtime-owned
`development_authorization_id`, canonical project-root file identity, and the
declared `app_id`. Exactly one principal-kind anchor is present.

Update and exact imported-to-verified promotion preserve the principal.
Uninstall or project-authorization revoke tombstones it permanently. Any
reinstall or re-authorization, including the same signer, project, or app id,
allocates a new principal and inherits no grant, storage, audience, session,
or audit identity. Retained tombstoned data is delete-only after fresh
presence; rebind and migration are not admitted.

`app_id` remains a display/routing identifier. A development project that
declares the same `app_id` as an immutable app, or immutable records with
different lineage, remain isolated principals.

## K-APP-030 Lifecycle Record And Opaque Package Seam

`LocalAppRecord` binds one principal to current provenance and lifecycle. It
contains the closed `verified | user_imported | local_development` trust
class, opaque provenance-attestation references, `provenance_revision`,
install-or-project generation, active capability fingerprint, opaque
`execution_profile_ref`, host executable digest slot, payload-root digest
slot, and lifecycle state.

The record contains no grant boolean, permission result, account owner,
session proof, or operation-policy decision. Immutable positive install,
update, and promotion are typed unavailable until 0P defines how signed
package and Platform-attestation inputs map into the already frozen opaque
fields. No package authority may reshape this schema.

Promotion increments `provenance_revision` and transactionally invalidates
all current launch leases and local-app sessions without creating or widening
a grant. A new session revalidates any still-compatible grant. Delisting
changes discovery only; security revoke blocks execution and cannot fall back
to another provenance class.

## K-APP-031 Owner Separation And Resolver

The principal store and lifecycle-record store are separate from the
account-grant store and protected launch/session store. A resolver may join
them into an immutable per-operation context, but it cannot mutate another
owner's store or cache an authorization result.

Private preparation is permitted before public cutover only when unreachable
from production, unregistered as a public RPC/export, and not an active second
store. Dual read, dual write, app-id positive fallback, and record-embedded
grant state are forbidden.

Account-scoped app-private data uses `local_os_user_anchor + account_id +
local_app_principal_id`; machine-local principal/record identity itself is not
account-owned. Canonical LocalAgent, `ConversationAnchor`, transcript,
presentation, and Agent-memory identity remain RuntimeAgentService/Cognition
truth and are not repartitioned or owned by the app principal.

## Fact Sources

- `tables/local-app-principal-record-schema.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-local-trust-classes.yaml`
- `protected-local-session-contract.md` — `K-PLOCAL-*`
- `grant-service.md` — `K-GRANT-*`
- `account-session-contract.md` — `K-ACCSVC-*`
- `runtime-agent-service-contract.md` — `K-AGCORE-*`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-*`
