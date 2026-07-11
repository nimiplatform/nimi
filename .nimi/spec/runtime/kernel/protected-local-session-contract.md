# Protected Local Session Contract

> Owner Domain: `K-PLOCAL-*`

This contract is the sole normative owner for OS peer/process identity,
protected-local transport identity, process-bound Desktop control sessions,
lifecycle challenges, the Runtime boot epoch, and the protected security
ledger. Account, app-lifecycle, Platform trust-set, Desktop UX, Kit carrier,
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

A.0 may be submitted and independently audited before A.1, and anonymous or
public-TCP privilege must fail closed as soon as A.0 is enforced. A.0 complete
closeout, including positive Avatar and Zhiyu launch evidence, depends on the
A.1 admitted and implemented protected child channel. No temporary nonce,
metadata, portable bearer, app-owned host stamp, or compatibility path may be
used to manufacture that positive result. This dependency does not admit the
future A.1 rule range or any A.1 carrier/session behavior in A.0.

## K-PLOCAL-002 Transport Classes and Immutable Origin Roles

The closed RPC transport-class vocabulary is `public_tcp`, `desktop_control`,
`launch_bootstrap`, and `installed_host`. In A.0, `public_tcp` and
`desktop_control` have admitted rows; `launch_bootstrap` and `installed_host`
are reserved for an independent A.1 admission and have no active A.0 method
rows. Runtime-private refresh is a direct in-process helper call and is never a
transport class or an invocation of the public `RefreshAccountSession` RPC.

The admitted A.0 origin roles are `binding_only`,
`verified_desktop_process`, `desktop_account_host`, and
`desktop_lifecycle_host`. A transport role is derived
by Runtime from the verified connection and written to immutable origin
context before protocol parsing, authentication, authorization, token access,
or business request parsing. Requests and metadata cannot select, override, or
upgrade a role. Public TCP cannot construct a protected role.

Desktop control and a future installed host never share a portable session.
Any future `launch_bootstrap` to `installed_host` promotion requires its own A.1
authority and must be atomic on one already verified connection.

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

On Windows, Runtime creates the named pipe with
`FILE_FLAG_FIRST_PIPE_INSTANCE`, a service-owned connect-only DACL for the
active interactive SID/logon session, and `PIPE_REJECT_REMOTE_CLIENTS`.
Runtime obtains the client PID with
`GetNamedPipeClientProcessId`; the client obtains and verifies the Runtime PID
with `GetNamedPipeServerProcessId`. Both peers bind SID, OS logon session, PID,
creation marker, and executable trust to the handshake.

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
requirement, Team ID, cdhash and release trust row. A filesystem UDS, ad-hoc
Mach service, user LaunchAgent or app-created listener is non-product and
cannot fall back when privileged XPC verification is unavailable.

The authenticated transcript binds `protocol_version`, `transport_class`,
both canonical process tuples, `runtime_boot_epoch`, `endpoint_instance_id`,
and `transcript_nonce`. Any mismatch fails before credential or application
data is accepted.

## K-PLOCAL-004 Process Identity and Liveness

The canonical process tuple is `{os, pid, creation_marker, os_login_session,
canonical_executable_identity, executable_digest,
executable_trust_set_id}`. PID alone never authorizes.

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

Each peer performs executable verification while Platform owns only named
trust-set rows and their release/signing references. Runtime validates the
Desktop/control carrier; the Desktop/control carrier validates the Runtime
service. Signature, digest, executable role, service/launch authority, and file
identity are verified against the same opened executable file object; pathname
re-open, app self-description, environment-selected binaries, and static-file
claims are not proof.

The signed installer/service updater materializes the Platform release-record
artifact at the exact OS release root and relative layout in
`protected-local-executable-trust-sets.yaml`. Runtime selects its release root
only from the signed OS service definition; Desktop selects it only from its
own signed bundle release metadata; the Linux carrier inherits that signed
Desktop release identity. Callers cannot submit a record path or release id.
Peers canonicalize the record, verify its Ed25519 root signature, release id,
role and signer policy, then match the record against the already-open running
executable file object. Symlink/reparse/alias traversal, mutable ownership,
expired or rollback generations, incomplete release activation, and any
record/executable mismatch fail protected control closed.

On Windows, SHA-256, volume serial, file ID, and `WinVerifyTrust` are evaluated
against the same opened `hFile`, and the exact admitted signer and digest must
match. The production process runs under the restricted Nimi Runtime service
SID; DPAPI-NG protectors, state ACLs and the process DACL name that exact SID
and deny interactive VM read/write/operation, handle duplication and remote
thread creation. On Linux, Runtime opens `/proc/<pid>/exe`, binds device/inode,
hashes that FD, and matches the Platform-signed release digest; the service uses
the dedicated non-login system UID. On macOS,
`SecCodeCopyGuestWithAttributes` targets the running process and validates its
dynamic `SecCode`, designated requirement, Team ID, cdhash/SHA-256, and exact
trust-set entry, while Runtime custody/anchor keys use code-identity Keychain
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

## K-PLOCAL-007 Lifecycle Challenge, Ledger, Boot Epoch, and Recovery

Each lifecycle challenge is opaque, single-use, and bound to Desktop session,
Desktop process-tuple hash, account generation, action, app id, release ref,
artifact digest, displayed-intent hash, Runtime boot epoch, issue time, and
deadline. A caller-provided `confirmed=true` is not authorization. Challenge
consumption and durable lifecycle intent creation commit in the same anchored
transaction, and the external side effect begins only after that transaction
advances the anti-rollback anchor. A non-authorizing job id/status reconciles a
lost response. A replacement challenge atomically cancels the old one, and at
most one challenge is outstanding per session/action/app tuple.

`PrepareAppLifecycleIntent` and `GetAppLifecycleIntentStatus` are the only
generic issuance/reconciliation methods; their exact typed shapes, action/state
vocabularies, canonical impact digest, renderer allowlist, and consuming request
fields are owned by
`tables/protected-local-lifecycle-intent-protocol.yaml`. An `intent_id` or job
id is non-authorizing. Existing lifecycle mutations require the same live
Desktop connection plus `lifecycle_intent_id` and `displayed_impact_digest`;
caller `confirmed=true` never authorizes. No intent proof, process tuple, boot
epoch, account-generation material, or ledger anchor enters renderer IPC.

Runtime stores this state in a dedicated protected-local security ledger named
`protected_local.db`, never in `memory.db`, Desktop/app storage, a general
application database, or the interactive user's profile. Account custody,
ledger, anchor, and their keys are owned by the isolated Runtime service
principal and are unreadable, unwritable, and non-enumerable by the interactive
user and app principals. Production `go-keyring`/generic user-session
credentials for account or connector/provider material are forbidden; because
the product is pre-release, the hardcut does not import them and requires fresh
login plus connector credential re-entry. The ledger uses a
service-principal-only ACL, WAL,
`synchronous=FULL`, foreign keys, `BEGIN IMMEDIATE`, a fixed schema version, and
HMAC records using SHA-256 and a secure-storage key. Raw credentials are forbidden.
Its A.0 logical records are `protected_runtime_epoch`,
`protected_desktop_session`, `protected_lifecycle_challenge`,
`protected_lifecycle_intent`, `protected_security_commit`, and
`protected_security_audit_outbox`. Launch tickets, installed child sessions,
and carrier records are absent until A.1 authority is independently admitted.

The service-principal secure store contains the anti-rollback anchor `{ledger_uuid,
commit_sequence, commit_chain_head}` outside SQLite. A commit first fsyncs a
pending DB head, then advances the secure store anchor, then marks the DB head
complete. Exact committed equality is accepted; an anchor at the one pending
next head completes recovery; an unadvanced pending head is discarded before
side effects. Every other UUID/counter/head mismatch reports rollback and
fails protected features closed. There is no automatic backup restore after
corruption or rollback detection. Explicit operator reset revokes all
protected state and requires fresh login and launch.

Every Runtime start creates a 32-byte CSPRNG boot epoch. Before any listener is
opened, an anchored transaction revokes all nonterminal state from older boot
epochs and writes a sanitized startup audit. Integer generations may order
records but never replace the random boot epoch identity.

Typed failures use the `PROTECTED_LOCAL_*`, `DESKTOP_*`, and
`LIFECYCLE_CHALLENGE_*` rows in `tables/reason-codes.yaml` and
`tables/error-mapping-matrix.yaml`. Error detail contains only the stable
reason, retryability, and a non-secret action hint; it never includes endpoint
material, executable path, process tuple, challenge, ledger anchor, account
material, or credential values.
