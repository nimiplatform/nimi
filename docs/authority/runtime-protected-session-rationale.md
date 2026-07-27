# Runtime Protected Session and Surface - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/protected-session.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/protected-local-session-contract.md -->

# Protected Local Session Contract

> Owner Domain: `K-PLOCAL-*`

This contract is the sole normative owner for OS peer/process identity,
protected-local transport identity, process-bound Desktop control sessions,
lifecycle operation admission, the Runtime boot epoch, and security-critical
generation state. Account, app-lifecycle, Platform release, Desktop UX, Kit carrier,
and SDK contracts reference these facts; they do not restate or replace them.

## K-PLOCAL-001 Sole Authority, Binding-Only Bootstrap, and Non-Fallback

Runtime derives every protected origin from a mutually authenticated local
connection and a verified live process. An app id, caller enum, source host,
manifest, renderer metadata, loopback address, or portable session/bearer is
self-asserted context and is never origin proof. Protected-local unavailability
fails closed; public TCP and app-owned metadata are not fallback transports.

Production Runtime protected state and process memory execute under the
isolated OS service principal selected by
`tables/protected-local-runtime-principal-profiles.yaml`. Account,
connector/provider, authenticated Realm, and anchor-key custody additionally
use the platform custody profile selected by
`tables/protected-local-custody-profiles.yaml`. That principal is
distinct from the interactive Desktop user and every bundled, local-app,
renderer, and app-owned host principal. A same-interactive-user
Runtime process, user-session generic keyring, user-writable service definition,
or environment/argv-selected production endpoint cannot claim product
readiness. Missing service-principal isolation fails closed before custody load
or any listener. Same-user fixtures may exercise isolated unit logic only and
cannot open a product protected listener or serve as checkpoint evidence.
Service acceptance uses the same fixed production service principal with a
service-owned development-state lineage root defined by the principal-profile
table. The signed binary candidate is verified independently and does not
silently rotate that durable state identity.

Service-principal semantics are platform-neutral: production Runtime is a
non-interactive OS service principal distinct from the interactive user; only
the signed installer may establish its fixed service definition; missing
principal isolation fails before custody or listeners. The same-OS row in
`tables/protected-local-runtime-principal-profiles.yaml` alone selects the
service manager, principal constraints, process isolation, control mechanics,
and acceptance isolation. The Windows row is the admitted current behavior.
The macOS launchd system-daemon row and Linux system-service row are
requirements-only and remain fail-closed pending independent native admission.

The macOS tables additionally define one
`local_development_non_product_admitted` service profile. It uses the distinct
`_nimiruntimedev` system principal, `ai.nimi.runtime.dev` launchd label,
`RuntimeDev` state/trust roots, `nimi-dev` sockets, System Keychain namespace
and compile-time local-CA trust root owned by `P-NAPP-037`. It may establish a
real protected listener and account-bound local-development session only in a
binary built for that exact non-product profile. It cannot connect to
production endpoints or custody, cannot be selected at runtime, cannot advance
the production macOS row, and cannot serve as Developer ID, SMAppService,
notarization, Gatekeeper or Tauri evidence.

The signed installer and service updater own Runtime release staging,
installation, and atomic replacement. Desktop may read verified service status
and request start/restart only through the typed OS service-control gateway; it
never selects or spawns the Runtime executable, directly stops the service, or
ties service lifetime to Desktop lifetime. Production Desktop quit leaves the
Runtime service running. Administrative uninstall and updater-controlled drain
remain service-manager operations outside Desktop process ownership.

The protected `RuntimeServiceControlService.RequestRuntimeRestart` wire is the
sole Runtime-side restart trigger. Its request is empty and it is admitted only
on the exact `desktop_control` connection after that connection has opened its
boot-scoped Desktop session. Runtime begins a graceful drain and self-exits;
the fixed OS service manager, not Desktop, starts the replacement process.
Success is never the RPC acknowledgement alone: Kit must observe a different
service-profile process identity and creation marker, a different
`runtime_boot_epoch`, and a fresh
mutually verified protected handshake before projecting `running`. Public TCP,
local-app transports, portable credentials, service-name/path arguments,
direct service-manager stop/start, and caller-selected timeout or recovery policy are
forbidden.

`RuntimeAuthService.RegisterApp` and `RuntimeAuthService.OpenSession` remain
`BINDING_ONLY` bootstrap surfaces. They may establish only a non-privileged app
binding and MUST NOT derive account-control, Realm broker, AI, artifact,
realtime, media, lifecycle, or local-app launch authority. A portable value cannot and
MUST NOT establish Desktop, bundled-app, or local-app
privilege on the same or another connection.

The 0K local-app kernel admits the Windows fixed-service child channel defined
below. macOS and Linux remain fail-closed until independently admitted. No
temporary nonce, metadata, portable bearer, app-owned host stamp, localhost
fallback, direct daemon, or compatibility path may manufacture local-app
authority.

## K-PLOCAL-002 Transport Classes and Immutable Origin Roles

The closed RPC transport-class vocabulary is `public_tcp`, `desktop_control`,
`local_app_bootstrap`, and `local_app_host`. Local-app launch consumes
`local_app_bootstrap` and the app process opens `local_app_host`; the same-OS
row in `tables/protected-local-launch-session-profiles.yaml` alone selects the
physical launcher, process witness, and carrier. Immutable and development
execution profiles share the common session contract; distinct
principals/provenance/process bindings prevent inheritance.
Every row in `tables/protected-local-rpc-transport-matrix.yaml` resolves its
`allowed_transport_classes` through the closed `method_platform_binding`
resolver. Protected classes resolve to `verified_platform_transport` plus one
same-OS profile bundle; missing, ambiguous, or cross-OS resolution fails
generation. This adds no per-method transport or role admission.
Runtime-private refresh is a direct
in-process helper call and is never a transport class or an invocation of a
public refresh RPC.

The admitted origin roles are `binding_only`, `verified_desktop_process`,
`desktop_account_host`, `bundled_avatar_host`, `local_app_control`,
`local_app_process`, and `local_app_session`. Runtime derives immutable/development provenance and
execution profile from K-APP record plus launch lease; requests cannot select a
separate role or convert one principal into another. A transport role is derived
by Runtime from the verified connection and written to immutable origin
context before protocol parsing, authentication, authorization, token access,
or business request parsing. Requests and metadata cannot select, override, or
upgrade a role. Public TCP cannot construct a protected role.

Desktop control and a local-app host never share a portable session.
`local_app_bootstrap` to `local_app_host` promotion is atomic on the same
verified child connection and service-owned transaction that consumes the
launch lease.

## K-PLOCAL-008 Local App Launch Lease And Common Session

Launch/session semantics are platform-neutral. The Runtime-owned lease,
exact-process bind, empty session-open request, atomic same-connection
promotion, private session row, per-operation revalidation, and revocation
rules do not vary by OS. The same-OS row in
`tables/protected-local-launch-session-profiles.yaml` may select only the
launcher, child-process witness, and physical carriers; it must reference the
same-OS service-principal, verified-transport, and executable-trust profiles.

`PrepareLocalAppLaunch` may create one short-lived service-owned launch lease
only after protected `local_app_control` resolves the exact OS-user anchor,
local principal/record, provenance revision, release-or-project generation,
capability fingerprint, execution profile, host/payload digest slots, current
account id/generation, and Runtime boot epoch. The host-private projection carries
only an opaque 32-byte `local_app_bootstrap`; it never enters renderer/app state.

The verified launcher/supervisor starts the Runtime-resolved host, then
`BindLocalAppProcess` submits only the bootstrap/PID over the protected control
connection. Runtime independently opens/verifies the process, creation marker,
login session, locked executable identity, code-signing identity, execution
profile, build/host/payload digest, and record generation before process resume
or session admission. The child opens the profile-selected service-owned
`local_app_bootstrap` carrier. Runtime requires the native peer process witness
to match the retained bound process.
PID/bootstrap/path/argv/env/preload/renderer metadata are selectors only.

`OpenLocalAppSession` has an empty request and exists only on the verified
`local_app_bootstrap` connection already bound to the current lease/process/record.
Success atomically consumes the bootstrap, promotes that same connection to
`local_app_host`, and creates a session bound to
OS-user anchor, principal/record, provenance revision, release-or-project
generation, execution profile/digests, process tuple, account generation, and
current account id, and Runtime boot epoch. A valid identity may open with zero
user permissions for redacted permission posture and admitted base entitlements
only. It receives no protected Agent/account/resource inventory. A future
`user_permission` operation must separately resolve its admitted public
permission, owner-issued selector, current owner decision and domain policy.

`RenewLocalAppSession` also has an empty request, but exists only on the exact
verified `local_app_host` connection that already owns the current
`local_app_session`. Before the short-lived technical session expires, the
native host may use it to atomically revoke the previous Runtime-private row
and replace it with a new row on that same live connection. Runtime revalidates
the process, supervisor, authorization, record/provenance, project generation,
account generation, capability fingerprint, execution profile and boot epoch
before replacement. Renewal never consumes another launch lease, changes the
origin role, repeats durable consent, or exposes session id/proof. Public TCP,
ordinary gRPC, bootstrap connections without a session, and renderer/app code
cannot call or select this operation.

The lease TTL is 30 seconds and process-bind deadline is 10 seconds. Duplicate,
expired, revoked, wrong process/principal/record/generation/account/epoch and
ordinary-gRPC calls fail closed. Logout/account switch, lifecycle/security
revoke, process replacement/exit, incompatible generation/profile change, and
Runtime restart revoke the applicable lease/session transactionally. A future
permission-decision mutation does not rotate identity/session, but every next
protected call must read the current owner decision.

After consumption, the connection retains only Runtime-private opaque session
state. The K-PLOCAL session row is the sole launch/process/session truth and
contains no permission authority. Every admitted operation revalidates the live
process, current record/account and its own authority class. A user-permission
operation also revalidates the current owner decision and selector; opaque
handle, request metadata, session existence or launch-time snapshot is
insufficient.

The Windows row is admitted independently and carries the current fixed-service
named-pipe/retained-process-witness behavior. The macOS and Linux rows are
requirements-only and remain `protected-carrier-required` until their complete
native principal, transport, trust, launcher, and session chains are admitted.

## K-PLOCAL-009 Local-Development Authorization And Session

Local development has two different lifetimes. Runtime owns the durable user
development authorization in protected service state. It binds the canonical
project root, app id, manifest capability fingerprint, current account id, and
the exact `local_development` provenance and an isolated Runtime-assigned
principal. `run_once` persists only while its Desktop-owned supervisor run
remains live. `allow_project` preserves the principal/record authorization
posture across supervisor, Desktop, and Runtime replacement without repeated
presence while every durable binding remains exact. Each new run and Runtime
boot epoch still receives new lease, process, and session authority. It never
autostarts. Neither record is an immutable release,
signature, listing, production grant, or app-owned configuration truth.

Protected bootstrap supplies the local-development consent store as an absolute
path under the stable OS-protected service authority root. It is not derived
from the Runtime candidate payload root, acceptance round, selected product
data root, argv, environment, renderer input, or app input. Candidate
replacement may recreate candidate-local principal projections, but never the
durable consent decision.

Runtime separately owns every short-lived technical session. A session binds
the development authorization, verified Desktop supervisor process, actual
host PID and creation marker, current host executable identity, shell kind,
controlled renderer origin/output roots, account generation, and Runtime boot
epoch. The Desktop supervisor opens a development launch, starts the exact
Electron or Tauri host, and binds its retained process witness over the live
`local_app_control` connection. Runtime then requires the native
`local_app_host` carrier peer PID to equal that bound host and derives
`local_app_process` plus the Runtime-held development record before atomically
creating common `local_app_session` state. Another principal's provenance,
session, storage, permission, and operation authority remain non-convertible. PID,
path, parent PID, argv, env, project
manifest, localhost, and a caller-supplied digest are never sufficient
authority.

Session proof and launch material remain Runtime/native-host private. They are
never returned through renderer IPC, CLI output, terminal environment, argv,
files, preload APIs, or app code. Kit may expose only typed status and admitted
business operations. Runtime revalidates authorization, capability
fingerprint, process liveness, supervisor liveness, account generation, boot
epoch, shell, controlled outputs, and operation policy on every call.
The native Kit host renews an otherwise unchanged live technical session only
through request-empty `RenewLocalAppSession`; expiry or any failed revalidation
revokes the session and fails closed instead of reopening, falling back, or
requesting durable project approval again.

The verified Desktop `local_app_control` origin may read one exact bounded
`GetLocalDevelopmentAuthoritySummary` projection for local development
diagnostics. Runtime derives its two sections from the existing Developer Mode
record and current-account development authorizations. There is no permission
summary or local permission store before a public permission is admitted. The
projection contains only closed state values, per-state counts, and reason
codes. It never contains account, project, principal, record, authorization,
permission decision, request, presence, operation, resource, path, token,
secret, session, or boot-epoch identifiers. The read is side-effect free: it
does not expire, revoke, approve, deny, rotate, or otherwise advance
any authorization, permission, presence, or session lifecycle.
An unavailable source remains an explicit unavailable section and must not be
reconstructed from Desktop-local state. Ordinary TCP and local-app-host
transports deny the method before handler dispatch.

Renderer HMR/reload may retain the host process, but a controlled Electron
main/preload rebuild, Tauri Rust rebuild, host process replacement,
technical-session rotation, or Runtime restart must obtain a new launch lease,
process bind and session without another confirmation while the exact
`allow_project` authorization remains valid. Host or supervisor exit,
revoke, mode off, logout, account switch,
authorization mismatch, app/root/capability/shell change, uncontrolled output
or remote dev-server origin revokes the applicable launch/session before the
next operation. A different account requires its own confirmation; returning
to the authorization's original account may reuse the unchanged consent without
a separate credential or Realm-presence challenge.

## K-PLOCAL-010 Desktop-Supervised Bundled Avatar Profile

The default `nimi.avatar` Electron shell is a bundled first-party surface
hosted by the already verified Desktop process. It does not open a portable
app session and is not a local-development principal. The physical carrier is
the current `desktop_control` connection; Runtime derives the immutable
`bundled_avatar_host` role from that verified connection and admits only the
fixed `bundled_avatar_v1` profile in
`tables/first-party-protected-runtime-profiles.yaml#bundled_avatar_v1`.

Desktop main registers the exact `BrowserWindow`/`WebContents` object it
created through the supervised Avatar launch path. Kit main/native code selects
this profile only after binding the invoking Electron sender and main frame to
that non-portable registry entry; the exact registered URL and current
navigation state are secondary integrity checks, never identity. It injects the
fixed app id `nimi.avatar` and native profile after renderer request parsing.
Renderer code cannot provide or override a host-equivalence marker, profile,
app id, endpoint, metadata, origin role, account identity, method allowlist, or
capability. A normal Desktop renderer call, an unbound/replaced Avatar sender,
ordinary gRPC, and every method absent from the profile fail before handler
dispatch. The profile is therefore an exact typed carrier, not a generic
protected method-id proxy.

For each admitted call, the protected interceptor constructs one immutable,
non-serializable principal from the verified native connection, fixed profile,
Runtime boot epoch, and the current Runtime-custodied account id and generation.
Business services consume that principal and generic audience/owner checks;
AI, App, and Artifact services do not reconstruct bundled-Avatar authority or
query account state to rediscover caller class. Runtime Agent may retain one
domain policy adapter that validates a selected local Agent against the
principal account.

The profile may project Runtime health, current account snapshot/events, one
admitted Realm readiness operation, current-account Runtime Agent state,
Avatar conversation/voice/lipsync/debug streams, Runtime-generated voice
artifact bytes, and bounded scenario-job operations. Every protected stream is
bound to that account generation and boot epoch. Account transition invalidates
the old generation before a later event can be sent, centrally cancels idle
streams without polling, and requires a new call context. Desktop process
replacement, protected connection loss, sender unbinding, or Runtime boot-epoch
rotation likewise closes active Avatar streams and calls. No durable grant,
project approval, bearer, refresh material, account session secret, scoped
binding, renderer host-equivalence metadata, or local auth truth is created or
exposed.

The authorization, session, supervisor, reapproval, operation-applicability, and
non-conversion semantics in this rule are platform-neutral. Platform admission
is owned by `tables/protected-local-launch-session-profiles.yaml`; Windows is
the first positive row and macOS/Linux remain requirements-only and fail closed.
Immutable profiles remain typed
unavailable until 0P/P supplies package mapping and implementation;
development state cannot be reinterpreted as an immutable record or bundled
identity.

## K-PLOCAL-003 Mutual Endpoint Authentication

Protected endpoints require mutual authentication: Runtime verifies the client
process and the client verifies the Runtime server process before either side
sends a login proof, lifecycle challenge, ticket, session proof, account
material, or any other credential.

Mutual authentication also proves the asymmetric OS principals and both
running executables. Runtime verifies an admitted Desktop/control-carrier trust
row; the Desktop/control carrier verifies the Runtime service principal and an
admitted `nimi_runtime_service` trust row. PID, UID/SID, pathname, a successful
socket connection, or a correctly signed binary started outside its admitted
service/launch authority is insufficient. Production boot-security
configuration comes only from the signed service definition and signed release
descriptor; mutable product settings use typed protected Desktop control and
service-owned state. Environment, argv, renderer URL, app manifest, and
user-writable config cannot select a Runtime binary, Realm endpoint, trust set,
custody location, or protected listener.

Verified-transport semantics are platform-neutral. The same-OS row in
`tables/protected-local-os-profiles.yaml` alone selects the service bootstrap,
endpoint kind and ownership, kernel/OS peer credential, account-anchor
derivation, canonical process marker, liveness primitive, and post-bind exec
control. That row must reference the same-OS service-principal and executable-
trust profiles; a transport profile cannot redefine either owner.

The Windows row carries the admitted named-pipe/WTS/LSA/SCM/process-handle
behavior. The Linux filesystem-UDS/SO_PEERCRED/pidfd/static-carrier row remains
requirements-only. The macOS row requires a launchd-system-daemon-owned
filesystem UDS, kernel-derived peer euid/pid/audit-session facts, running-code
identity verification, audit-token `pidversion`, and exit/exec liveness; it is
requirements-only. Its complete conjunctive service, custody, mutual-trust,
Electron/Tauri split and live-evidence gate is owned by `P-NAPP-037`; satisfying
one implementation component cannot change this table's admission. Neither
unadmitted row can open a product protected
listener or fall back to localhost, same-user daemon, app-created listener,
portable proof, or another platform's transport primitives.

The authenticated transcript binds `protocol_version`, `transport_class`,
both canonical process tuples, `runtime_boot_epoch`, `endpoint_instance_id`,
and `transcript_nonce`. Any mismatch fails before credential or application
data is accepted.

## K-PLOCAL-004 Process Identity and Liveness

The canonical process tuple is `{os, pid, creation_marker, os_login_session,
canonical_executable_identity, code_signing_identity}`. A release digest is
bound separately by installed launch/session admission; PID alone never
authorizes.

The same-OS verified-transport profile selects the process marker, retained
liveness primitive, and post-bind exec control. A platform implementation may
not substitute PID polling, pathname re-open, caller heartbeat, or another
profile's primitive. The Windows row remains the admitted process-handle
behavior; Linux and macOS liveness rows remain requirements-only.

Process exit, post-bind exec, creation-marker change, or executable file
identity change immediately revokes every origin and session derived from the
process before further request parsing, token access, or network I/O. Failure
to obtain or retain the required liveness primitive fails closed.

## K-PLOCAL-005 Executable Identity and Trust

Each peer performs executable verification through the platform-native code
signing and process APIs. Runtime validates the Desktop/control carrier; the
Desktop/control carrier validates the Runtime service. The process identity,
executable file identity, executable role, service/launch authority, and
system code-signing identity are evaluated against the same running process
and opened executable object. Pathname re-open, app self-description,
environment-selected binaries, and static-file claims are not proof.

The signed installer/service updater owns the fixed service definition,
release activation, downgrade policy and rollback protection. Protected IPC
does not introduce a second RFC8785/Ed25519 release-record authority or a
second peer-maintained release-generation ledger. Runtime/Kit/Desktop may
consume the installer-owned active release identity and an installed release
digest, but cannot select or reinterpret either value. Missing platform code
signing, a service/process mismatch, a replaceable executable object, or a
signer-policy mismatch fails protected control closed.

Executable-trust semantics are platform-neutral. The same-OS row in
`config/spec-frozen/platform/tables/protected-local-executable-trust-sets.yaml`
alone selects native running-process targeting, opened-executable identity,
code-signing verification, signer constraint, executable role, and
service/launch authority. The verified-transport profile only references that
row and cannot reinterpret signer or release truth.

The Windows row is the admitted same-open-`hFile`/volume/file-ID/
`WinVerifyTrust` behavior. The Linux opened-`/proc/<pid>/exe` package identity
and macOS running dynamic-`SecCode`/designated-requirement/Team-ID/cdhash plus
Platform-release-root-signed fixed role-record profiles are requirements-only
and remain fail-closed. macOS final peer CDHashes cannot be mutually compiled
into the two signed executables, and the final Desktop CDHash record cannot be
embedded in the same outer-app resource seal without a signing cycle. Their
signed role records are emitted after final outer signing/notarization into the
fixed root-owned installer trust directory, then carried with that exact app by
the signed/notarized installer package. Platform release-root signature is
record content authority; fixed root ownership and the installer package are
installation authority; strict outer-app validation independently proves the
running bundle seal.
Pathname-only static
code, app self-description, an unadmitted profile, or another environment's
test signer cannot substitute for the selected product row. Service-manager
identity and process ACLs remain solely in the service-principal profile;
credential protection and key binding remain solely in the custody profile.

## K-PLOCAL-006 Desktop Control Session

`OpenDesktopSession` is admitted only on a mutually authenticated
`desktop_control` connection whose client carrier has already passed
K-PLOCAL-003..005 under the same-OS verified-transport profile and whose
Runtime peer is the isolated service principal referenced by that profile.
Its request contains no app id, caller class, source host, or portable proof
override. Runtime derives the Desktop roles; a returned session id is
correlation-only and is not portable authority.

The frozen minimum wire shape is exact: `OpenDesktopSessionRequest` has no
fields and accepts no authority-bearing metadata;
`OpenDesktopSessionResponse` contains only a 32-byte CSPRNG
`desktop_session_id` and the current 32-byte `runtime_boot_epoch`. Unknown
request fields are rejected. Neither value, nor the request/response itself,
may enter renderer or app IPC. The authoritative machine-readable shape is
`tables/protected-local-rpc-transport-matrix.yaml`.

Authority remains bound to the original connection, canonical process tuple,
and current Runtime boot epoch. Disconnect, process exit/exec, or Runtime
restart revokes it immediately. Rebind is forbidden, portable reconnect is
forbidden, and a new connection must repeat the full mutual endpoint, process,
and executable verification. At most one live Desktop control session exists
per process tuple.

After that session exists, first-party Desktop product calls resolve one exact
logical profile from
`tables/first-party-protected-runtime-profiles.yaml`. The canonical table, not
this prose or a language-specific selector, owns method membership and unary or
server-stream kind. `desktop_machine_product_v1` remains connection-, process-,
exact-main-sender-, session-, and boot-epoch-bound. It contains the established
Product Control surface plus the finite machine-local asset lifecycle, catalog,
transfer, profile, connector-catalog, observability, reserved External Agent,
inventory, route, readiness, scheduling and direct-Nimi operation set. Existing
Runtime Config `StartLocalAsset` / `StopLocalAsset` product orchestration is part
of that exact machine set and is not a generic local-service exposure. The
machine profile owns no account resource inventory or owner authority.
`ListAgents` is therefore account-bound; possession
of an agent id or request owner field cannot convert it to a machine read.

`desktop_account_product_v1` includes every machine identity condition and also
binds the immutable call principal to Runtime's current authenticated account id
and account generation. Only `protected_transport` may project that Runtime-
minted principal into authenticated handler context, and only after exact
account-profile binding. Any pre-existing authenticated identity that conflicts
with the minted account fails closed before handler dispatch; the machine
profile receives no account identity. The account profile carries only the exact
source materialization, account app inventory/readiness, account-partitioned
connector catalog/admin, LocalAgent inventory/state/autonomy/hooks, delegated
control, anchor/snapshot, partner-turn, AI-config, memory-binding, presentation
and owned-artifact operations in the canonical table. Logout,
account switch, account-generation change, sender destruction, connection loss,
process replacement, or boot-epoch change invalidates the profile and centrally
cancels its streams before any later read, event, or commit. The independent
`desktop_account_broker_v1` remains owned by K-ACCSVC-023..024 and is not merged
into either product profile.

Native main code derives the logical profile from a generated named intent
entrypoint after exact sender and main-frame binding. Renderer or request input
cannot select a profile, origin role, method id, principal, account, owner,
endpoint, metadata, token, grant, scope, or capability. Every method absent from
the selected profile fails before handler dispatch. A method row admits only
transport reachability: handler-level request, route, scheduling, capability,
owner, idempotency and domain postcondition validation remain mandatory.

`ListDesktopAuditEvents` remains additionally constrained by K-AUDIT-024: both
timestamps and the seven-day window are mandatory, pagination rejects values
above 100, and Runtime projects the exact nine-field event whitelist before
transport. Its admission does not admit raw `ListAuditEvents`, audit export,
payload content, subject/caller identifiers, authorization lineage, or audit
storage access. No logical profile creates a generic Runtime proxy, portable
session, public TCP fallback, third-party permission, account custody owner, or
second carrier.

### K-PLOCAL-006 Canonical First-Party Protected Runtime Profile Family

`tables/first-party-protected-runtime-profiles.yaml` is the sole editable owner
of first-party protected logical profile identity, exact method membership,
method kind, intent reference, principal policy, invalidation policy, native
entrypoint class, owner-postcondition reference, negative-test class, and gate
reference. It contains `desktop_machine_product_v1`,
`desktop_account_product_v1`, and the unchanged `bundled_avatar_v1` operation
set. The account/Realm broker remains an external referenced profile whose exact
account methods stay owned by `tables/account-rpc-permission-matrix.yaml`.

Runtime RPC/proto authority continues to own method existence and kind; domain
contracts continue to own success semantics; protected transport tables own
physical carrier and origin binding; Desktop owns user intent and UX; SDK and
Kit own generated consumer projections. Go, Rust, Electron, Tauri, TypeScript,
and transport-matrix method/profile selectors are deterministic projections of
the canonical profile table and cannot be independent edit points. Generation
must reject duplicate or unknown methods, kind mismatch, wildcard/service-wide
membership, missing intent or postcondition, unknown principal/invalidation,
renderer-selectable authority, and orphan outputs.

The machine and account profiles are distinct exact logical operation sets on
the same `desktop_control` carrier. Account calls do not inherit account
authority from machine calls, and renderer code does not choose between them.
Desktop may consume only generated purpose-specific clients; a full Runtime
facade, generic unary/stream bridge, serialized method selector, Avatar identity,
or account-broker method selector is not an admitted first-party product path.

The third-party `local_app_host` matrix separately admits the three exact
K-APP-032 RuntimeAppService JSON storage methods. They are not part of the
Desktop consumer set, accept no method id or root selector, and require the
current local-app session plus the Runtime-derived principal/account partition
before handler dispatch. They are the `app.private_storage` base entitlement:
no manifest declaration, prompt, selector, grant or permission row participates.
Public TCP, `GetAppStorage`, generic file IPC, and Node filesystem fallback
remain denied.

The third-party matrix admits no Artifact, Agent, conversation or voice method
while the public permission catalog is fully reserved. Those operations remain
typed unavailable until the complete P-PERM-017 product-permission slice lands;
a session, app-owned command, internal operation id or ordinary Runtime route
cannot substitute for that admission.

## K-PLOCAL-007 Lifecycle Transactions, Boot Epoch, and Recovery

Every admitted local-app control mutation requires the same live protected
Desktop connection, `local_app_control`, the current account generation, the
current Runtime boot epoch, and an exact principal/record target tuple. A
caller-provided `confirmed=true`, renderer-held identifier, app id, or job id
never authorizes. Runtime executes mutation admission, idempotency-key consume,
session/generation checks, and durable operation creation in one service-owned
database transaction before beginning an external side effect.

`PrepareAppLifecycleIntent` may project immutable-package unavailable impact
without creating package truth. Positive immutable install/update/promotion/
repair is unavailable until 0P/P. `PrepareLocalAppLaunch` is the only 0K
positive third-party launch preparation and always requires the principal/
record conjunction in K-PLOCAL-008. Exact operation fields are owned by
`tables/protected-local-lifecycle-intent-protocol.yaml`.

Runtime stores Desktop sessions, lifecycle operations, local-app lease
consumption, local-app sessions, generations and revocation state in one
service-owned transactional database protected by the isolated Runtime
principal. This database uses a fixed schema, foreign keys, WAL and durable
transactions; it is not a second credential store and does not HMAC-chain every
ordinary row. Account and connector/provider credentials remain exclusively in
the custody profile owned by K-ACCSVC-007. Production generic user-session
keyrings, automatic legacy import, Desktop/app storage and user-writable backup
restore remain forbidden.

Additional durable anchoring is limited to state whose rollback would recreate
security authority after a valid transition: installer-owned active release
generation, credential-custody generation, and explicitly admitted
non-rollbackable revocation floors. Session rows, UX intents, ordinary
local-app launch/run operations, audit outbox rows and crash-recovery
bookkeeping do not each advance a separate HMAC chain.

Every Runtime start creates a 32-byte CSPRNG boot epoch. Before any listener is
opened, one database transaction revokes nonterminal sessions, launch leases
and operations from older boot epochs and writes a sanitized startup audit.
Integer generations may order records but never replace the random boot epoch
identity.

Typed failures use the `PROTECTED_LOCAL_*`, `DESKTOP_*`, `LOCAL_APP_*`, and
`LIFECYCLE_CHALLENGE_*` rows in `tables/reason-codes.yaml` and
`tables/error-mapping-matrix.yaml`. Error detail contains only the stable
reason, retryability, and a non-secret action hint; it never includes endpoint
material, executable path, process tuple, operation id, durable anchor, account
material, or credential values.

---

<!-- source: .nimi/spec/runtime/kernel/account-session-contract.md -->

# Account Session Contract

> Owner Domain: `K-ACCSVC-*`

## K-ACCSVC-001 服务职责

**Owner-only authority allocation.** Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes. Runtime alone owns account and token custody, private refresh, authenticated Realm credential exchange, the Runtime-owned portion of public permission enforcement, and the per-operation local-app decision coordinator. Platform owns app catalog, trust-class and public permission vocabulary; `K-APP-*` owns the local-app principal/record and Developer Mode state; `K-GRANT-*` may own only owner-internal lifecycle records for admitted Runtime permissions; `K-PLOCAL-*` owns launch leases and local-app sessions. Desktop owns account-control UX, Developer Mode UX, future product permission UX, and the verified native supervisor/launcher, but no Developer Mode or permission truth. SDK and Kit own typed APIs and trusted carriers only; app-tools remains authoring and build tooling.

Apps MUST NOT own account or session truth, bearer or refresh tokens, or signed upload credentials. A Desktop host, Kit bridge, SDK client, renderer, app manifest, or app-supplied callback may carry only owner-attested opaque inputs and results; none may originate credentials, refresh authenticated Realm state, or become a parallel unary, realtime, or media authority.

This rule admits that single-owner allocation. `K-PLOCAL-*` is the sole
authority for transport, process, executable, challenge, boot-epoch and
security-ledger facts. `K-APP-*`, `K-GRANT-*`, and `K-ACCSVC-*` jointly admit
the common local-app decision without duplicating each other's state. Realm,
realtime and media operations still require their own exact operation rows;
local-app origin or permission posture never creates blanket authorization.

`RuntimeAccountService` 拥有本地机器层的 account session truth、custody、login lifecycle、refresh、logout、user switch、daemon restart recovery、Runtime-mediated Realm broker 和 Runtime-issued scoped app binding issuance。它是 local account authority 与 refresh-token custody 的唯一所有者。

`RuntimeAuthService`（`K-AUTHSVC-*`）继续负责 app session 与 external-principal session，二者不互相替代。`RuntimeAccountService` 不接受调用方提供的 `subject_user_id` 作为 account 真相，account subject 必须从 Runtime account custody 内部派生。

`RuntimeAccountService` 还是 Nimi 本地 app 的唯一 account custody 与 Realm
credential mediation owner。`InvokeRealmUnary` 当前只对 matrix 中明确 admitted
的 Desktop/bundled caller 生效；`LOCAL_APP` 行保持 deny，直到某个 exact Realm
operation 独立完成 owner admission。checkpoint 的 selected RuntimeAgent/Cognition
operation 不借用 generic Realm unary。任何 caller 最终都只能获得 bounded
application result，不获得 Realm bearer。任何 app、Desktop、SDK、Kit、renderer
或 app-owned host 都不得持有 access/refresh token、durable shared session、login
bootstrap、subject truth，或把 token/session 反向写回 Runtime。

Public `GetAccessToken` and `RefreshAccountSession` have been removed from
the public protocol, generated clients, Runtime handlers, Kit, and app
projections. Runtime may access or refresh account bearer material only through
non-RPC private helpers while executing an
independently admitted broker or service operation.

## K-ACCSVC-002 方法集合（权威）

`RuntimeAccountService` 方法固定为：

1. `GetAccountSessionStatus`
2. `SubscribeAccountSessionEvents`
3. `BeginLogin`
4. `CompleteLogin`
5. `RequestPresenceVerification`
6. `InvokeRealmUnary`
7. `Logout`
8. `SwitchAccount`
9. `IssueScopedAppBinding`
10. `RevokeScopedAppBinding`
11. `IssueWorkspaceBinding`
12. `RevokeWorkspaceBinding`
13. `GetLocalAppPermissionStatus`
14. `RequestLocalAppPermission`

Admitted 方法集合为冻结集合。`IssueWorkspaceBinding` /
`RevokeWorkspaceBinding` are admitted only for workspace-specific attachment
mint/revoke under `K-ACCSVC-019` and `K-BIND-018`.
`RequestPresenceVerification` is admitted only for fresh local user-presence
checks under `K-ACCSVC-021`. Any further method must undergo a new rule
admission before proto / RPC table projection.

The two local-app permission methods are protected local-app-host methods
governed by `P-PERM-002`, `P-PERM-007`, `P-PERM-017`, and `K-ACCSVC-026`.
They expose only a public permission id, public posture, requestability, and a
typed reason. Internal operation/resource/grant identity and approval control
are not RPC surface. The removed `GetAccessToken` and
`RefreshAccountSession` identities remain reserved and must not be reintroduced
under aliases.

## K-ACCSVC-003 Account Session 状态机

`RuntimeAccountService` 必须维护以下 account session 状态：

| 状态 | 含义 | 终止状态？ |
|---|---|---|
| `anonymous` | 无可用 account session | 否 |
| `login_pending` | 存在活跃 login attempt | 否 |
| `authenticated` | 拥有有效 account 材料与投影 | 否 |
| `refresh_pending` | 正在刷新 account 材料 | 否 |
| `expired` | 现有材料过期，无法授权工作 | 否 |
| `reauth_required` | 需要用户操作才能继续 | 否 |
| `switching` | 正在原子切换 active account | 否 |
| `logging_out` | 正在撤销本地材料与 binding | 否 |
| `unavailable` | 无法安全决定/托管 account state | 否，必须 fail-close |

**Single-active-account invariant**：单个 Runtime 实例同一时刻只能存在一个 `authenticated` account。`SwitchAccount` 必须为原子转换，不允许两个有效 account 投影同时存在。

## K-ACCSVC-004 状态转换表

| From | Trigger | To | Events | Idempotency / 排序 |
|---|---|---|---|---|
| `anonymous` | `BeginLogin` 接受 | `login_pending` | `login.started` | 同一 attempt 在 expiry 之前重复返回相同 pending attempt |
| `login_pending` | proof 完成且验证通过 | `authenticated` | `login.completed`、`account.status` | account projection 必须在 custody 写入成功后再发出 |
| `login_pending` | timeout / cancel / failure | `anonymous` 或 `reauth_required` | `login.failed` 或 `login.timed_out` | 过期 proof 必须 fail-close |
| `authenticated` | proactive / reactive refresh 启动 | `refresh_pending` | `refresh.started` | 同一 account 同时只允许一次 refresh 在飞 |
| `refresh_pending` | refresh 成功 | `authenticated` | `refresh.completed`、`account.status` | 新 token 必须原子替换旧 token |
| `refresh_pending` | 明确未离开进程的 transport failure | `refresh_pending` | `refresh.deferred` | 恢复 refresh custody；单飞退避重试，不得消费 rotation |
| `refresh_pending` | 请求可能已发出但结果不确定 | `reauth_required` | `refresh.failed`、`account.status` | 清除 custody；不得冒险复用单次 refresh token |
| `refresh_pending` | Realm 明确拒绝 token 或响应合同无效 | `reauth_required` | `refresh.failed`、`account.status` | 清除 custody 并要求真实登录 |
| `refresh_pending` | token 在恢复前过期 | `expired` | `refresh.failed`、`account.status` | authenticated 调用必须 fail-close |
| `authenticated` | `Logout` | `logging_out` | `logout.started` | 重复 logout 观察到相同转换 |
| `logging_out` | local / remote revoke 完成 | `anonymous` | `binding.revoked`、`logout.completed`、`account.status` | binding 必须在最终 anonymous 之前被 revoke |
| `authenticated` | `SwitchAccount` | `switching` | `switch.started` | 不允许两个有效 account 同时存在 |
| `switching` | 新 account 完成 | `authenticated` | `binding.revoked`、`switch.completed`、`account.status` | 旧 binding 必须在新 projection 之前 revoke |
| 任意非终止 | custody 不可用 | `unavailable` | `custody.unavailable`、`account.status` | fail-close |
| `unavailable` | custody 恢复且材料有效 | `authenticated` | `custody.recovered`、`account.status` | projection 必须在验证后再发出 |

## K-ACCSVC-005 RPC / IPC 语义

每个方法的最小契约：

- `GetAccountSessionStatus`: RPC 调用结果与账户当前状态必须分离。成功 RPC
  返回 `AccountSessionSnapshot`，其字段固定为 `sequence`、`state`、
  `reason_code`、`account_reason_code`、`account_projection`。投影最多包含
  `account_id`、显示信息、`realm_environment_id`（admit 时）、和
  `K-ACCSVC-018` admitted workspace membership projection，不得返回 raw
  token、refresh token、JWT、或 `subject_user_id` 字段。
- `SubscribeAccountSessionEvents`: server-stream 事件必须带
  `delivery_kind=snapshot|replay|live`。首次订阅（`after_sequence=0`）立即给
  当前 snapshot，随后只投递更高 sequence 的 live event；重连先按 sequence
  升序 replay，再给当前 snapshot，随后只投递更高 sequence 的 live event。
  `replay_truncated` 或 sequence gap 要求调用方重新调用 status，禁止猜测或
  合成状态。跨 JS 边界的 uint64 sequence 固定使用十进制字符串。
- `BeginLogin`: 创建 login attempt，返回 UX instruction envelope（如 `oauth_authorization_url`、`callback_origin`、`pkce_challenge`、`state`、`expires_at`）。kit / Desktop 不得获得 PKCE verifier。
- `CompleteLogin`: 接受 typed proof envelope（见 K-ACCSVC-008）。Runtime 验证后写入 custody 并转换状态。
- `InvokeRealmUnary`: Runtime 根据 `tables/realm-broker-operations.yaml`、
  Platform app capability/grant、Runtime app-session scope 与 host-bound caller
  envelope 执行单个 admitted Realm operation。Runtime 在内部取得/刷新 bearer，
  校验 canonical Realm base、operation/path/query/body 与 response size，并只返回
  bounded application JSON。响应 headers、bearer/access/refresh token、JWT、
  credential-like JSON keys/value 均不得返回 app；命中扫描器必须 fail-close。
  `timeout_ms` 是 Runtime-owned 整体 operation budget；Runtime 必须在该 budget
  到期时完成 typed broker 映射。native protected carrier 的 gRPC deadline 必须
  在该 budget 之外保留固定的 completion/serialization margin，不得抢先把 Realm
  timeout 折叠成 `runtime-service-unavailable`。
  只有 DNS/连接/TLS/timeout/响应读取失败和 HTTP 408/502/503/504 映射为
  `BROKER_REALM_UNAVAILABLE` / `REALM_UNAVAILABLE`。401 在强制刷新并精确
  重试一次后仍失败映射 `BROKER_AUTH_INVALID` / `AUTH_TOKEN_INVALID`；403
  映射 `BROKER_FORBIDDEN` / `PRINCIPAL_UNAUTHORIZED`；404、409、429、
  400/422 分别映射 `BROKER_NOT_FOUND` / `REALM_NOT_FOUND`、
  `BROKER_CONFLICT` / `REALM_CONFLICT`、`BROKER_RATE_LIMITED` /
  `REALM_RATE_LIMITED`、`BROKER_REQUEST_REJECTED` /
  `REALM_REQUEST_REJECTED`。3xx、405/415 与畸形成功响应映射
  `BROKER_CONTRACT_FAILED` / `REALM_CONTRACT_INVALID`；其他 5xx 映射
  `BROKER_OPERATION_FAILED` / `REALM_OPERATION_FAILED`。这些分支不得借用
  `AI_PROVIDER_*`。
- `Logout`: Runtime 撤销 local session 与所有 binding；幂等。Caller-facing
  logout success may be projected only after Runtime has accepted/completed the
  Runtime-owned logout transition or has emitted a corresponding account status
  projection. Local first-party apps may stop local side effects while logout is
  pending, but they MUST NOT claim "signed out locally" success while Runtime
  custody may still contain an authenticated session.
- `SwitchAccount`: 原子转换；旧 binding 在新 projection 之前 revoke。
- `IssueScopedAppBinding`: 见 `scoped-app-binding-contract.md`。account subject 内部派生。
- `RevokeScopedAppBinding`: 见 `scoped-app-binding-contract.md`。

`RequestPresenceVerification` invokes a Runtime-owned presence verifier chain
for a caller-stated purpose and bounded TTL. It must not treat an existing
account session, access token, refresh token, Realm server session,
app-local password prompt, or caller assertion as fresh presence. Runtime may
use a formal local OS verifier first, then a Runtime-owned fresh Nimi reauth
provider (`NIMI_REAUTH`) that forces a new Realm login interaction with
`prompt=login`, Runtime-generated state / nonce, and subject match. Missing or
unavailable presence capability returns `presence_verification_unavailable` and
fail-closes.

Public local account RPCs follow
`tables/account-rpc-permission-matrix.yaml`. `BeginLogin`, `CompleteLogin`,
`Logout`, and `SwitchAccount` are Desktop account UX operations and require
`ACCOUNT_CALLER_MODE_DESKTOP_SHELL`; non-Desktop local first-party apps,
third-party local apps, binding-only Avatar, and ordinary renderers must request
Desktop-owned account UX instead of calling them. Local apps may consume
admitted status/event, presence, grant and selected operation surfaces only
after principal, record, session and policy resolution, but cannot call login
completion, raw token, logout, or switch. Local apps require the common
host-bound local-app session; `app_id` or a host envelope is never sufficient.
Unauthenticated / anonymous status may be projected only after the caller mode's
registry/envelope admission succeeds; shape-only `AccountCaller` is never
sufficient.

For `ACCOUNT_CALLER_MODE_DESKTOP_SHELL`, admission is the live K-PLOCAL-006
`desktop_account_host` connection joined to the native host-owned app,
app-instance, device, caller-kind, and source-host envelope. The generic
binding-only `RegisterApp` registry is neither required nor sufficient for
Desktop account status or control. This keeps the request-body `AccountCaller`
non-authoritative while allowing the fixed production service, which exposes
no ordinary public TCP listener, to perform Desktop-owned login.

任何方法都不允许接受 raw Realm token、refresh token、raw JWT、或 caller 提供的 `subject_user_id` 作为 account truth。

The removed public token and refresh identities are reserved. No registry,
first-party, bundled, Desktop, Avatar, Zhiyu, local-app, renderer or test
posture may restore them. Runtime service code may obtain bearer material only
through a private helper and consume it inside the same Runtime-owned operation.

## K-ACCSVC-006 事件契约

事件家族：

- `account.status`
- `login.started`
- `login.completed`
- `login.failed`
- `login.timed_out`
- `refresh.started`
- `refresh.completed`
- `refresh.failed`
- `logout.started`
- `logout.completed`
- `switch.started`
- `switch.completed`
- `custody.unavailable`
- `custody.recovered`
- `binding.issued`
- `binding.activated`
- `binding.suspended`
- `binding.revoked`
- `binding.expired`
- `binding.superseded`
- `binding.replay_detected`

最小 payload 字段：`event_id`、`sequence`（单调递增）、`emitted_at`、`reason_code`、`account_projection_redacted`（仅在涉及 account 时）、`binding_id`（仅在涉及 binding 时）。

Redaction 规则：

- 不得包含 access token、refresh token、PKCE verifier、auth code、secret material 的任何形式。
- account projection 仅包含 `account_id` 与显示信息。
- binding 事件仅包含 `binding_id` 与 relation tuple，不包含 carrier 内部材料。

Reconnect 行为由 K-ACCSVC-005 的 `delivery_kind` 顺序唯一规定。snapshot
反映订阅点的当前 sequence；replay 与 live 均必须严格递增且不得重复。replay
不可用时发出 `replay_truncated`，调用方必须重新拉取 status。

## K-ACCSVC-007 Custody 模型

Custody 的平台中立语义是：RuntimeAccountService 在隔离的 Runtime 服务主体内
独占 durable credential material；材料只进入 Runtime-private service call chain；
写入、轮换、reuse detection、恢复、审计脱敏与不可用时 fail-close 的语义不因
平台改变。调用方、Desktop、Kit、SDK、renderer 与 app 均不能选择 custody backend、
key source、protected state location 或 fallback。

`tables/protected-local-custody-profiles.yaml` 是各平台 protected store、key binding、
durable anchor 与 unavailable disposition 的唯一 machine-readable authority。每个
profile 通过 `service_principal_profile_ref` 依赖相应隔离主体；profile 中出现的平台
原语不改变本规则的 owner、material visibility、rotation 或 fail-close 语义。未准入
profile 只有 requirements，不能据此产生 positive custody chain。

固定规则：

- Runtime 拥有 refresh material；Desktop / app 不存储任何 durable token。
- access token 只存在于 Runtime custody/private service call chain；不得投影给
  app、Desktop、SDK、Kit、renderer 或 host，也不得用于 app 直连 Realm。
- refresh token rotation 必须原子：新 token 提交后再丢弃旧 token。
- Reuse detection：在 rotation 之后再次观察到旧 refresh token，必须 revoke 本地 chain，发出 `refresh.failed` reason `replay`，并进入 `reauth_required` 或 `unavailable`。
- Runtime 必须在登录、成功刷新和服务重启恢复后按 access-token expiry
  重建单飞 proactive refresh timer；Realm unary 的首次 401 触发一次强制
  reactive refresh并精确重试一次，再次 401 才进入 reauth。
- transport 明确证明 request body 未离开进程时，Runtime 恢复未标记 custody，
  保持 `refresh_pending` 并重试；一旦 request 可能已发出但结果未知，Runtime
  必须清除 custody并进入 `reauth_required`，不得复用 rotation token。
- audit 永远不记录 token 值、auth code、PKCE verifier、refresh material。
- Interactive-user generic keyring, Credential Manager/vault, login Keychain,
  secret-service/libsecret session store, Desktop secure store, and app-owned
  vault are forbidden production custody. No retained user-session credential
  is imported; fresh login and connector credential re-entry are required.

custody 不可用时不允许 fallback 到 in-memory durable account truth、Desktop shared auth、或 app-local custody。

## K-ACCSVC-008 Login Completion Proof

`BeginLogin` 创建：

- `login_attempt_id`
- PKCE verifier / challenge（仅 Runtime 内部存储）
- redirect URI / 允许的 callback origin
- state / nonce
- `expires_at`
- UX instruction envelope（kit 可读字段，不含 verifier）

`CompleteLogin` proof envelope：

- `login_attempt_id`
- callback `code` 或 sealed kit-produced completion ticket
- 返回的 state / nonce
- redirect / callback metadata
- Desktop UX trace metadata（不含 token 材料）

执行决策：

- local first-party 默认登录路径为 Nimi Auth Browser callback：app / kit 只接收 `code` / `state`，Runtime 持有 login attempt、state、PKCE verifier，并执行 code exchange。
- 当平台约束要求 kit 执行 OAuth exchange 时，kit 必须返回 sealed completion ticket。Desktop 不允许观察 bearer / refresh token。
- sealed completion ticket 不是默认 branch；在 crypto / key custody / replay 语义被单独 admit 之前，implementation 必须 fail-closed。
- 任何路径下 Desktop / kit 都不允许成为 refresh-token custody owner 或 durable account session owner。

Replay 行为：

- 已完成 attempt 的重复 proof 仅在不再暴露敏感材料时才返回幂等成功。
- 过期、不匹配、或已消费的 proof 必须 fail-close，原因码 `proof_expired` / `proof_mismatched` / `proof_consumed`。

## K-ACCSVC-009 Login Route Ownership

local first-party 模式下，login route decision 由 Runtime 拥有，默认产品路径为 Nimi Auth Browser callback `code/state`：

| 路由 | local first-party 拥有者 | Web / cloud 拥有者 |
|---|---|---|
| `checkEmail` | local first-party superseded；Nimi Auth Browser route owns UX decision | 仅在 explicit Web/cloud adapter 之后允许 |
| `passwordLogin` | local first-party superseded；Desktop 打开 Nimi Auth Browser flow | Web/cloud adapter |
| `oauthLogin` | Runtime 拥有 Nimi Auth attempt 与 callback code exchange；sealed proof 仅用于平台强制 kit token observation | Web/cloud adapter |
| `requestEmailOtp` | local first-party superseded；Nimi Auth Browser route owns UX decision | Web/cloud adapter |
| `verifyEmailOtp` | Runtime 完成 browser callback proof 与 custody | Web/cloud adapter |
| `walletChallenge` | local first-party superseded，除非 Nimi Auth Browser 内部委派 wallet UX | Web/cloud adapter |
| `walletLogin` | Runtime 完成 Nimi Auth callback 与 custody | Web/cloud adapter |

local first-party 模式下 Desktop 不允许直接调用 Realm route 作为登录权威。

## K-ACCSVC-010 Remote Revocation 与 Logout 顺序

最小检测面：refresh-time 失败与 JWKS / revocation 验证。push / poll channel 不在 Phase 1 admit 范围内。

Logout / 远程撤销事件顺序：

1. 检测到 revoke / 失败
2. suspend 或 revoke 所有 active binding
3. 清除 custody 材料
4. 发出 `account.status = reauth_required` 或 `anonymous`

任何顺序违反必须 fail-close 并发出 `logout.failed`。

If `Logout` fails, the caller-facing projection MUST fail closed into
`reauth_required`, `unavailable`, or an explicit logout-failed UX state; it MUST
NOT convert renderer-local cache clearing into account logout success. Local
first-party consumers may clear volatile streams, optimistic UI, or query
state as side effects, but account state remains Runtime-owned until Runtime
emits the authoritative transition.

## K-ACCSVC-011 Daemon Restart 行为

daemon 重启后：

- Runtime 必须从 secure custody 尝试恢复 account session。
- 恢复成功且材料未过期 → `authenticated` + `custody.recovered`。
- custody 不可用 → `unavailable`。
- custody 可读但材料已过期 → `expired`。
- custody 可读但 reuse / inconsistency 检测失败 → `reauth_required`。

binding 在 daemon 重启时全部失效；调用方必须重新申请。Runtime 必须在恢复 projection 前完成 binding revocation 事件投递（reason `daemon_restart_no_recovery`）。

## K-ACCSVC-012 App Registration Caller Matrix

| Caller | 注册路径 | 必需 account state | Binding 来源 | 禁止 |
|---|---|---|---|---|
| Desktop shell | Runtime-mediated Desktop host registration | `authenticated` 或 anonymous（仅 account UX） | Runtime account broker；account-control 仅此 caller mode | durable token custody、public refresh、renderer caller truth、任何 bearer projection |
| SDK local first-party app | bundled first-party bootstrap | current Runtime-owned account generation when required | Runtime-owned first-party binding | account control、token、app-provided subject/session |
| Third-party local app (`LOCAL_APP`) | `PrepareLocalAppLaunch` + verified process bind + request-empty `OpenLocalAppSession` | current Runtime-owned account generation when an operation requires account | local-app principal/record/session; admitted public permission decision only when applicable | account control、token、caller-selected principal/account/permission/selector、`app_id` fallback |
| Default Avatar app (`nimi.avatar`) | shipped bundled first-party bootstrap | current Runtime-owned account generation when required | Runtime-owned first-party service entitlement | third-party local-app principal/permission posture、account control、token |
| Binding-only Avatar mode | 不允许直接 account registration | N/A | Runtime-issued scoped binding from owner surface | account access token、refresh token、anchor 创建、independent auth truth |
| Web / cloud app | 显式 Web/cloud adapter | Web/cloud session | Web/cloud adapter | local Runtime account authority claim |
| External principal | binding-only external-principal session | N/A for local account | none; public permission surface unavailable | every local protected account claim |

## K-ACCSVC-013 Activation Boundary

account broker 实现允许在 Desktop / SDK 切换前作为 inert substrate 落地。Inert 模式必须满足：

- 不得作为 active first-party local account truth
- 不得为 Desktop / Avatar / SDK 提供 production account projection
- 不得发布 production first-party scoped binding
- 不得读取 / 镜像 / 调和 Desktop shared auth
- 不得成为 Desktop / SDK local auth fallback

active owner switch 必须原子闭合：Runtime broker 激活、SDK / kit local first-party seam 移除、Desktop login UX adapter 转换三件事必须在同一 authority transition 内闭合，并在 transition 完成前删除或 hard-block 替换的 Desktop shared-auth 与 SDK local token / subject owner 路径。

同一 active owner switch 还必须激活 Runtime-mediated broker，使所有 local app
data calls 在 Runtime 内部完成 credential exchange、refresh 与 Realm invocation，
并删除 app/host/SDK bearer provider 或 direct Realm path。

## K-ACCSVC-014 与既有 Auth 服务的关系

- account session 回答 “谁登录在本机 Runtime”。
- app session 回答 “哪个已注册 app instance 在调用”，由 `RuntimeAuthService` 拥有。
- external-principal session remains a binding-only `RuntimeAuthService`
  concept. The removed public credential-grant family cannot be restored; no
  external session can upgrade into local protected account authority.

`K-AUTHSVC-012` 必须被 split：app session 保持内存且重启即失，account session 使用 secure Runtime custody 与重启恢复（见 K-ACCSVC-007、K-ACCSVC-011）。

scoped binding 的 subject 必须由 Runtime 从 account custody 内部派生，禁止使用调用方的 `subject_user_id`。

## K-ACCSVC-015 审计

- account 生命周期、binding 发放、binding 撤销、login attempt、refresh、logout、switch、custody 不可用 / 恢复 必须写审计。
- 最小字段遵循 `K-AUDIT-001`。
- 任何场景下都不得记录 token 值、auth code、PKCE verifier、refresh material。
- 审计字段必须包含 `account_id`（如适用）、`login_attempt_id`（如适用）、`binding_id`（如适用）、`reason_code`、`device_id`。

## K-ACCSVC-016 Device Identity

`device_id`（已在 `proto/runtime/v1/auth.proto` `RegisterApp` 中存在）参与：

- account custody 分区键
- login attempt audit 上下文
- scoped binding relation

`device_id` 不允许暴露给 Avatar 或本地首方 app 作为 account 真相。

## K-ACCSVC-017 Web / Cloud 边界

Web / cloud 模式不属于 local first-party Runtime account 模式。Web 应用可能没有本地 daemon，必须使用显式 Web/cloud adapter 与 Realm 直接交互。Web / cloud adapter 不得在 local first-party SDK / Desktop / default Avatar app 中可达。

任何 Web / cloud exception 都必须显式 fence，禁止泄漏到 local first-party Runtime 模式。

## K-ACCSVC-018 Realm-Owned Workspace Membership Projection

Workspace membership truth is Realm-owned product authority and is projected into
Runtime account custody/login/refresh as a redacted membership projection.
Runtime must not create a local workspace registry, accept caller-provided
workspace membership, or infer membership from `workspace_id`,
`subject_user_id`, app-local cache, SDK state, Desktop state, or knowledge bank
metadata.

Admitted projection shape:

- `workspace_id`
- `membership_state` in `active`, `suspended`, `revoked`, `unknown`
- `realm_environment_id`
- `observed_at`
- optional redacted display metadata

Fixed rules:

- workspace membership projection is derived only during account login,
  account refresh, custody recovery, or an admitted Realm membership refresh
  owned by `RuntimeAccountService`
- a missing, stale, unavailable, or `unknown` projection fails closed for
  workspace binding issuance and workspace binding consumption
- `active` membership is required at both issue time and consume time
- membership loss, realm-environment mismatch, custody unavailable, refresh
  failure, logout, account switch, policy revocation, or daemon restart must
  revoke or invalidate related workspace bindings before any positive
  WORKSPACE_PRIVATE allow can be returned
- projection may be surfaced to local first-party status only as redacted
  account projection; it must not expose Realm tokens, raw JWT claims,
  `subject_user_id`, or membership proof material that apps can replay

## K-ACCSVC-019 Workspace Binding Account Surface And Resolver Ownership

`RuntimeAccountService` is the only possible owner of workspace binding
issuance, revocation, and the internal resolver seam used by runtime knowledge
authorization. This rule admits no transport or origin for public
`IssueWorkspaceBinding` or `RevokeWorkspaceBinding`; both are explicit
`blocked_pending_authority` rows and ordinary authenticated, SDK, Desktop,
binding-only, local-app, Web/cloud, and external-principal callers
are denied. A future admission must name the exact protected origin and
operation policy before either method may be implemented or exported.

Fixed rules:

- workspace binding issue/revoke is workspace-specific authority and must not be
  implemented by broadening `IssueScopedAppBinding` / `RevokeScopedAppBinding`
- if independently admitted later, issue/revoke may only mutate workspace
  knowledge attachments and must not return account truth, membership truth,
  Realm tokens, or resolver decisions
- `ResolveWorkspaceBinding` is not a public RPC, not an SDK/Desktop-visible
  method, and not a probing surface; it is an internal Go/runtime capability
  consumed by `RuntimeCognitionService` through the cognition
  `KnowledgeAuthorizer` seam
- resolver matching must use Runtime-authenticated caller identity from the
  app session/envelope and account projection: `runtime_app_id`,
  `app_instance_id`, `device_id`, `account_id`, and `realm_environment_id`
- resolver matching must not use `KnowledgeRequestContext.app_id`,
  `subject_user_id`, attachment self-claims, app-local cache, Desktop state, or
  SDK state as proof
- issue-time validation and consume-time validation both require
  `K-ACCSVC-018` active membership for the target workspace
- account state other than `authenticated`, refresh/custody uncertainty, or
  stale workspace membership projection fails closed

## K-ACCSVC-021 Fresh Local Presence Verification

`RequestPresenceVerification` is a Runtime-owned user-presence check for
app surfaces that need a second confirmation before revealing sensitive local
data. The method confirms that the currently present operator passed a local
interaction owned by Runtime within a bounded TTL; it is not durable identity
proof. Realm may participate only through a Runtime-owned fresh Nimi reauth
provider; ordinary Realm session state remains insufficient.

Fixed rules:

- Runtime selects and executes the concrete provider chain: OS credential /
  Windows Hello/PIN / macOS LocalAuthentication first, Nimi reauth fallback, or
  another admitted local interaction.
  Apps and SDKs must not select providers by passing passwords, tokens, secrets,
  or raw challenge material.
- A current authenticated account session is necessary for account projection
  but is never sufficient for positive presence verification.
- Realm login, access-token refresh, `GetAccessToken`, `InvokeRealmUnary`,
  server-side `/me`, or app-owned session checks do not satisfy this method.
- Runtime-owned `NIMI_REAUTH` may satisfy this method only when Runtime forces a
  fresh Realm OAuth login prompt, owns the loopback callback, allocates that
  callback only on loopback ports `1024..49151` below the OS dynamic-port
  range, validates state/code-verifier exchange, verifies the returned account subject matches
  the current Runtime account, and discards any token material instead of
  turning it into app-owned session truth.
- On Windows, the fixed restricted-service principal cannot acquire an
  interactive-user token merely to launch a browser. For a protected Desktop
  control operation only, Runtime may therefore deliver its generated
  authorization URL to a single-use, random, loopback-only Desktop browser
  launcher. Runtime MUST first derive the protected Desktop transport/process
  origin and MUST reject non-loopback, redirected, or malformed launchers. The
  launcher endpoint MUST be random and single-use; reuse or delivery failure
  fails closed. Runtime MUST retain the OAuth attempt, state, nonce, PKCE
  verifier, callback, exchange, subject match, and final presence verdict. The
  launcher receives no bearer or verifier, cannot select a provider, cannot
  assert completion, and is neither authorization nor presence proof. The
  launcher endpoint is request-scoped technical metadata only and MUST NOT be
  persisted or logged.
- The request must carry a non-empty `purpose` and a bounded TTL. Runtime may
  clamp TTL downward. A positive response must include a `verified_until`
  timestamp no later than the accepted TTL window.
- If Runtime has neither a formal local presence verifier nor a formal fresh
  Nimi reauth fallback for the host / Realm configuration, the method returns
  `accepted=false`, state `unavailable`, account reason
  `presence_verification_unavailable`, and no sensitive app data may be shown.
- Provider result, method, state, and expiry may be projected to the caller, but
  provider secrets, password material, bearer tokens, and OS challenge details
  must never be returned or logged.

## K-ACCSVC-020 Fail-Close Doctrine

Fresh presence verification also follows this doctrine: a missing, unavailable,
cancelled, expired, or non-verified provider must fail closed and must not be
replaced by ordinary login state, access-token state, Realm server state, or
app-owned prompts. The only Realm-backed exception is the Runtime-owned
`NIMI_REAUTH` flow defined in `K-ACCSVC-021`.

以下情况必须 fail-close，禁止伪造成功：

- account state unknown
- custody unavailable
- binding 不存在 / state 非 `active`
- login proof expired / replayed / mismatched
- refresh 失败且无可恢复路径
- daemon restart 后无法恢复 custody
- remote revocation 检测失败但无法证明本地 session 仍有效
- account projection 缺少必需字段

## K-ACCSVC-022 Local App Caller Posture

`K-PLOCAL-008` admits a local-app session only from an atomically consumed
launch lease on the verified child channel. The `LOCAL_APP` caller class and
`local_app_principal_id` are Runtime-derived; the request cannot select caller
class, account, principal, record, permission decision, release or capabilities.
Account-control and credential-bearing methods remain denied. A zero-permission
session is valid origin proof and may use only base entitlements and its own
public permission posture. It cannot list protected Agent/account/resource
inventory. Every user-permission operation remains unavailable until its full
P-PERM-017 slice is admitted.

`RuntimeAccountService` owns the private provenance-agnostic per-operation
coordinator. On every selected local-app operation it combines the current
account generation when required, `K-APP-*` principal/record resolution,
`K-PLOCAL-*` live process/session resolution, the current owner permission
decision when the authority class requires it, and the canonical operation
owner policy. The
coordinator returns one immutable decision and audit context; it owns none of
those inputs and creates no secondary cache or portable credential. Missing,
expired, revoked, denied, tombstoned, process-mismatched or account-mismatched
inputs deny the operation. Immutable provenance remains an opaque input seam and
returns typed unavailable until 0P/P admits a producer.

## K-ACCSVC-023 Protected Desktop Realm Broker

`RuntimeAccountService.InvokeRealmUnary` admits only the exact Desktop
source-readiness operations enumerated by
`tables/realm-broker-operations.yaml`: world list/detail reads, public source
detail, PersonaCharacter list/get/discovery, and WorldCharacter detail with
its bound entity and relationships. Packet issuance is not a broker operation;
RuntimeAgentService acquires it internally for `MaterializeRealmSource`. Each
broker row remains Desktop-shell-only and requires the verified protected
Desktop control origin, the `desktop_account_host` role, the host-bound caller
envelope, and the current authenticated account. An unlisted operation or any
non-Desktop caller fails with `BROKER_OPERATION_NOT_ADMITTED`; generic proxy
behavior is forbidden.

Runtime alone selects the configured canonical Realm base, holds and refreshes
the Realm bearer, injects authorization, validates the row-specific OpenAPI
request shape and response-size limit, and rejects credential-bearing response
headers or bodies. No public grant, portable envelope, renderer/app token
provider, caller-selected Realm base, direct Realm path, or fallback is
admitted.

## K-ACCSVC-024 Account RPC Permission Matrix

The Desktop account projection/control, scoped-binding control, local-app public
permission status/request, selected local-app operations and Realm-broker
transport prerequisites are admitted only through their exact protected-
transport and owner rows. There is no public permission decision or revoke RPC. This
admits no portable envelope, blanket local-app authority or raw-token
projection. Unlisted broker/realtime/media operation rows remain denied.

`tables/account-rpc-permission-matrix.yaml` is the executable authority for
per-caller RuntimeAccountService admission. Runtime handlers must enforce the
matrix before state mutation or token/credential access. `InvokeRealmUnary`
uses broker-consumer admission, not the account-control helper.
Runtime-private refresh is a non-RPC internal capability and has no public
local-app caller mode.
Each `allow_when` row that already requires `protected_desktop_control_origin`
or `protected_local_app_origin` resolves that requirement through the matrix's
`platform_transport_binding` to the corresponding abstract protected transport
class and same-OS profile. Missing or ambiguous resolution fails generation;
the existing bundled first-party requirement remains outside the protected
local transport matrix and is unchanged.

## K-ACCSVC-025 Host-Bound Caller Envelope

App id, source host, caller enum, manifest, renderer metadata, host
self-description, launch id and portable bearer remain non-authorizing. Local
app authority comes only from the inherited native channel and its verified live
peer. Direct local gRPC and Electron/Tauri renderer envelopes remain deny-all.

## K-ACCSVC-026 Local App Authority Coordinator And Presence

For each local-app operation, Runtime first resolves the authority class from
`P-PERM-015`. A base entitlement evaluates the exact principal, local record,
process-bound session, current account partition, path/quota and owner policy,
but must not require a user permission. A user permission additionally requires an
admitted public permission id, owner-issued selector, current owner lifecycle,
permission-to-operation mapping, presence when required, and the operation
owner's exact resource policy in one decision. App-owned commands and OS rights
do not enter this coordinator. Enabling Developer Mode, admitting a project,
opening a session, or being first party creates no synthetic permission.

Presence follows `tables/local-app-presence-protocol.yaml`. Only a
Runtime-owned OS verifier or fresh `NIMI_REAUTH` result can satisfy it. Caller
assertions, renderer prompts, login state, bearer state and prior sessions do
not. The coordinator records `local_app_principal_id`, the exact immutable or
development principal-lineage branch, record/session identifiers and revisions,
the permission decision revision only when an admitted user permission applies,
account id/generation, process
identity, permission id when applicable, internal operation and deny reason in the Runtime audit context without
logging credentials. No downstream service may reinterpret or weaken this
decision.

K-AGCORE-006e is not a base entitlement. Until `agents.interact` has a complete
admitted selector, lifecycle, SDK/Kit, UI, audit, revoke and endpoint slice,
third-party Agent inventory and conversation operations remain unavailable.
No old operation grant or caller-selected Agent id can promote them.

---

<!-- source: .nimi/spec/runtime/kernel/config-contract.md -->

# Runtime Config Contract

> Owner Domain: `K-CFG-*`

## K-CFG-001 Canonical Config Path

Production Runtime configuration is service-principal-owned state at the
OS-profile-specific protected location in
`tables/protected-local-runtime-principal-profiles.yaml`. Its physical path is
not a Desktop/SDK/public CLI interface and is never projected to renderer or
app callers. `~/.nimi/runtime/config.json`, `~/.nimi/config.json`, and any other
user-writable file are forbidden production inputs. This pre-release hardcut
imports no retired config or credential material.

The non-release development updater has one narrower, non-Runtime exception:
before invoking the signed installer it may read only the exact `dataRootRef`
field from the current `~/.nimi/runtime/config.json` and promote that value to
an explicit installer selection. The Runtime service never reads that file,
none of its other fields enter protected configuration, and a missing,
malformed, relative, volume-root, or inaccessible value fails before build or
installation. This is updater input selection, not production Runtime config
authority or a compatibility fallback.

## K-CFG-002 Source Priority

Production source authority is the closed partition in
`tables/config-schema.yaml`: signed OS service/release boot security,
service-owned immutable/mutable state, Runtime-private secret custody, then
spec-governed defaults where the field permits a default. Environment
variables, argv, user-writable config, renderer metadata, and app manifests
have no production selection priority because they are rejected inputs.

## K-CFG-003 Schema Version

Service-owned state must contain `schemaVersion`, currently `1`. Every field
belongs to exactly one production authority class. Unknown fields are rejected;
they are never ignored for forward compatibility.

## K-CFG-004 Provider Name Canonicalization

配置中的 provider 名称必须使用 `provider-catalog.yaml` 的 canonical 值，alias 与 legacy 名称必须拒绝。

## K-CFG-005 Secret Policy

Provider records may contain only an opaque `credentialRef`. The referenced
material is created and resolved inside Runtime service-principal custody.
Inline `apiKey`, `apiKeyEnv`, process-environment lookup, user-session generic
keyring/vault storage, renderer projection, and app-provided secrets are
forbidden production shapes.

## K-CFG-006 Atomic Write

Runtime writes service-owned non-secret state with fail-closed atomic replace,
owner-only ACLs, symlink/reparse-point refusal, and durability appropriate to
the OS profile. Secrets use the protected custody backend defined by
K-ACCSVC-007 and `tables/protected-local-custody-profiles.yaml`; they are never
serialized into the non-secret state document.

## K-CFG-007 Runtime Command Surface

Production configuration is mutated only through typed protected control owned
by Runtime. Desktop may receive redacted typed status and may request an
admitted mutation; public CLI `config init/get/set`, arbitrary JSON patching,
physical-path access, and whole-document reads are not production surfaces.
Any retained command is a separately signed synthetic non-product fixture and
cannot provide product evidence.

## K-CFG-008 Validation Fail-Close

配置校验失败必须 fail-close，不得以部分成功继续启动核心路径。

## K-CFG-009 Provider Env Binding

`provider-probe-targets.yaml` environment bindings are non-product probe
fixtures only. Production provider endpoint and credential selection comes
from Runtime-owned connector/provider state; an environment variable can
neither create nor override a production provider record.

## K-CFG-010 Hot Reload Boundaries

配置变更的热生效与重启生效边界必须显式声明，不允许隐式生效。

已声明的边界：

- Service-owned Runtime configuration follows the per-field `restart`, `hot`,
  or `immutable` disposition in `tables/config-schema.yaml`; callers cannot
  infer reload behavior from a physical document.
- Runtime Agent AI Config（K-AGCORE-144~150）不属于本契约的 machine
  config plane。它经 RuntimeAgentService RPC 持久化于 runtime store，热生效，
  粒度为 next-turn：变更不影响 in-flight turn 的 execution snapshot。

## K-CFG-011 Credential Plane Boundary

Configuration may carry opaque credential references only. Interactive product
credential capture terminates at a Runtime-owned protected connector/control
operation, which stores the credential under the isolated Runtime principal
and returns only redacted typed state. Desktop, public CLI, SDK, and app callers
must not persist, cache, replay, or re-submit raw credential material after that
operation. There is no inline-memory or user-file success fallback.

Source materialization proof verification uses the configured Realm issuer and
JWKS trust chain plus a closed materialization-purpose signing-key registry.
Runtime accepts only detached JWS with `alg=RS256`, a JWK with `use=sig`, and a
`kid` admitted for the materialization purpose. An unknown `kid` may trigger one
controlled JWKS refresh; unknown, removed, revoked, wrong-purpose, wrong-use, or
wrong-algorithm keys fail closed. Active and retiring verification keys follow
the Realm rotation window, while a revoked key is rejected immediately.

No source-materialization shared verifier secret belongs in Runtime machine
config. Desktop, SDK, Kit, apps, packet fields, and provider metadata cannot
supply or override issuer, JWKS, key purpose, or proof verification truth. The
materialization-purpose registry is verification policy, not a credential
projection or caller-extensible free-form map.

## K-CFG-012 Default Value Governance

默认值必须在 kernel 表格中有可追溯来源，不允许散落在实现层文档。

## K-CFG-013 Cross-Layer Projection

Desktop/CLI/SDK 对 runtime 配置行为的投影必须与本契约保持语义一致。config 允许声明：

- top-level `defaultLocalTextModel`，用于覆盖 bundled local default text target
- top-level `defaultCloudProvider`
- provider-scoped `defaultModel`

其中 machine-default cloud target 由 `defaultCloudProvider + provider.defaultModel`
形成。

- Runtime Agent AI Config alias bindings consume admitted default target
  aliases rather than copying concrete targets into every agent record. The
  default alias family includes `local/default`, capability-specific local
  defaults, `local/default-embedding`, and `cloud/default`.
- Changing a default alias target is an admitted app-facing Runtime config
  mutation surface with explicit scope, audit, and Runtime Agent AI Config
  readiness recompute. Alias-bound agents observe the new target on their next
  turn; pinned agents are unaffected. This package records the authority only;
  implementation of the mutation RPC and Agent Center Model UI is a separate
  follow-up package.

- 对 `static_source` provider：当 provider 未显式覆盖 `defaultModel` 时，
  higher-level surface 可以回退到 provider catalog 的
  `default_text_model`。
- 对 `dynamic_endpoint` provider：higher-level surface 不得回退到 provider
  catalog `default_text_model`。必须使用显式 `provider.defaultModel`，或由
  UI/route 提供 live-selected model；若两者都缺失，runtime 必须 fail-close。

`nimi run --cloud`、provider-only high-level CLI/SDK 等 surface 不得绕过这组
配置语义。

## K-CFG-014 Service Schema Transition Framework

Future service-owned schema transitions require an admitted release transition
plan with exact `from_version`, `to_version`, field changes, defaults,
anti-rollback rules, and fail-closed conditions. They operate only on state
already owned by the isolated Runtime principal. This pre-release cutover does
not import, inspect, back up, or transform user-session/retired configuration.

## K-CFG-015 Transition Execution Semantics

The signed Runtime release performs any admitted service-owned transition
before protected listeners open. It is deterministic, idempotent, atomic, and
anti-rollback anchored. Failure leaves no partially admitted state and keeps
the service unavailable. Desktop/CLI/SDK never execute or select transitions.

The signed `dev_kernel_checkpoint` profile is a closed non-release exception,
not a production schema transition. Its binary identity and durable development
state identity are separate. `runtimeCandidateId` binds the exact current
signed build record but never selects the state partition. On first installation
the installer creates a cryptographically random `acceptanceRoundId` and records
the then-current candidate as `developmentStateCandidateId`; together with the
bounded trial id these fields form the durable development state lineage.

An ordinary signed Runtime update must preserve that exact lineage. Product
Control, Runtime identity, local-app kernel state, durable grants, model
registry, audit state, and service-owned mutable config therefore survive a
binary candidate rotation instead of being silently replaced by an empty
candidate directory. Account token custody and durable local-project consent
remain in their independently stable protected stores. A new lineage may be
created only by an explicit destructive repair/reset operation, never merely by
installing a new candidate, restarting Desktop, or rotating the Runtime boot
epoch. Malformed or unavailable lineage state fails the update closed; the
installer does not guess a new directory.

Payload reuse still does not imply readiness by file presence. The updated
candidate must verify its current catalog hashes, manifests, and activation
requirements, but unchanged verified payloads are not downloaded again.
Existing or partially damaged records retain the normal Product Control
repair/fail-closed path. Production configuration, HOME/TEMP, renderer state,
environment, argv, endpoint selection, and request payloads cannot activate or
reset the development lineage.

The signed installer preserves an existing non-empty explicit development
`nimi_data` binding when it rotates the binary candidate, unless the operator
supplies a different explicit binding to that installer invocation. The
development updater may obtain that explicit value only from the bounded
`dataRootRef` read described by K-CFG-001. The installer validates and records
the exact path; the Runtime service does not read the user file. A missing,
malformed, inaccessible, or reparse-point binding fails the update closed
instead of silently falling back to a candidate-specific payload root.

The same profile binds account OAuth, token exchange, JWT issuer, JWKS, and
revocation to one exact real Realm development deployment so the checkpoint
exercises a controlled production account through Runtime custody. The binding
is installer-owned and candidate-bound; user environment, argv, renderer state,
or a request cannot select it. Its loopback fixture origin is a separate
non-authorizing field used only for the signed non-release provider seed. A
shared Realm/provider endpoint field, fixture-issued account token, automatic
fixture authorization redirect, alias, or fallback is forbidden.

For First Run acceptance, Runtime may additionally project one visible
`nimi_data` proposal. When the signed installer recorded an explicit absolute
development data-root binding, that candidate-bound protected profile field is
the proposal and the Runtime data-plane roots resolve below it. Otherwise the
proposal is derived from the verified interactive Windows SID's OS profile
mapping, the signed trial id, and the build-record-verified Runtime candidate
id. The proposal is not a Product Control record field and cannot select the
data root or create readiness; explicit confirmation through the normal typed
Product Control operation is still required. The protected service cannot
derive the binding from HOME, USERPROFILE, TEMP, renderer state, environment,
argv, endpoint, or a Runtime request payload. The signed installer must reject a missing,
non-absolute, volume-root, reparse-point, or inaccessible explicit binding.
The installer may source that exact field from the preceding protected profile
when rotating a candidate, subject to the same validation. The development
updater may instead pass the canonical user-config `dataRootRef` as an explicit
selection, but the installer and Runtime never consume any other user-config
field.

### First-party product acceptance build profile

The developer-signed `first_party_product_acceptance` build profile is a
separate closed, non-release, non-promotable exception for installed-product
acceptance against the admitted local Realm development deployment. It changes
only the Runtime account Realm, OAuth, token, issuer, JWKS, and revocation base
from the release-fixed `https://realm.nimi.ai` to the build-fixed
`http://localhost:3002`. The exact profile identity is compiled into the signed
Runtime binary, recorded in its source-bound build record, and must match an
explicit signed-installer mode. Environment, argv, mutable service state,
renderer input, and arbitrary installer endpoint input cannot select or alter
that endpoint.

This profile does not admit a fixture, seed, provider endpoint, model default,
data-root selection, alternate service principal, compatibility path, or
dev-kernel checkpoint state. It uses ordinary product configuration and state
semantics apart from the exact local Realm endpoint projection. A release
`production_build` continues to use only `https://realm.nimi.ai`, and a
`dev_kernel_checkpoint` candidate remains the only build that may carry its
separately bounded provider fixture and seeded checkpoint identity.

## K-CFG-016 Transition Backup & Drift Boundary

Automatic backups cannot restore older security-critical generations, executable trust,
listener, or custody authority. Recovery material is version-bound and
service-principal protected; restoration requires the same or newer admitted
installer-owned active release. User files and old generic keyring/vault entries are not
recovery inputs.

## K-CFG-017 Phase 1 Field Authority

Production Runtime fields and their authority classes are defined by
`tables/config-schema.yaml`. The table records type, default, reload semantics
(`restart`/`hot`/`immutable`), source rule, closed field partition, forbidden
inputs, and redaction boundary.

配置字段的新增或修改必须先更新 `tables/config-schema.yaml`，再同步相关合约文档。

## K-CFG-018 Data Root Reference And Service Posture Boundary

Runtime service-owned state may store `dataRootRef` and derived managed roots for models,
dependencies, environments, logs, and audit. These fields are Runtime-owned
daemon/materialization configuration and must be reconciled from the product
control record selected `nimi_data`.

Runtime config also owns its own daemon identity and service posture:

- `runtimeId` is the stable local Runtime daemon identity. It is generated once
  by the service and is immutable for the lifetime of service-owned state.
- `localService.enabled` and `localService.mode` declare the Runtime local
  service posture. `localService.mode` is restricted to the closed value
  `desktop-local` for the on-device Phase 1 product.

Runtime config does not own first-run product state, install level, account app
library, account profile library, permission grants, or app durable data.
The product-control service may project selected `nimi_data` through an exact
typed protected operation. Conflicts fail closed; Runtime never reads the
user-writable product-control file as configuration truth.

On Windows, before that exact mutation is sent, the verified native Desktop
host must prepare the user-selected data-plane root through the shared Kit OS
adapter. Preparation preserves the interactive user as the root owner, rejects
a reparse-point root, and grants inheritable modify authority only to the exact
restricted `NT SERVICE\NimiRuntime` service SID needed for Runtime-managed
children. Runtime still independently validates the absolute path, creates the
closed managed-root layout, and owns the service-state write. Renderer code may
neither name a SID nor mutate an ACL, and an environment variable, endpoint,
direct daemon, broad principal grant, or test-only service identity cannot
satisfy this handoff. Failure to prepare or validate the root leaves
`dataRootRef` empty and first-run blocked.

The Runtime page `Environment` surface reads the `nimi_data` data-plane roots
(`models`, `dependencies`, `environments`, `logs`, `audit`) as a Runtime-owned
read-only data model derived from `dataRootRef` and `managedRoots`; it does not
introduce a second config authority.

The data-plane roots are also the only admitted install location for Runtime
local environment materialization. `local-environment-dependencies.yaml` binds
each dependency family to one of these root ids through its `managed_root`
field: `models` for model and companion asset payloads, `dependencies` for
standalone downloaded dependency payloads (the `uv` tool, the shared
accelerator/CUDA runtime), and `environments` for Nimi-managed executable
environment trees (native engine packages, the managed Python interpreter,
venvs, package sets, Torch wheels). The engine manager, native engine package
installers, and Python dependency materializers must resolve their install root
from `dataRootRef` / `managedRoots` and must not use `~/.nimi/engines` or any
other home-directory root. When `dataRootRef` is empty the managed install
fails closed into product setup rather than guessing a path.

---

<!-- source: .nimi/spec/runtime/kernel/rpc-surface.md -->

# RPC Surface Contract

> Owner Domain: `K-RPC-*`

Split authority map:

- `rpc-route-describe-contract.md`: K-RPC-015..023
- `rpc-local-service-contract.md`: K-RPC-004 and K-RPC-004-state
## K-RPC-000 Runtime Target Identity v2 Hard Cut

AI RPC request surfaces consume v2 durable target refs or resolved binding
inputs. Raw `model_id`, `target_model_id`, and `connector_id + model_id` are
not admitted durable target identity. Catalog RPCs may retain provider/catalog
model ids as non-identity facts.

## K-RPC-001 服务范围

`tables/protected-local-rpc-transport-matrix.yaml` is the sole protected
transport/origin authority for Desktop account-control, the host-neutral
local-app launch/session/permission surface, immutable-package typed-unavailable
operations, and Runtime-private refresh. Method presence in proto or
`config/runtime-rpc-methods.yaml`, a loopback listener, and an authenticated portable
session do not grant those roles. `OpenDesktopSession` retains Desktop account
control semantics; third-party apps use only `PrepareLocalAppLaunch`, native
process binding, and request-empty `OpenLocalAppSession` on the verified
local-app connection. The native host may rotate the resulting short-lived
technical session only through request-empty `RenewLocalAppSession` on that
same verified `local_app_host` connection; this is not an SDK or renderer
operation and never creates portable authority.

Runtime kernel 的 RPC 覆盖范围为 admitted proto 服务与已定义的 design-first service surface：

**Phase 1（AI 执行平面 + Auth Core + Account Core）：**

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalService`
- `RuntimeAuthService`
- `RuntimeServiceControlService`（仅受保护 Desktop control 上的 request-empty Runtime self-exit；SCM recovery 与新进程验证后才完成重启）
- `RuntimeExternalAgentService`
- `RuntimeAccountService`（local first-party account session / scoped app binding 权威，方法集合见 `account-session-contract.md` `K-ACCSVC-002`，与 `RuntimeAuthService` 不重叠）

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeCognitionService`（`K-MEM-*`, `K-KNOW-*`, `K-RPC-004a`）
- `RuntimeAgentService`（`K-AGCORE-*`, `K-RPC-004b`）
- `RuntimeAppService`（`K-APP-*`）

补充约束：

- `rpc-migration-map.yaml` 标记为 `design_only_no_proto_contract` 的 service 仍属于 design surface，不构成已 admitted 的 proto contract
- 设计态 service 进入 implementation-facing proto 前，仍受 `proto-governance-contract.md` 的 `K-PROTO-011` 约束

## K-RPC-002 AIService 方法集合（design 权威）

`AIService` 的 active method inventory、method type 与 proto mapping 只由
`config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml` 维护。本节只定义
scenario family 的 RPC 语义与边界，不维护第二份方法清单。

说明：

- text/image/video/audio 等多模态输入能力属于现有 scenario 的输入扩展，不新增顶层 `multimodal.generate` RPC
- `TEXT_GENERATE` 的多模态 uplift 继续复用 `ExecuteScenario` / `StreamScenario`
- 大媒体 upload-first ingress 通过 `UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用
- duplex realtime session 不属于 `AIService`，统一走独立 `RuntimeAiRealtimeService`
- app-facing `runtime.route.describe(...)` metadata projection 由 `K-RPC-015` ~ `K-RPC-021` 约束；Phase 1 不得为其新增 daemon 顶层 RPC method

## RuntimeAiRealtimeService 方法集合

`RuntimeAiRealtimeService` 的 active method inventory、method type 与 proto
mapping 只由 `config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 realtime session family 的 RPC 语义与边界。

说明：

- v1 realtime session 只为 text/audio 双向会话预留 contract，不承担 `video + audio -> video + audio`
- `ReadRealtimeEvents` 为 server-stream；duplex 语义通过 `Open + Append + Read + Close` 组合实现
- v1 provider-backed 实现范围固定为 llama text+audio session；其他 provider 未实现时必须 fail-close，不得伪装成 `AIService` 普通 scenario
- `RuntimeAiRealtimeService` 是独立 realtime multimodal session 面，不是 ordinary
  Runtime Agent voice output。agent 自定义音色语音输出必须走 scenario-layer
  `audio.synthesize`（`RuntimeAiService`）语义，不得直接把该 realtime session RPC
  当 agent voice output（边界见 `K-MMPROV-031`、`K-VOICE-019`、`K-AGCORE-133`）。
  其 `RealtimeAudioChunk` 只属于 realtime session 事件流，不是 scenario 语音流
  delta 或 agent voice stream chunk。
- `RuntimeVoiceService` 不是公共契约面（`K-VOICE-008`）；voice 对外方法收归
  `RuntimeAiService`。任何以 `RuntimeVoiceService` 命名的独立公共 service 均越界。

## K-RPC-003 ConnectorService 方法集合（design 权威）

`ConnectorService` 的 active method inventory、method type 与 proto mapping
只由 `config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml` 维护。本节只
定义 connector custody、catalog、overlay 与 credential shape 边界。

ConnectorService 当前与 proto `RuntimeConnectorService` 对齐（见 `tables/rpc-migration-map.yaml` 中 `mapping_posture=aligned`）。

ConnectorService 在 `CreateConnector` / `UpdateConnector` 上的 credential request shape 固定为：

- `api_key`：`auth_kind=API_KEY` 的 legacy-compatible field
- `auth_kind`：managed connector credential family discriminator
- `provider_auth_profile`：OAuth-managed connector 的 provider profile token；唯一事实源是 `tables/connector-auth-profiles.yaml`，并且必须与 provider 兼容
- `credential_json`：OAuth-managed connector 的 provider-defined sealed payload
- `credential_json` 在当前 admitted scope 只承诺被 runtime 当作 sealed
  payload 托管；RPC 面不承诺统一 refresh schema，也不承诺 runtime 拥有 OAuth
  login/refresh orchestration

这些字段只定义 connector custody 与 patch 语义，不等同于 app-facing inline credential metadata contract。

## K-RPC-026 RuntimeExternalAgentService 方法集合

`RuntimeExternalAgentService` 是 External Agent gateway / token ledger /
action registry / audit projection 的 Runtime-owned app-facing RPC surface。
Desktop、Web、Kit 与 apps 只能通过 SDK typed projection 消费该 service，不得
通过 Tauri、本地 SQLite、renderer-local registry 或 app-local HTTP server 维护并行
gateway/token/action/audit 真源。

`RuntimeExternalAgentService` 的 active method inventory、method type 与 proto
mapping 只由 `config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 gateway / token ledger / action registry / audit projection
边界。

在 Runtime-owned action registry/server 尚未启用前，service 必须 fail closed：
status 返回 disabled / `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`，token issuance
与 revoke 以 structured Runtime error 拒绝，不得发出 host-local token、伪造
token mutation success 或伪造 action success。

## K-RPC-004a RuntimeCognitionService 方法集合

`RuntimeCognitionService` 是 runtime-facing cognition overlap 的唯一稳定
RPC 面。

`RuntimeCognitionService` 的 active method inventory、method type 与 proto
mapping 只由 `config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 memory / knowledge / admitted memory-embedding runtime
families 的 RPC 语义与边界。

固定约束：

- `RuntimeCognitionService` 取代 `RuntimeMemoryService` 与
  `RuntimeKnowledgeService` 作为唯一 runtime-facing cognition service
  topology
- public surface 只暴露 Nimi-owned typed contract；provider-native API truth、
  cognition internal storage、以及 runtime-private review/bank/replication
  truth 均不得外露
- memory embedding runtime intent / inspect / bind / cutover family 属于
  `RuntimeCognitionService` 中 admitted 的 Runtime-owned host-local typed
  surface；SDK、Kit、Desktop 与 apps 只能提交 typed request 或消费 typed
  projection，不得拥有第二份 memory embedding 配置或 cutover 真源
- `Working memory` 不属于 `RuntimeCognitionService` 方法范围
- public app-facing 路径只服务 infra scopes；canonical scopes 通过
  runtime-private typed path 由 runtime-owned owner 消费
- `Reflect` 被明确退休，不再属于 steady-state public RPC；canonical review
  仍由 `RuntimeAgentService` 与 retained runtime-private memory depth 拥有
- absorbed memory/knowledge 方法族必须保留 fail-close 语义；不得以
  adapter-first 方式重新引入 dual-owner public surface
- host product 若需要 memory embedding resolved state、canonical bind、rebuild、
  或 cutover command，必须通过 admitted `RuntimeCognitionService` typed
  method 或 Runtime implementation-internal typed path；这不构成 SDK、Kit、
  Desktop、Tester 或其它 apps 的配置/绑定/cutover authority

Access posture is table-owned by
`tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml`. Runtime-owned
internal callers may use runtime-private typed paths only where the service
implementation admits them; app-facing public authz must not be bypassed by
SDK, Kit, Desktop, Tester, or other apps.

## K-RPC-004b RuntimeAgentService 方法集合

`RuntimeAgentService` 是 runtime-owned live agent substrate 的唯一稳定
design RPC 面。

当前 implementation-facing proto transport 必须直接对齐
`RuntimeAgentService`；`RuntimeAgentCoreService` 不再是 admitted transport
name。design/proto 关系以 `tables/rpc-migration-map.yaml` 为准。

`RuntimeAgentService` 的 active method inventory、method type 与 proto
mapping 只由 `config/runtime-rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 agent lifecycle、conversation anchor、companion
participation、delegation, avatar debug, presentation, state/autonomy/hooks,
agent memory, group-message candidate, and event family boundaries.

固定约束：

- agent canonical memory write policy 固定由 RuntimeAgentService 拥有
- agent canonical memory bank status/bind 的 app-facing projection 固定由
  `RuntimeAgentService` 拥有；SDK/app 不得从 memory embedding config、
  runtime-private inspect state、或 raw `GetBank` 组合 canonical bank mode
- apps 可以控制与消费 agent，但不得拥有 renderer-local agent truth
- proactive life scheduling 通过 typed HookIntent + host-owned admission 执行
- hook trigger detail、agent memory recall result、以及 failure/reschedule/budget-related agent events 必须使用 typed runtime messages，而不是自由 JSON payload
- app-facing state mutation contract 必须是 constrained command / patch family，而不是任意 agent-state blob replacement
- account-scoped source/profile and binding mutation require canonical durable
  mutation-event grammar on the runtime spec path, but this landing does not by
  itself expand the current public RPC method family
- app-facing reactive chat consumption does not add a second
  `RuntimeAgentService` RPC method family; the admitted transport seam is the
  reserved `runtime.agent` app-message target governed by `K-APP-008`
- agent voice native non-final chunk bytes use
  `RuntimeAgentService.SubscribeAgentVoiceStream` as the admitted typed
  data-plane for `K-VOICE-019`; presentation projection events only carry
  stream identity / transport refs and must not embed raw chunk bytes or mint
  per-chunk durable artifacts.
- agent voice playback interruption uses
  `RuntimeAgentService.InterruptAgentVoicePlayback`; it is a voice-stream
  lifecycle command and must not be collapsed into `runtime.agent.turn.interrupt`
  or app-local playback stop.
- current multi-agent admission is limited to durable delegation lifecycle and
  attribution visibility; it does not by itself admit delegated-authority trust
  semantics
- `turn` / `stream` terminal-coupling and temporal-autonomy deferral remain
  part of the canonical RuntimeAgentService authority cut even when they do not
  add new public RPC methods yet

Access posture is table-owned by
`tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml`; app-message access
for the reserved `runtime.agent` chat seam remains defined separately by
`K-RPC-004c`.

## K-RPC-004c RuntimeAppService reserved `runtime.agent` chat access matrix

`RuntimeAppService` 保留 `runtime.agent` reactive chat seam 的最小 access
matrix 固定为：

- `SendAppMessage` 发往 `to_app_id=runtime.agent` 且消息类型属于
  `K-APP-008` admitted ingress family：`runtime.agent.turn.write`
- `SubscribeAppMessages` 订阅中 `from_app_ids` 包含 `runtime.agent`：
  `runtime.agent.turn.read`
- generic cross-app `SendAppMessage`（非保留 `runtime.agent` seam）：
  `runtime.app.send.cross_app`

## K-RPC-005 Design 名称与 Proto 名称映射

`tables/rpc-migration-map.yaml` 是 design/proto 命名映射的唯一事实源。
本轮 AI 入口与 proto 对齐为场景协议命名（`ExecuteScenario` / `SubmitScenarioJob` 等），不再维护 Voice 独立服务映射。

## K-RPC-006 对外契约禁用名

以下名称只允许出现在实现层或迁移映射表，不允许作为对外契约名：

- `GenerateText`
- `StreamGenerateText`
- `SynthesizeSpeech`
- `ListTokenProviderModels`
- `CheckTokenProviderHealth`
- `SubmitMediaJob`
- `GetMediaJob`
- `CancelMediaJob`
- `SubscribeMediaJobEvents`
- `GetMediaResult`
- `SubmitVoiceJob`
- `GetVoiceJob`
- `CancelVoiceJob`
- `SubscribeVoiceJobEvents`
- `StreamGenerate`
- `SynthesizeSpeechStream`

## K-RPC-007 CreateConnector 字段契约

`CreateConnector` 必须满足：

- 请求体不暴露 `kind`；`CreateConnector` 成功创建的结果 `Connector.kind` 固定为 `REMOTE_MANAGED`
- credential shape 必须满足二选一：
  - `auth_kind=API_KEY`（或省略并走 legacy path）时，`api_key` 必填且非空
  - `auth_kind=OAUTH_MANAGED` 时，`provider_auth_profile + credential_json` 必填
- `api_key` 与 `credential_json` 不得同时出现
- `endpoint` 为空时按 provider 默认值注入
- `label` 为空时使用默认 label
- 成功写入时 `status=ACTIVE`，`created_at=updated_at=now`

## K-RPC-008 UpdateConnector 字段契约

`UpdateConnector` 必须满足：

- 至少一个可变字段（`endpoint/label/api_key/status/auth_kind/provider_auth_profile/credential_json`）
- `status=UNSPECIFIED` 非法
- `api_key`、`credential_json` 与 `label` 显式空串非法
- 切换 auth kind 时必须提供目标 auth shape 所需字段；服务端不得做隐式 credential family 转换
- 合法请求一律刷新 `updated_at`

## K-RPC-009 DeleteConnector 补偿契约

`DeleteConnector` 必须满足：

- 级联删除 credential
- 执行 `DELETE_PENDING` 补偿流程（可重试、可启动恢复）

## K-RPC-010 Remote 探测/发现前置校验契约

- `TestConnector(remote)` 出站前必须通过 owner/status/credential 校验
- `ListConnectorModels(remote)` 必须只读 active catalog snapshot，不得出站，也不得承担 endpoint 探测

## K-RPC-011 Connector 状态机锚点

`tables/state-transitions.yaml` 中 connector 相关状态机（`connector_status` 与 `remote_connector_delete_flow`）必须以本 Rule ID 作为来源锚点。

## K-RPC-012 Connector Model Catalog Read Semantics

`ListConnectorModels` 的 remote 读路径固定为：

- 数据来源：active catalog snapshot
- `force_refresh=true`：允许但必须是 no-op
- 返回结果：不得因为 provider live `/models` 差异而改变
- `TestConnector(remote)`：是唯一保留的非 scenario 出站探测入口，但其结果不得回填 `ListConnectorModels`

## K-RPC-012a Catalog Provider Model Browsing Surface

`ListCatalogProviderModels` and `GetCatalogModelDetail` MUST expose runtime model catalog truth after overlay merge, scoped to the caller subject user when identity is present.

- `ListCatalogProviderModels(provider, page_size, page_token)` returns provider metadata plus effective model summaries for one provider
- `GetCatalogModelDetail(provider, model_id)` returns one effective model detail projection from the resolved provider catalog
- provider metadata returned to desktop MAY include overlay presence, overlay timestamps, effective YAML, default endpoint facts, runtime plane facts, and source classification
- model metadata MUST classify each model row as `builtin`, `custom`, or `overridden`

## K-RPC-012b Catalog Overlay Mutation Surface

`UpsertCatalogModelOverlay` and `DeleteCatalogModelOverlay` are the stable structured mutation RPCs for personal catalog models.

- `UpsertCatalogModelOverlay(provider, model, voices?, voice_workflow_models?, model_workflow_binding?)` MUST validate against the runtime model catalog schema before activation
- capability-conditional validation remains fail-close at mutation time, including TTS `voice_set_id` and video `video_generation`
- overlay mutations are user-private unless the runtime is explicitly operating on a shared non-subject custom root
- `DeleteCatalogModelOverlay(provider, model_id)` MUST delete only the targeted overlay entry and restore the built-in effective model when one exists

## K-RPC-012c Advanced YAML Editing Scope

`ListModelCatalogProviders`, `UpsertModelCatalogProvider`, and `DeleteModelCatalogProvider` remain valid as advanced YAML operations.
When used by desktop catalog UX, these RPCs MUST target provider overlay fragments rather than full effective provider snapshots.

## K-RPC-013 ListPresetVoices 字段契约

`ListPresetVoices` 返回 provider 预置声音列表。

**请求字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 鉴权主体用户 ID |
| `target_ref` | RuntimeDurableTargetRef | 是 | v2 durable target ref or resolved binding input |
| `voice_asset_target_ref` | RuntimeDurableTargetRef | 否 | 目标声音资产兼容绑定（克隆/设计场景可选） |
| `connector_id` | string | 否 | post-resolve credential custody fact only; not durable model identity |

**响应字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `voices` | repeated PresetVoice | 预置声音列表 |
| `model_resolved` | string | 路由后模型 ID |
| `trace_id` | string | 请求追踪 ID |

**PresetVoice 字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `preset_voice_id` | string | 预置声音唯一标识 |
| `name` | string | 声音显示名称 |
| `lang` | string | 默认语言标签 |
| `supported_langs` | repeated string | 支持语言列表 |

**约束**：

- 结果为有界小集合，不分页（无 `page_size`/`page_token`）。
- 请求必须经过 key-source 解析（`K-KEYSRC-*`），`connector_id` 语义与其他 AI RPC 一致。
- 声音来源遵循 catalog 主路径，不允许无命名空间自由透传参数绕过。
- Voice 资产（用户克隆/设计声音）不由本接口返回；由 `GetVoiceAsset` / `ListVoiceAssets` 管理。

## K-RPC-014 Voice Asset 管理方法集合

Voice 相关资产生命周期收敛到 `AIService`：

1. `GetVoiceAsset`
2. `ListVoiceAssets`
3. `DeleteVoiceAsset`
4. `ListPresetVoices`

## K-RPC-024 RuntimeLocalService Local Environment Plan Surface

`RuntimeLocalService` owns app-facing projection and command surfaces for local
environment plans. These surfaces are downstream of `K-LENG-024` through
`K-LENG-027`; they must not create a second dependency truth owner.

Required logical operations:

1. Read host capability profile.
2. Resolve local environment plan for a requested local compute pack,
   capability, model install, model import, or repair request.
3. Read local environment dependency graph and selected source record
   projection.
4. Confirm dependency materialization when network or heavy setup is required.
5. Start, observe, cancel, retry, and repair Runtime-owned dependency jobs.
6. Project activation gate status for native engines and Python pipelines.

The concrete transport may use new RPC methods or extend existing
`RuntimeLocalService` local plan/job projection, but the public semantics must
preserve these constraints:

- cloud-only reads and Cloud API setup must not resolve or start local compute
  dependency materialization
- plan resolution is allowed to inspect Runtime-owned host capability evidence
  but must not trigger download or install
- first network materialization requires explicit confirmation or a surrounding
  model/capability install confirmation that clearly names the covered
  dependency families
- selected source records are Runtime truth; SDK and Desktop receive bounded
  projection only
- dependency job projection must include enough state to distinguish
  `needs_confirmation`, `queued`, `downloading`, `verifying`, `installing`,
  `ready_system`, `ready_managed`, `repair_required`, `failed`, `unsupported`,
  and `cancelled`
- no Desktop, SDK, engine, or app-level REST bypass may execute installers,
  probes, source selection, PATH mutation, or pseudo-ready projection on behalf
  of this surface
- activation gate projection exposes the logical operation
  `ResolveLocalEnvironmentConsumerActivation`; request, response, audit
  envelope, and reason-code semantics are owned by
  `local-environment-consumer-activation-contract.md`

## RuntimeLocalService Materializer Projection Surface Anchor

Detailed RuntimeLocalService materializer projection semantics are owned by
`K-RPC-025` in `local-environment-materializers-contract.md`; detailed
activation-gate projection semantics are owned by
`local-environment-consumer-activation-contract.md`. This section remains the
stable RPC Surface anchor and delegates read, confirmation, command, job
observation, activation-gate, and no-ordinary-user-installer rules to those
files.
