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
service-owned candidate root defined by the principal-profile table.

Service-principal semantics are platform-neutral: production Runtime is a
non-interactive OS service principal distinct from the interactive user; only
the signed installer may establish its fixed service definition; missing
principal isolation fails before custody or listeners. The same-OS row in
`tables/protected-local-runtime-principal-profiles.yaml` alone selects the
service manager, principal constraints, process isolation, control mechanics,
and acceptance isolation. The Windows row is the admitted current behavior.
The macOS launchd system-daemon row and Linux system-service row are
requirements-only and remain fail-closed pending independent native admission.

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
`desktop_account_host`, `local_app_control`, `local_app_process`, and
`local_app_session`. Runtime derives immutable/development provenance and
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
`.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml`
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

After that session exists, the verified Nimi Desktop shell has one additional
exact unary consumer set. It consists only of:

- `RuntimeLocalService/ListLocalAssets`;
- `RuntimeLocalService/ListNodeCatalog`;
- `RuntimeLocalService/CheckLocalAssetHealth`;
- `RuntimeConnectorService/ListConnectors`;
- `RuntimeAuditService/GetRuntimeHealth`;
- `RuntimeAuditService/ListAIProviderHealth`;
- `RuntimeAuditService/ListDesktopAuditEvents`;
- `RuntimeAuditService/ListUsageStats`;
- `RuntimeAiService/PeekScheduling`;
- `RuntimeAiService/ExecuteScenario`; and
- `RuntimeAgentService/ListAgents`.

Each call remains connection-, process-, session-, and boot-epoch-bound. The
protected carrier selects from this compiled method set; renderer metadata,
method ids, and serialized request bytes cannot add another method or role.
`ExecuteScenario` transport admission does not authorize a scenario, route, or
capability and does not bypass the existing handler-level request validation,
scheduling, execution, account, grant, or policy checks.

`ListDesktopAuditEvents` is additionally constrained by K-AUDIT-024: both
timestamps and the seven-day window are mandatory, pagination rejects values
above 100, and Runtime projects the exact nine-field event whitelist before
transport. Its admission does not admit raw `ListAuditEvents`, audit export,
payload content, subject/caller identifiers, authorization lineage, or audit
storage access.

This consumer set admits no stream and no generic Runtime proxy. In particular,
health-event subscriptions, connector-model enumeration, connector testing,
asset warming, conversation streaming, and every method missing from the exact
matrix remain typed unavailable before handler dispatch. The Desktop must not
fall back to public TCP. This addition changes no account custody, permission decision,
presence, Realm broker, storage, memory, media, local-app, development
authorization, lifecycle, dormancy, epoch, or public-listener semantics.

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
