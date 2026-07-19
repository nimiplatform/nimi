# Nimi App Permission Contract

> Owner Domain: `P-PERM-*`

## Scope

This contract defines the single product-facing authority model for third-party
Nimi Apps. It governs only access to protected resources owned by Nimi, Realm,
Agent, Cognition or another app. An app's own product domain, ordinary OS
rights, publishing review, launch approval, session health, product routes, AI
routing and usage metering are not user permissions.

## P-PERM-001 Product-Facing Permission Vocabulary

Platform owns the only public permission vocabulary through
`tables/nimi-app-permission-catalog.yaml`. A public permission describes one
user-recognizable product intent, not an RPC, endpoint, scope family, table,
file path or internal resource fingerprint. Each permission has exactly one
canonical decision owner. Backend owners may expand it into exact internal
checks, but may not expose a parallel public vocabulary.

## P-PERM-002 Closed Catalog And Current Admission

The public permission id set is exactly the `public_permissions` section of the
catalog. An id is requestable only when both `admission: admitted` and
`manifest_allowed: true`. The current admitted set is empty; all sixteen rows
are reserved. Apps that need only base entitlements, app-owned authority and OS
rights remain fully runnable. Unknown ids, reserved ids, old scopes, Runtime
operation ids and endpoint strings fail closed.

A row may move to admitted only as part of the complete P-PERM-017 slice. A
catalog edit, manifest declaration, CRUD endpoint or mock approval UI alone is
not admission.

## P-PERM-003 Public Posture And Owner Lifecycle

The app-facing posture is the closed set `prompt | pending | granted | denied |
unavailable`. Apps may query their own posture and request one admitted
permission with a user-facing reason. They cannot approve, revoke, mint, carry
or inspect owner-internal decision records.

A durable owner lifecycle, when admitted, uses monotonic revisions and the
closed internal states `pending | granted | denied | expired | revoked`.
Expired/revoked history is owner and audit truth, not an app workflow API.
There is currently no positive Runtime local permission lifecycle or store.

## P-PERM-004 Audit

Every admitted durable decision transition and every one-shot handle issuance
or consumption emits an owner audit event. It binds the owner-derived subject,
calling app principal, display app id, public permission id, selector digest,
old/new posture or one-shot action, trigger, timestamp and owner revision.
Protected operation/resource identities may appear only in protected owner
audit. Credentials, raw tokens and reusable proofs are never logged.

Audit events must not be silently coalesced across decisions. Missing audit or
unavailable audit persistence fails the affected positive path closed.

## P-PERM-005 Fail-Closed Evaluation

`user_permission` requires an admitted id, manifest eligibility, current owner
decision, owner-issued selector, exact permission-to-operation mapping and the
domain owner's current resource policy. Any missing, denied, expired, revoked,
mismatched or unavailable fact denies the operation. Publisher tier, review,
first-party identity, provenance and session existence do not widen it.

`base_entitlement` never fails merely because no user permission exists, but
still enforces its principal/session/account/path/quota boundary.
`one_shot_consent` requires an owner-issued non-forgeable handle; a caller-
supplied resource id is not proof.

## P-PERM-006 Cross-App Resources

There is no generic durable cross-app grant. A source app or canonical resource
owner must explicitly export through an admitted broker. The user selects one
resource in an owner-controlled picker, producing a bounded one-shot handle
audited against source app, target app and resource owner. Shared files,
sockets, host bridge details and path conventions cannot substitute for this
flow. `shared_resources.open` remains reserved until the full broker exists.

## P-PERM-007 Public Request Shape

Manifest declaration is exactly `{ id, reason }`. Runtime request is exactly
`{ permissionId, reason }`. `reason` is bounded explanatory text and carries no
authority. App id, account, OS-user anchor and principal come from the protected
carrier. Any selector comes from the catalog's canonical owner picker.

Public manifests, SDKs, Kit bridges and ordinary UI must not expose scope
family/name, qualifier, operation id, resource ref, selector digest, decision
id, account/principal/session identity, token or credential.

## P-PERM-008 AI Metering Is Policy

Every cloud or local AI execution emits typed usage and obeys Runtime budget,
rate, route and credential policy. Metering is mandatory owner policy, not a
permission the app requests or the user disables. Background continuation is a
different product intent represented by reserved `ai.background`; it remains
unavailable until activity visibility, budget ceiling and cancellation exist.

## P-PERM-009 First-Party Product Authority

Built-in Nimi products use exact service entitlements admitted by their own
Platform/Runtime/Realm/Cognition contracts. Such entitlements are not synthetic
third-party permissions and are never seeded into a local or Realm permission
ledger. First-party status does not widen a third-party permission or bypass OS
privacy, user preferences, account policy or owner checks.

## P-PERM-010 Backend Ownership

Realm retains cloud account, OAuth, Realm-owned decisions, domain data and
endpoint enforcement. Runtime retains local identity/session, Runtime-owned
decisions and local endpoint enforcement. Cognition retains memory/knowledge
policy. Platform standardizes the product catalog and projection only; it does
not copy backend truth. One user intent must not trigger duplicate approvals by
multiple owners.

## P-PERM-011 App-Private Storage

An app does not ask Nimi for permission to use its own SQLite, JSON store,
media, settings, cache or product routes. Runtime-mediated private JSON is a
`base_entitlement` constrained to the live calling principal/account partition,
canonical relative paths, quota and escape/symlink policy. Native app storage
is `app_owned_authority` under actual OS rights and disclosed sandbox posture.

External files are different: reserved `files.open` and `files.save` use one-
shot native picker handles. Another app's resources use
`shared_resources.open`. None creates a generic filesystem permission.

## P-PERM-012 Product Preferences

First-party preferences such as Zhiyu proactive interruptibility configure an
already-admitted product surface. They are not third-party permissions. Signed-
out, disabled, suppressed or unavailable owner state must produce typed
suppression. Reserved notification permissions cannot be inferred from a
first-party preference.

## P-PERM-013 Local Identity And Permission Separation

Project/package approval creates only a random, non-reused local principal and
provenance record. Launch creates only a process-bound session. Neither creates
or widens a permission. A valid zero-permission session may read its own public
permission posture and use base entitlements; it may not enumerate protected
Agent/account/resource inventory to manufacture a selector.

If a Runtime-owned permission is later admitted, its owner lifecycle binds the
OS-user anchor, current account, opaque app principal, public permission id and
owner selector digest. Every protected endpoint re-reads that current decision
and owner policy. Display app id and trust tier are never positive keys.

## P-PERM-014 Realm Source Materialization Is A First-Party Product Operation

`realm.source_materialize` is an authenticated
first-party product operation, not a third-party permission or synthetic
grant. Runtime uses its current Realm account, one typed
`CharacterSourceRefV3` and a fresh audience-bound challenge. Realm reloads
canonical source/world/dependency truth and current visibility/readiness, then
returns a short-lived signed Packet v3. Runtime verifies current JWKS, purpose,
audience, challenge, source, closure, limits, replay and account generation
before an atomic commit.

The flow accepts no app id, permission id, scope, qualifier, `accessGrantId`,
decision id or caller-selected Realm endpoint.
Runtime must never request and approve a Realm grant with the same account bearer. The retired
`realm_source.snapshot.consume` and `realm_source.snapshot.bind` are
non-authorizing and forbidden from positive implementation or evidence.
The public `agents.interact` permission applies only after a LocalAgent exists and
only after that separate permission is admitted; it is not an input to source
materialization.

## P-PERM-015 Five Authority Classes

Every app action resolves to exactly one class:

| Class | Meaning | Manifest | User prompt | Durable permission row |
|---|---|---:|---:|---:|
| `base_entitlement` | Calling principal's bounded Nimi-private surface | forbidden | forbidden | forbidden |
| `user_permission` | Durable access to protected owner resources | admitted id only | just in time | owner lifecycle |
| `one_shot_consent` | One explicit owner-picker selection | admitted id only | per selection | forbidden |
| `app_owned_authority` | App host's own product/storage/commands | forbidden | forbidden by Nimi | forbidden |
| `os_right` | Authority actually granted by the OS/sandbox | forbidden | OS-owned if applicable | forbidden |

The classes are mutually exclusive. Review, launch, route availability and
feature flags are not a sixth permission class. App-owned commands must not
proxy protected Nimi operations; protected operations must not be mislabeled as
app-owned or base entitlements.

## P-PERM-016 Public Intent Versus Internal Enforcement

One public permission may expand internally into many exact operations,
resource provenance checks, quotas, budgets, rate limits and owner policies.
For example `agents.interact` represents one selected-Agent intent while the
owner still enforces projection, conversation, text/voice and derived-artifact
boundaries on every call.

Users must not approve RPC methods, conversation anchors, turns, streams or
internal file operations one by one. Apps and renderers cannot construct or
display internal operation/resource identities. Least privilege remains exact
inside the owner while the product surface stays human-comprehensible.

## P-PERM-017 Admission Completeness And UX Budget

A public permission is admitted only when all of these land atomically:
catalog row, one decision owner, manifest validation, owner selector, durable
decision or one-shot proof, closed internal mapping, enforcement at every
endpoint, SDK/Kit surface, just-in-time approval UI, audit, negative tests and
real positive evidence. Durable permissions additionally require settings and
revoke UI. One-shot consent instead requires exact preview/selection display,
expiry, single consumption, cancellation and replay rejection; it must not
create a durable settings row.

The product UX budget is one decision per recognizable intent and selected
resource set. Install-time permission walls, method-level prompts, hidden
scope/qualifier editors, raw resource ids and duplicate Runtime/Realm approvals
are forbidden. A normal app using only its own data must launch with zero Nimi
permission prompts.

## Fact Sources

- `.nimi/spec/platform/kernel/tables/nimi-app-permission-catalog.yaml`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md`
- `.nimi/spec/runtime/kernel/grant-service.md`
- `.nimi/spec/runtime/kernel/account-session-contract.md`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md`
- `.nimi/spec/realm/external-realm.md`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md`
