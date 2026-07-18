# Runtime Permission Decision Contract

> Owner Domain: `K-GRANT-*` (owner-internal decision lifecycle only)

## K-GRANT-001 Public Grant Family Hardcut

The former public credential-grant service is removed from proto, generated
clients, SDK exports, Runtime registration and persistence. Its wire identities
are reserved. No token, bearer, scope list, resource fingerprint, operation id,
delegation chain or app-selected endpoint may recreate it under another name.

The app-facing surface is product-level permission status and request only.
Apps cannot approve, decide, revoke, mint or carry authority. Desktop may own a
future user decision UI, but Runtime or the canonical remote owner retains the
decision truth and endpoint enforcement.

## K-GRANT-002 Authority-Class Separation

Runtime resolves every local-app action to exactly one Platform authority class:

- `base_entitlement`: the calling principal's bounded Nimi-private partition;
- `user_permission`: durable access to a protected Nimi/Realm/Agent/Cognition
  product capability through one admitted public permission id;
- `one_shot_consent`: one owner-selected resource represented by a bounded,
  non-forgeable handle;
- `app_owned_authority`: the app host's own SQLite, media, settings, cache,
  routes and product commands; or
- `os_right`: authority actually granted to the native process by the OS.

Only `user_permission` may use an owner-internal durable decision lifecycle.
Base entitlements, app-owned authority, one-shot handles and OS rights never
create a Runtime permission row. Launch approval, publisher review, Developer
Mode, login, session existence, product-route availability, AI routing and
metering are not permissions and cannot create synthetic permission truth.

## K-GRANT-003 No Generic Operation/Resource Grant Engine

Public permissions come only from
`../../platform/kernel/tables/nimi-app-permission-catalog.yaml`. Internal
operation and resource identities remain implementation details of their
canonical owner. They may be used for endpoint enforcement and protected audit,
but are forbidden from manifests, permission requests, ordinary SDK/Kit
surfaces, approval UI and app-readable diagnostics.

Runtime must not persist or evaluate a generic `capability_scope +
resource_scope` grant. A catalog row alone is not authority. A permission can
become admitted only when its decision owner, selector, lifecycle, endpoint
mapping, audit, revoke, SDK/Kit projection, product UI and positive evidence
arrive atomically. Until then status/request returns typed `unavailable` and
every mapped protected operation fails closed.

## K-GRANT-014 Local Public-Permission Lifecycle Admission Boundary

The current admitted third-party public-permission set is empty. Consequently
Runtime has no positive local permission mutation path and no durable
permission-decision store. A local app may
still open a restricted process-bound session and use base entitlements; it may
not list protected Agent/account/resource inventory merely to construct an
authorization request.

When a Runtime-owned public permission is admitted, its private lifecycle must
bind at least:

`local_os_user_anchor + account_id + local_app_principal_id + permission_id +
owner_selector_digest`.

The selector is produced by the canonical owner, never supplied as authority by
the app. The lifecycle must have monotonic revision, explicit user decision
evidence, account/principal isolation, revoke semantics, fresh reads at every
protected endpoint and complete audit. Account switch, principal tombstone or
owner-policy change must fail closed. Display `app_id`, publisher tier,
provenance, catalog presence or a valid session cannot substitute for the
current decision.

The exact pre-admission and future target schema is defined by
`tables/local-app-grant-binding-schema.yaml`. It intentionally declares
`store_identity: absent_pre_admission`; changing that value requires the full
permission admission slice, not a standalone schema or CRUD change.
