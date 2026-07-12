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
distinct from the interactive Desktop user and every bundled, installed,
developer, renderer, and app-owned host principal. A same-interactive-user
Runtime process, user-session generic keyring, user-writable service definition,
or environment/argv-selected production endpoint cannot claim product
readiness. Missing service-principal isolation fails closed before custody load
or any listener. Non-product same-user fixtures are synthetic-only and cannot
load production trust, accounts, credentials, or Realm endpoints.

The signed installer and service updater own Runtime release staging,
installation, and atomic replacement. Desktop may read verified service status
and request start/restart only through the typed OS service-control gateway; it
never selects or spawns the Runtime executable, directly stops the service, or
ties service lifetime to Desktop lifetime. Production Desktop quit leaves the
Runtime service running. Administrative uninstall and updater-controlled drain
remain service-manager operations outside Desktop process ownership.

`RuntimeAuthService.RegisterApp` and `RuntimeAuthService.OpenSession` remain
`BINDING_ONLY` bootstrap surfaces. They may establish only a non-privileged app
binding and MUST NOT derive account-control, Realm broker, AI, artifact,
realtime, media, lifecycle, or `OpenApp` authority. A portable value cannot and
MUST NOT establish Desktop, bundled-app, installed-app, or developer-installed
privilege on the same or another connection.

A.0 is admitted and closed per OS platform. Windows, macOS, and Linux share
the same security semantics but do not block one another's first positive
production chain. An unadmitted platform remains explicitly fail-closed and
cannot use localhost gRPC, a same-user daemon, or a compile-only carrier as a
product fallback. Global Wave A closeout declares the supported platform set
and carries real evidence for every platform claimed supported.

A.0 and A.1 are independently auditable. A.1 admits the Windows child channel
defined below; macOS and Linux remain fail-closed until independently admitted.
No temporary nonce, metadata, portable bearer, app-owned host stamp, localhost
fallback, or compatibility path may manufacture installed-host authority.

## K-PLOCAL-002 Transport Classes and Immutable Origin Roles

The closed RPC transport-class vocabulary is `public_tcp`, `desktop_control`,
`launch_bootstrap`, and `installed_host`. A.1 admits `launch_bootstrap` and the
production-installed use of `installed_host` on Windows. A.5 admits the
local-development use of that same native `installed_host` carrier on Windows;
shared physical carrier does not create shared trust, session, or operation
authority. Runtime-private refresh is a direct
in-process helper call and is never a transport class or an invocation of a
public refresh RPC.

The admitted A.0 origin roles are `binding_only`,
`verified_desktop_process`, `desktop_account_host`, and
`desktop_lifecycle_host`. The app-host roles are
`verified_installed_process`, `installed_host_session`,
`verified_local_development_process`, and
`local_development_host_session`. Production-installed and local-development
roles are mutually exclusive on a connection and cannot be converted into one
another. A transport role is derived
by Runtime from the verified connection and written to immutable origin
context before protocol parsing, authentication, authorization, token access,
or business request parsing. Requests and metadata cannot select, override, or
upgrade a role. Public TCP cannot construct a protected role.

Desktop control and an installed host never share a portable session.
`launch_bootstrap` to `installed_host` promotion is atomic on the same verified
child connection and the same service-owned transaction that consumes the
launch ticket.

## K-PLOCAL-008 Windows Installed Launch Bootstrap

`OpenApp` may create one service-owned launch record only after protected
Desktop lifecycle admission resolves the exact installed app, active release
digest, account generation and current Runtime boot epoch. The renderer-safe
projection carries only a non-authorizing 32-byte launch correlation id.

The protected host carrier starts the exact installed executable suspended,
then sends the launch correlation and child PID only over the verified Desktop
control connection. Runtime independently opens and verifies that process,
derives its creation marker, login session, locked executable identity, active
release digest and platform code-signing policy, and records the process
binding before Desktop resumes it. The child then opens the fixed service-owned
installed-app named pipe itself. Runtime requires `GetNamedPipeClientProcessId`
on that new connection to match the pre-bound PID and rechecks the retained
process witness. PID and launch correlation are selectors, never sufficient
authority. argv, env, inherited pipe handles, files, stdout, preload and
renderer IPC cannot carry or reconstruct launch authority.

`OpenDesktopLaunchedAppSession` has an empty request and exists only on that
verified `launch_bootstrap` connection. Success atomically consumes the launch
record and creates the installed session bound to app, release, PID/creation
marker, account generation and Runtime boot epoch. The ticket TTL is 30 seconds
and process-bind deadline is 10 seconds. Duplicate, expired, revoked, wrong
process/release/account/epoch and ordinary-gRPC calls fail closed. Logout,
switch-account, uninstall, release revoke, session revoke, process exit and
Runtime restart revoke the applicable launch/session rows transactionally.
Install, update, repair and uninstall commit app-scoped launch/session
revocation before any release materialization, active-pointer swap or release
removal. A revocation-ledger failure terminates the lifecycle job as failed and
cannot mutate files. Catalog release revocation may use the narrower
app-and-release-digest transaction; it cannot affect another app or release.

After consumption, the verified connection retains only a Runtime-private
opaque session selector/proof. The durable installed-session row remains the
single revocation, expiry, app, release, process, account-generation and boot-
epoch truth. Every separately admitted installed operation revalidates that
row, the live native process and the current Runtime account generation through
the Account-owned in-process evaluator. The opaque handle, request metadata and
a launch-time snapshot are never sufficient authorization.

Windows is admitted independently. macOS/Linux implementations remain
`protected-carrier-required` and cannot claim A.1 completion until their native
handle-transfer, peer verification and signed-release evidence are admitted.

## K-PLOCAL-009 Local-Development Authorization And Session

Local development has two different lifetimes. Runtime owns the durable user
development authorization in protected service state. It binds the canonical
project root, app id, manifest capability fingerprint, current account id, and
the exact `local-development-installed-admission` trust class. `run_once`
persists only while its Desktop-owned supervisor run remains live, including a
Runtime restart during that run. `remember_project` persists until explicit
revoke or a reapproval trigger. Neither record is an installed release,
signature, listing, production grant, or app-owned configuration truth.

Runtime separately owns every short-lived technical session. A session binds
the development authorization, verified Desktop supervisor process, actual
host PID and creation marker, current host executable identity, shell kind,
controlled renderer origin/output roots, account generation, and Runtime boot
epoch. The Desktop supervisor opens a development launch, starts the exact
Electron or Tauri host, and binds its retained process witness over the live
`desktop_lifecycle_host` connection. Runtime then requires the native
`installed_host` carrier peer PID to equal that bound host and derives only the
`verified_local_development_process` role before atomically creating
`local_development_host_session` state. The same carrier's production roles,
session handle, release trust, and operation authorization remain mutually
exclusive and non-convertible. PID, path, parent PID, argv, env, project
manifest, localhost, and a caller-supplied digest are never sufficient
authority.

Session proof and launch material remain Runtime/native-host private. They are
never returned through renderer IPC, CLI output, terminal environment, argv,
files, preload APIs, or app code. Kit may expose only typed status and admitted
business operations. Runtime revalidates authorization, capability
fingerprint, process liveness, supervisor liveness, account generation, boot
epoch, shell, controlled outputs, and operation policy on every call.

Renderer HMR/reload, a controlled Electron main/preload rebuild and host
restart, a controlled Tauri Rust rebuild and host restart, technical-session
rotation, and Runtime restart automatically rebuild the technical session
without another confirmation while the user authorization and supervisor run
remain valid. Host or supervisor exit, revoke, logout, account switch,
authorization mismatch, app/root/capability/shell change, uncontrolled output
or remote dev-server origin revokes the applicable launch/session before the
next operation. Account change requires a new confirmation.

The authorization, session, supervisor, reapproval, operation-ceiling, and
non-conversion semantics in this rule are platform-neutral. Windows is the
only authority-admitted A.5 platform and remains pending complete live product
evidence. macOS/Linux remain fail-closed pending independent native carrier
admission through their OS profiles. Ordinary installed sessions and
production release validation remain unchanged; development state cannot be
reinterpreted as an A.1 production release or installed listing.

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
bind SID, OS logon session, PID, creation marker, and
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
without granting any process mutation right. A
DPAPI-NG `SID=` descriptor is not Windows local-service authority because its
key distribution requires an Active Directory principal and fails on
workgroup machines; `LOCAL=machine` is also forbidden because it widens
decryption to the machine.

The LocalSystem host is an evidence-selected Windows requirement, not an
installer convenience. The restricted virtual-account fixture successfully
established its SCM principal, restricted token and process isolation, but
failed closed with `ERROR_ACCESS_DENIED` when querying `WTSSessionInfo` for the
other interactive user's active session. Windows also limits exact
`LsaGetLogonSessionData` for that user's AuthenticationId to the session owner
or a local system administrator. Granting the virtual account cross-session
query or administrator authority to bypass those boundaries is forbidden;
the selected LocalSystem host supplies those read authorities while the
restricted service SID remains the state and sensitive-process authorization
principal. This fixture comparison admits only the Windows principal choice;
the elevated installer probe does not complete mutual-peer acceptance because
its administrator token bypasses the Runtime process DACL. Until the separately
unelevated signed probe can open the Runtime with the exact read-only mask, the
LocalSystem fixture and A.5 remain blocked.
it does not complete A.5 product implementation or closeout. Compromise of
SYSTEM or an administrator is outside the current
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

Every lifecycle mutation requires the same live protected Desktop connection,
the current account generation, the current Runtime boot epoch, and an exact
target tuple. A caller-provided `confirmed=true`, renderer-held identifier, or
job id never authorizes. Runtime executes mutation admission, idempotency-key
consume, session/generation checks, and durable operation creation in one
ordinary service-owned database transaction before beginning an external side
effect. The non-authorizing operation id/status reconciles a lost response.

`PrepareAppLifecycleIntent` remains a transitional Desktop UX projection while
existing consumers migrate. It may return canonical impact text/digest, but
the returned intent is not security authority and consumption does not require
an HMAC chain or anti-rollback anchor. Non-destructive `OpenApp` does not need a
prepare challenge. Destructive uninstall/data deletion may require an explicit
Desktop UX confirmation policy, but security authorization still comes only
from the live protected connection and current target/generation checks. Exact
operation fields and transitional surfaces are owned by
`tables/protected-local-lifecycle-intent-protocol.yaml`.

Runtime stores Desktop sessions, lifecycle operations, A.1 launch-ticket
consumption, child sessions, generations and revocation state in one
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
install/open/repair/adopt operations, audit outbox rows and crash-recovery
bookkeeping do not each advance a separate HMAC chain.

Every Runtime start creates a 32-byte CSPRNG boot epoch. Before any listener is
opened, one database transaction revokes nonterminal sessions, launch tickets
and operations from older boot epochs and writes a sanitized startup audit.
Integer generations may order records but never replace the random boot epoch
identity.

Typed failures use the `PROTECTED_LOCAL_*`, `DESKTOP_*`, and
`LIFECYCLE_CHALLENGE_*` rows in `tables/reason-codes.yaml` and
`tables/error-mapping-matrix.yaml`. Error detail contains only the stable
reason, retryability, and a non-secret action hint; it never includes endpoint
material, executable path, process tuple, operation id, durable anchor, account
material, or credential values.
