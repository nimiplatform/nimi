# Runtime App Lifecycle Contract

> Owner Domain: `K-APP-*`

Runtime K-APP owns PC-local principal/record lifecycle. It does not own
Platform package format, K-GRANT grant state, K-PLOCAL process/session facts,
account custody, or operation-domain policy.

All mutations require Runtime-derived `local_app_control` on the current
protected Desktop connection. Public TCP, app id, caller enum, renderer
metadata, request confirmation, endpoint, environment, or portable bearer is
denied before target parsing.

## K-APP-011 Immutable Local-app Admission Posture

The 0K wire/schema reserves immutable principal and record lifecycle fields,
but positive install/import is typed unavailable until 0P defines signed
package and attestation mapping and Lane P implements it. No existing catalog
download, local adoption, source directory, or unsigned package path may create
an immutable principal or runnable record.

Any retained `InstallApp` symbol during the atomic wire migration is inactive
and must fail with the stable immutable-profile-unavailable reason. The final
package/import RPC shape is owned by 0P and cannot reshape the 0K principal,
record, grant, launch, or session contracts.

## K-APP-012 App Lifecycle Job Projection

Lifecycle job projections are typed owner results, not admission truth. A job
must carry stable id, kind, state, phase, target record/principal refs where
available, generation, reason code, redacted detail, and retryability. A future
immutable job remains `unavailable` before 0P/P; it cannot report installed,
updated, or runnable success.

## K-APP-013 App Lifecycle Event Stream

Lifecycle events carry monotonic sequence and full typed job snapshot. They do
not carry grant, credential, launch lease, process, session proof, or domain
operation truth. An unavailable immutable lifecycle emits an explicit terminal
failure rather than synthetic progress or success.

## K-APP-014 Remove And Tombstone Lifecycle

Removing an active immutable record or revoking a development authorization
transactionally revokes its leases/sessions and permanently tombstones the
principal. Retained durable data remains keyed to the tombstone and is
delete-only after fresh presence. Reinstall or re-authorization allocates a
new non-reused principal and inherits no grant, storage, app-scoped audience,
session, or audit subject.

Before 0P/P, immutable remove/uninstall is typed unavailable because no 0K
positive immutable install exists. Development revoke is active through the
Developer Mode lifecycle.

## K-APP-015 Immutable Update And Promotion Posture

Positive immutable update and imported-to-verified promotion are typed
unavailable until 0P/P. The frozen semantic seam is exact: eligible update or
promotion preserves `local_app_principal_id`, increments record/provenance or
release generation as applicable, invalidates current leases/sessions, and
never creates or widens a grant. Signer/attestation mapping and atomic package
promotion remain 0P authority.

## K-APP-016 Immutable Repair Posture

Immutable repair/reinstall cannot be active before the 0P package and fixed-
host lifecycle exists. Requests fail with typed immutable-profile-unavailable;
they do not download catalog bytes, scan local directories, or revive a
tombstoned principal. Development recovery uses supervised rebuild/restart and
new K-PLOCAL lease/session, not an immutable repair alias.

## K-APP-017 Prepare Local-app Launch

`PrepareLocalAppLaunch` is the sole local-app launch preparation RPC. It is
callable only by Runtime-derived `local_app_control` and selects one active
record by opaque `local_app_record_id`. Runtime resolves OS-user anchor,
principal, provenance revision, release-or-project generation, capability
fingerprint, execution profile, host/payload digest slots, current account,
and boot epoch.

Success creates one short-lived K-PLOCAL launch lease and returns only an
opaque host-private `local_app_bootstrap` plus expiry. It does not launch a raw
executable, create a session/grant, or return principal/account/provenance
details. `BindLocalAppProcess` and request-empty `OpenLocalAppSession` complete
the protected process/session path under K-PLOCAL-008.

The positive 0K profile is an approved, supervised `local_development` record.
Immutable execution profiles return typed unavailable until 0P/P. A shortcut
invokes the verified Nimi/Desktop launcher with a record selector; it never
points to app code.

## K-APP-018 Runtime-mediated File API Non-admission

No generic local-app file API is admitted by 0K. Principal-keyed private
storage exists as an owner seam, but apps cannot convert it into raw filesystem
or path authority. Any future typed file operation must resolve the current
principal and grant and must not expose another principal's root.

## K-APP-026 Protected Local-app Control Protocol

Lifecycle and development mutations consume the live protected Desktop
connection, `local_app_control`, current OS-user anchor/account/boot epoch,
exact target generation, and applicable Runtime-issued presence challenge in
one service-owned transaction. Returned evaluation/job/bootstrap ids are
correlation only.

The logical role covers local-app lifecycle UX coordination, grant UX,
protected launch, and development supervision. It does not generalize
`OpenDesktopSession` account control and creates no portable controller
credential. A future controller requires a separate transport/identity
admission while consuming the same logical role.

## K-APP-027 Local Development Lifecycle

Production Developer Mode is the sole positive 0K lifecycle. Enabling the
global mode grants nothing. `EvaluateLocalDevelopmentProject` resolves the
canonical project-root file identity, declared app id, capability fingerprint,
current account, and fixed shell/entry policy without creating authority.
`DecideLocalDevelopmentProject` consumes fresh grant presence and exactly
`run_once | remember_project`, then creates a new isolated development
principal/record with zero grant.

Every supervised host process uses `PrepareLocalAppLaunch`, a new process bind,
and a new common local-app session. Controlled HMR/rebuild/restart and Runtime
restart may preserve the durable authorization while rotating technical state.
Mode off, account switch/logout, revoke, supervisor end, copied/changed project,
capability expansion, shell/entry/origin mismatch, or uncontrolled output
revokes or requires fresh approval. Remembered records become dormant on mode
off and require fresh presence to reactivate; they never auto-run.
When a `run_once` supervisor run reaches any terminal condition, Runtime
tombstones that principal and marks its record removed; another run requires a
fresh decision and new non-reused principal/record. A remembered record does
not transfer across account switch: its live carrier is revoked, it remains
bound to the original account, and it needs fresh presence after that account
becomes current again.

The development principal may use a controlled production account only through
the common K-GRANT/K-ACCSVC/owner-operation envelope. It receives no credential,
portable proof, stronger permission, or persistent Nimi-managed autostart.

## Fact Sources

- `local-app-principal-record-contract.md` — `K-APP-028..K-APP-031`
- `tables/local-app-principal-record-schema.yaml`
- `protected-local-session-contract.md` — `K-PLOCAL-*`
- `account-session-contract.md` — `K-ACCSVC-*`
- `grant-service.md` — `K-GRANT-*`
- `.nimi/spec/platform/kernel/tables/nimi-app-local-development-admission.yaml`
