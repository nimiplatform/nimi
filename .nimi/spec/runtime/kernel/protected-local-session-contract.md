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

Production Runtime account custody, connector/provider credential custody,
authenticated Realm mediation, protected state, anchor keys, and process memory
execute under the isolated OS service
principal selected by
`tables/protected-local-runtime-principal-profiles.yaml`. That principal is
distinct from the interactive Desktop user and every bundled, local-app,
renderer, and app-owned host principal. A same-interactive-user
Runtime process, user-session generic keyring, user-writable service definition,
or environment/argv-selected production endpoint cannot claim product
readiness. Missing service-principal isolation fails closed before custody load
or any listener. Same-user fixtures may exercise isolated unit logic only and
cannot open a product protected listener or serve as checkpoint evidence.
Service acceptance uses the same fixed production service principal with a
service-owned candidate root defined by the principal-profile table.

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
SCM PID and creation marker, a different `runtime_boot_epoch`, and a fresh
mutually verified protected handshake before projecting `running`. Public TCP,
local-app transports, portable credentials, service-name/path arguments,
direct SCM stop/start, and caller-selected timeout or recovery policy are
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
`local_app_bootstrap`, and `local_app_host`. Windows local-app launch consumes
`local_app_bootstrap` and the app process opens `local_app_host`. Immutable and
development execution profiles share the physical carrier and common session
contract; distinct principals/provenance/process bindings prevent inheritance.
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

## K-PLOCAL-008 Windows Local App Launch Lease And Common Session

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
or session admission. The child opens the fixed service-owned local-app pipe.
Runtime requires the native peer PID to match the retained bound process.
PID/bootstrap/path/argv/env/preload/renderer metadata are selectors only.

`OpenLocalAppSession` has an empty request and exists only on the verified
`local_app_bootstrap` connection already bound to the current lease/process/record.
Success atomically consumes the bootstrap, promotes that same connection to
`local_app_host`, and creates a session bound to
OS-user anchor, principal/record, provenance revision, release-or-project
generation, execution profile/digests, process tuple, account generation, and
current account id, and Runtime boot epoch. A valid identity may open with zero
grant for redacted permission posture and the K-AGCORE-006e bounded Agent
inventory bootstrap only. Inventory revalidates the same session facts but has
no grant/resource binding; every other protected business operation separately
resolves the current account-and-principal grant and owner policy.

The lease TTL is 30 seconds and process-bind deadline is 10 seconds. Duplicate,
expired, revoked, wrong process/principal/record/generation/account/epoch and
ordinary-gRPC calls fail closed. Logout/account switch, lifecycle/security
revoke, process replacement/exit, incompatible generation/profile change, and
Runtime restart revoke the applicable lease/session transactionally. Grant
mutation leaves identity session alive but changes the next operation decision.

After consumption, the connection retains only Runtime-private opaque session
state. The K-PLOCAL session row is the sole launch/process/session truth and
contains at most a non-authoritative observed grant revision. Every admitted
operation revalidates the live process, current record/account/grant and owner
policy; opaque handle, request metadata, or launch-time snapshot is insufficient.

Windows is admitted independently. macOS/Linux remain
`protected-carrier-required` until their native peer/process profiles are
admitted.

## K-PLOCAL-009 Local-Development Authorization And Session

Local development has two different lifetimes. Runtime owns the durable user
development authorization in protected service state. It binds the canonical
project root, app id, manifest capability fingerprint, current account id, and
the exact `local_development` provenance and an isolated Runtime-assigned
principal. `run_once` persists only while its Desktop-owned supervisor run
remains live, including a Runtime restart during that run. `remember_project`
preserves the principal/record authorization posture but becomes `dormant`
when the run ends and requires explicit current-account/presence/risk
`reactivate` before another launch. It never autostarts. Neither record is an immutable release,
signature, listing, production grant, or app-owned configuration truth.

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
session, storage, grant, and operation authority remain non-convertible. PID,
path, parent PID, argv, env, project
manifest, localhost, and a caller-supplied digest are never sufficient
authority.

Session proof and launch material remain Runtime/native-host private. They are
never returned through renderer IPC, CLI output, terminal environment, argv,
files, preload APIs, or app code. Kit may expose only typed status and admitted
business operations. Runtime revalidates authorization, capability
fingerprint, process liveness, supervisor liveness, account generation, boot
epoch, shell, controlled outputs, and operation policy on every call.

Renderer HMR/reload may retain the host process, but a controlled Electron
main/preload rebuild, Tauri Rust rebuild, host process replacement,
technical-session rotation, or Runtime restart must obtain a new launch lease,
process bind and session without another confirmation only while the user
authorization and supervisor run remain valid. Host or supervisor exit,
revoke, mode off, logout, account switch,
authorization mismatch, app/root/capability/shell change, uncontrolled output
or remote dev-server origin revokes the applicable launch/session before the
next operation. Account change requires a new confirmation.

The authorization, session, supervisor, reapproval, operation-applicability, and
non-conversion semantics in this rule are platform-neutral. Windows is the
first authority-admitted positive platform. macOS/Linux remain fail-closed pending independent native carrier
admission through their OS profiles. Immutable profiles remain typed
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

On Windows, the restricted Runtime service must not pre-open or retain an
interactive user's token. It resolves the active console session through
`WTSGetActiveConsoleSessionId`, consumes `WTSSessionInfo` for the account name
and logon-time marker, resolves the account SID through the OS, and creates the
named pipe with `FILE_FLAG_FIRST_PIPE_INSTANCE`, a service-owned connect-only
DACL for that active account SID, and `PIPE_REJECT_REMOTE_CLIENTS`. The account
partition binds user SID, terminal-session id, and WTS logon time so an OS
logout/login cannot reuse prior account truth merely by receiving the same
terminal-session id.

Runtime then obtains the connected client PID with
`GetNamedPipeClientProcessId`, opens that exact process and token, and derives
the user SID, terminal-session id, token logon SID and
`TokenStatistics.AuthenticationId`. Before `NetConn` or gRPC exposure,
Runtime performs one exact `LsaGetLogonSessionData(AuthenticationId)` lookup
and requires the LSA record to match that token LUID, account SID and terminal
session, use an admitted interactive logon type, carry a positive logon time
not later than the WTS session logon time, and still name the active console
session. Enumerating logon sessions or choosing the first matching account is
forbidden. The retained connection liveness re-queries the active WTS session;
an account, terminal-session or WTS logon-time change revokes the connection
and reopens a fresh pipe instance.

The client obtains the Runtime PID with `GetNamedPipeServerProcessId` and,
before sending protocol bytes, binds it to the fixed SCM service, exact service
token, closed process DACL and the same opened Runtime executable object. The
process DACL grants interactive callers only `SYNCHRONIZE`,
`PROCESS_QUERY_LIMITED_INFORMATION` and `READ_CONTROL` for this verification;
it explicitly denies sensitive VM, handle-duplication and thread-creation
rights. The process object's mandatory label remains System integrity and
uses only `SYSTEM_MANDATORY_LABEL_NO_WRITE_UP`; `NO_READ_UP` is forbidden
because it would override the exact DACL and prevent an ordinary interactive
Desktop from obtaining `READ_CONTROL` for mutual verification. Both peers
The Runtime primary-token object follows the same boundary: the exact service
SID retains full authority, while interactive callers receive only
`TOKEN_QUERY | READ_CONTROL`; token duplication, impersonation, primary-token
assignment and every adjustment right remain denied. Its mandatory label is
System integrity with `NO_WRITE_UP` only so the caller can verify the token
user, restricted service SID, session zero and logon LUID without receiving a
usable or mutable token. Both peers bind SID, OS logon session, PID, creation marker, and
executable trust to the handshake. An account-SID pipe connection alone never
authorizes a protected operation.

On Linux, the endpoint is a filesystem UDS in a Runtime-service-owned
directory/socket with an explicit connect ACL for the active interactive UID.
Abstract namespace sockets, symlinks, unexpected owners, and unexpected inodes
are forbidden. Both peers use `SO_PEERCRED` and verify the peer principal,
process, and executable. The Desktop side is a signed static control carrier
reached only through a private inherited Desktop handle; before connecting it
sets `no_new_privs`, installs the admitted seccomp filter that denies
`execve`/`execveat`, and marks every channel descriptor close-on-exec.

On macOS, the only production control endpoint is the privileged XPC Mach
service installed with the hardened LaunchDaemon. Both directions consume the
XPC audit token and validate the running peer's dynamic `SecCode`, designated
requirement, Team ID and cdhash. A filesystem UDS, ad-hoc
Mach service, user LaunchAgent or app-created listener is non-product and
cannot fall back when privileged XPC verification is unavailable.

The authenticated transcript binds `protocol_version`, `transport_class`,
both canonical process tuples, `runtime_boot_epoch`, `endpoint_instance_id`,
and `transcript_nonce`. Any mismatch fails before credential or application
data is accepted.

## K-PLOCAL-004 Process Identity and Liveness

The canonical process tuple is `{os, pid, creation_marker, os_login_session,
canonical_executable_identity, code_signing_identity}`. A release digest is
bound separately by installed launch/session admission; PID alone never
authorizes.

Windows retains a process handle with `SYNCHRONIZE |
PROCESS_QUERY_LIMITED_INFORMATION`. Linux requires a usable `pidfd`, the
signed no-exec control carrier, its exact inherited-channel bootstrap, and the
kernel-enforced seccomp filter that denies `execve`/`execveat` plus the
close-on-exec channel posture; pidfd alone is insufficient and
PID polling is forbidden. macOS binds audit-token `pidversion` and an
`EVFILT_PROC` watch carrying both `NOTE_EXIT` and `NOTE_EXEC`.

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

On Windows, volume serial, file ID and `WinVerifyTrust` are evaluated against
the same opened `hFile`; the leaf signing identity must match the installer-owned
Nimi signer policy. The production process uses the signed service definition's
fixed non-interactive LocalSystem host token and the restricted Nimi Runtime
service SID. DPAPI-NG uses the exact `LOCAL=user` descriptor to bind encrypted
material to the LocalSystem token user (`S-1-5-18`). State ACLs name only the
exact restricted service SID. The process DACL gives that service SID full
authority, gives interactive callers only the read-only mutual-verification
mask, and denies interactive VM read/write/operation, handle duplication and
remote thread creation. Its System-integrity mandatory label carries only
`NO_WRITE_UP`, so the read-only DACL can be verified by the unelevated Desktop
without granting any process mutation right. The primary-token object likewise
grants interactive callers only `TOKEN_QUERY | READ_CONTROL`, keeps all
duplication, impersonation, assignment and adjustment rights unavailable, and
uses the same System-integrity `NO_WRITE_UP`-only label. Queryable token
identity is verification evidence, not portable authority or credential
custody. A
DPAPI-NG `SID=` descriptor is not Windows local-service authority because its
key distribution requires an Active Directory principal and fails on
workgroup machines; `LOCAL=machine` is also forbidden because it widens
decryption to the machine.

The Windows product requirement is the fixed SCM `NimiRuntime` service under
LocalSystem with restricted `NT SERVICE\NimiRuntime` service-SID state/process
ACLs. Runtime must query the active interactive session and exact logon SID,
while an unelevated signed peer receives only the minimum read verification
rights required by the mutual process protocol. A virtual account, interactive
user process, administrator-only probe result or test service principal cannot
substitute for this product chain. Compromise of SYSTEM or an administrator is outside the current
threat boundary and does not authorize weakening protection against renderer,
third-party app or ordinary same-user processes.

On Linux, Runtime opens `/proc/<pid>/exe`, binds device/inode,
and verifies the package/repository signature identity selected by the signed
system service definition; the service uses
the dedicated non-login system UID. On macOS,
`SecCodeCopyGuestWithAttributes` targets the running process and validates its
dynamic `SecCode`, designated requirement, Team ID and cdhash, while Runtime custody keys use code-identity Keychain
ACLs. A pathname-only `SecStaticCode` claim is insufficient.

## K-PLOCAL-006 Desktop Control Session

`OpenDesktopSession` is admitted only on a mutually authenticated
`desktop_control` connection whose Desktop process or Linux static control
carrier has already passed K-PLOCAL-003..005 and whose Runtime peer is the
isolated service principal from the OS profile.
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
the service-owned OS credential store. Production generic user-session
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
