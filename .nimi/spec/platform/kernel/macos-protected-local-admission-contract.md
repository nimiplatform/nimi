# macOS Protected-local Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

定义 `P-NAPP-037` 的单一 macOS protected-local independent-admission authority。
通用 Nimi App catalog、permission 与 local-record 语义继续由
`nimi-app-admission-contract.md` 和 `nimi-app-local-admission-contract.md` 拥有；
本 companion 只拥有 macOS 正向链的 conjunctive native admission，不得成为
Mac-only product truth 或 portable fallback。

## P-NAPP-037 — macOS Protected-local Independent Admission

macOS is one conjunctive platform admission, not a compile target and not a
portable fallback. Its aggregate posture remains
`requirements_only_fail_closed_pending_native_admission` until every owner row
below has positive release and live-machine evidence from the same signed
candidate. A passing unit test, an ad-hoc signature, a same-user daemon, an
ordinary localhost listener, or a manually started foreground Runtime cannot
advance this posture.

The selected production component graph is fixed:

```text
signed/notarized Nimi.app
  -> SMAppService registration and explicit administrator approval
  -> launchd system-domain ai.nimi.runtime LaunchDaemon
     -> dedicated non-login _nimiruntime principal
     -> Runtime-only System Keychain custody
     -> launchd socket-activated filesystem UDS listeners
        -> verified Desktop main native carrier
           -> Kit host-only protected carrier -> typed SDK consumers
           -> Desktop local-development supervisor
              -> independently signed Nimi Local App Host.app
                 -> Zhiyu/local-app main + sandboxed renderer
  -> Runtime authenticated Realm broker -> Realm API
```

### Non-product local-development admission

The only tracked macOS local-development profile is the non-product fresh
carrier-4 candidate. Its posture is
`local_development_candidate_fail_closed_pending_real_acceptance` until the
complete real Runtime -> Desktop -> supervised Electron host acceptance closes.
It cannot satisfy or weaken production, Tauri, Developer ID, SMAppService,
notarization, or Gatekeeper admission. Apple Developer ID is not required for
this profile; Team ID is exactly absent; notarization and Gatekeeper acceptance
are absent and must not be claimed.

The fresh graph is fixed:

```text
developer-authorized user-domain signing Keychain
  -> one machine-local non-product CA and stable P-256 role leaves
  -> unprivileged build, hardened-runtime signing, and release-record generation
  -> explicit administrator install transaction
     -> small root-owned verify/install helper without signing private keys
     -> root-owned versioned candidate and atomic activation
     -> dedicated _nimiruntimedev launchd system principal
     -> Runtime-only System Keychain operational custody
     -> launchd socket-activated protected UDS
        -> signed Nimi Dev.app -> verified Desktop supervisor
           -> signed Nimi Local App Host Dev.app -> Zhiyu/local app
```

Signing authority, per-build executable identity, and Runtime custody are three
separate authorities. Signing private keys exist only in the dedicated
user-domain development signing Keychain and are used only before elevation.
The installer, Runtime, Desktop, renderer, and local app cannot read them. Stable
role leaves and designated requirements may sign later builds without rotating
the CA. Every build is separately pinned by SHA-256, CDHash, release record,
architecture, entitlements, generation, and expiry. Runtime operational secrets
remain in System Keychain and bind the stable Runtime designated requirement,
identifier, admitted leaf, and dedicated principal; installed release records
and Runtime self-verification separately bind exact bytes.

The privileged helper is a small verify/install boundary. It never creates a CA,
issues certificates, signs code, owns signing keys, or rotates itself. It copies
a preverified workspace candidate into root-owned staging and repeats exact
release-record, signature, designated-requirement, leaf-SPKI, Team-ID-absence,
hardened-runtime, architecture, entitlement, SHA-256, CDHash, same-vnode, and
fixed-path validation before atomic activation. Its source list is closed and
must not discover or compile the entire dev-security directory.

Fresh install is admitted as a candidate path only when the service, principal,
plist, payload, sockets, Runtime custody, and install journal are all absent. A
single top-level fresh-install journal may represent the irreversible install
transaction. Unknown or partial state keeps listeners closed and requires an
explicit confirmed exact reset; fail-close does not imply automatic recovery.
Update remains `dev-runtime-update-not-admitted`.

Carrier 2, carrier 3, and unknown profiles are
`legacy-local-dev-profile-not-supported` in all normal carrier-4 commands and
must fail before candidate signing, elevation, Keychain, OpenDirectory, launchd,
or filesystem mutation. There is no tracked source-to-target migration, helper
self-rotation, coordinator, root-overlap protocol, terminal migration proof, or
multi-WAL recovery. Exact workstation legacy deletion, if required, belongs only
to one untracked, delete-only, identity-bound runner under `.nimi/local/**`; it
is not product authority or a reusable command.

The profile preserves the production-strength UDS, audit-token, real/effective
UID, audit-session, pidversion/start identity, static and dynamic SecCode, exact
identifier/DR/leaf/hash, hardened runtime, vnode/liveness, mutual Runtime/Desktop
verification, boot epoch, session generation, restart/account-change/revoke, and
verified Desktop supervisor chain. There is no public TCP endpoint, app-held
Runtime token, renderer secret, app-level REST/gRPC bypass, or Mac-only SDK or
permission truth.

### Development principal, service, transport, and host admission

Carrier-4 normal commands never repair or migrate legacy carriers. Any legacy or unknown profile or residue fails as `legacy-local-dev-profile-not-supported` before mutation. The tracked helper has no legacy parser or delete path. Explicit reset owns only the current Nimi Dev namespace.

The development service principal is created only through the public
OpenDirectory framework. The installer selects one collision-free equal UID/GID
in the macOS role-account range `450..499`, generates distinct canonical user
and group UUIDs, and includes that exact principal witness in the single
root-owned mode-`0600` fresh-install journal before the first Directory Services
mutation. `ODNode.createRecord` creates the group and then the user from complete
initial attribute dictionaries. GeneratedUID is a birth attribute and is never
modified after record creation; the user is born with password `*`, hidden
state, `/var/empty` home and `/usr/bin/false` shell. It is born without
`AuthenticationAuthority`, ShadowHashData, PasswordPlus,
AltSecurityIdentities, AuthCredential, AuthMethod, AuthenticationHint,
KDCAuthKey, KerberosServices, KerberosRealm, KerberosKeys, HeimdalSRPKey,
SecureTokenVerifierHistory, AutoGrantSecureToken or LinkedIdentity. Any native
`_writers*` delegation is also forbidden. Negative attributes are inspected as
raw OpenDirectory values; a binary or malformed value is present and rejected,
never coerced into an empty string list. The dedicated group has no explicit
GroupMembership, GroupMembers or NestedGroups values, and a complete local
group projection must prove that neither the service name, user GeneratedUID
nor dedicated-group GeneratedUID is explicitly attached to any other group.
Computed OS baseline group projection is evidence only and is not hard-coded as
machine-independent authority. The installer synchronizes the records and then
proves the exact raw OpenDirectory and POSIX projections, including absence of
every forbidden authentication, writer and explicit-membership attribute.
Non-root status cannot promote unreadable protected
attributes to `runtimeAccountTrusted`; it reports privileged verification
required instead. Apple
documents that a failed initial attribute write deletes that record; the Nimi
transaction nevertheless retains its own cross-record journal because group and
user creation are two separate records.

Recovery and rollback delete user before group and only when name, UID/GID and
both GeneratedUID values exactly match the fsynced transaction witness. They
must then prove both records absent. Query failure, ambiguity, a mismatching
record or deletion without absence proof preserves the journal and reports
`runtime-service-repair-required`; it is never collapsed into record absence.
Rollback derives effect-ahead state from actual postconditions rather than
in-memory completion flags, stops at the first failed observed-effect cleanup,
and retains the ledger or journal witness plus the fixed recovery helper. The
ledger, journal, RuntimeDev boundary and recovery helper are removed, fsynced
and proved absent only after launchd, sockets, custody, payloads, staging and the
full raw OpenDirectory/POSIX principal witness are all absent; the recovery
helper is removed last.
An already present exact admitted principal is durable installation
infrastructure and is never owned or removed by a failed candidate update.
`dscl`, `sysadminctl`, `dsimport` and direct dslocal database writes are forbidden
mutation fallbacks; `dscl` may appear only in non-authorizing human diagnostics.
Every privileged install, restart, reset and uninstall transaction holds one
non-blocking exclusive `flock` on the same exact open root-owned RuntimeDev
boundary directory for the full transaction. The directory is the shared
installation boundary already required by the real external effects; no
pathname-only lock file or removable inode creates a second serialization
truth. User-domain signing and unprovisioning never acquire this privileged lock
or gain installer authority; their fail-closed Keychain operations are a
separate authority boundary.

The development profile retains every native process and transport invariant
of production: `LOCAL_PEERTOKEN`, `LOCAL_PEERPID`, audit session, euid/ruid,
pidversion/start identity, dynamic `SecCode`, exact designated requirement,
identifier, leaf SPKI, CDHash, hardened runtime, canonical vnode/digest,
process/vnode liveness, active-console binding, boot epoch and Desktop session
generation. It omits only the production-exclusive Developer ID Team ID,
notarization/Gatekeeper and SMAppService assertions. Direct `launchctl`
bootstrap is admitted solely for this explicitly non-product, root-owned
LaunchDaemon profile; it is not a production lifecycle fallback.

Electron is positive only when the same signed development candidate passes
real DOM/CDP/console/network/accessibility, Runtime restart, revoke and
Desktop-quit/no-orphan evidence. CDP exists only in an explicitly signed
acceptance variant, is loopback-only and uses an isolated non-authorizing user
data root. Tauri remains independently fail-closed. App-owned SQLite and exact
app-native commands remain `app_owned_authority`, require no Nimi permission,
and must still remain inside the opaque supervisor partition.

`SMAppService.daemon(plistName:)` is the registration/control surface and
launchd is the lifecycle owner. The containing notarized application lives at
the installer-fixed `/Applications/Nimi.app` path; the daemon plist lives at
`Contents/Library/LaunchDaemons/ai.nimi.runtime.plist` and uses a fixed
`BundleProgram`. A signed installer provisions the dedicated non-login
principal, the root-owned non-writable
`/Library/Application Support/Nimi/Runtime` installation/custody boundary, and
its `_nimiruntime`-owned mode-`0700` `state` child. Before service registration,
the installer invokes only the installer-fixed Runtime executable at its sealed
bundle path in a no-input custody-provision mode. That process must run as real
root and pass the same Platform role record, outer-bundle seal, dynamic
`SecCode`, CDHash, designated-requirement and same-open-vnode digest checks as
the service executable. This is an installer transaction, not a Desktop,
renderer, app-tools or public Runtime operation.

The custody transaction and production daemon acquire the same
`_nimiruntime`-owned mode-`0600` regular `state/runtime.lock` vnode with a
non-blocking exclusive advisory lock and retain it for their full state-access
lifetime. Fresh initialization is permitted only when that lock, the ledger,
its auxiliary files and both System Keychain items are all absent and the state
directory has no unrelated entry. Existing validation is permitted only when
the lock, ledger, record-MAC key and anchor are all present with exact owner,
mode, link-count, ACL and cryptographic integrity. Every mixed/partial state,
busy lock or replacement vnode fails closed and requires an explicit repair;
neither installer nor Runtime silently resets it. Fresh initialization creates
one 32-byte CSPRNG record-MAC key, the matching genesis ledger/Keychain anchor,
fsyncs the ledger and directory, and emits only a non-secret disposition. A
failed fresh transaction removes only artifacts proven to have been created by
that transaction; incomplete rollback remains a repair-required partial state.
Before returning success, the provision transaction admits the exact installed
Runtime role record into the Keychain-anchored release-generation high-water
ledger. A downgrade or generation rebind therefore fails before service
registration rather than after activation.
The signed installer either validates an existing exact `_nimiruntime`
Directory Services user/group or creates a collision-free equal UID/GID in the
local system-id range `200..499`. The account is hidden, has `/var/empty` as
home, `/usr/bin/false` as shell, disabled password authentication and no
supplementary groups (`InitGroups=false`). Any name/id/group, login capability,
home or shell mismatch is a repair-required partial installation; neither the
installer nor Runtime repurposes an existing identity.
LaunchAgent, Login Item, user-session daemon, Desktop child process, and
`go run ... serve` are not equivalent service profiles. Desktop quit leaves
the production Runtime running.

The physical transport is a filesystem Unix domain socket. Runtime accepts a
connection only after reading `LOCAL_PEERTOKEN` and `LOCAL_PEERPID` from the
connected socket, correlating euid/ruid/audit user/audit session/PID, and
resolving that audit token to the same running dynamic `SecCode`. Runtime then
validates the exact designated requirement, Team ID, bundle/signing
identifier, cdhash, hardened-runtime flag, canonical executable vnode and
release role against the Platform-release-root-signed role trust record. It
retains `EVFILT_PROC NOTE_EXIT|NOTE_EXEC` plus
`EVFILT_VNODE NOTE_DELETE|NOTE_RENAME|NOTE_WRITE|NOTE_REVOKE` witnesses.
Runtime verifies the active interactive login at admission and revokes the
connection on active-user/session change. The peer performs the reverse check:
socket server audit token/PID, stable launchd system job PID, Runtime dynamic
`SecCode`, exact Runtime designated requirement/Team ID/cdhash from the signed
Runtime role record, installed vnode identity, process liveness, and
boot-epoch/session rotation. Neither direction sends protocol or credential
bytes before these checks complete.

macOS role CDHashes are not compiled into mutually verifying executables and a
Desktop record containing the final Desktop CDHash is not stored inside the
same `Nimi.app` resource seal. Either construction is self-referential: the
final outer signing operation changes the Desktop CodeDirectory/CDHash and an
embedded record changes the outer resource seal. The guarded release pipeline
instead signs, notarizes and staples the exact final `Nimi.app`, then computes
the same-open-vnode SHA-256, final CDHash and designated requirement for every
role. It emits one canonical Platform-release-root-signed record per role under
the installer-owned, root-owned, group/world-non-writable fixed directory
`/Library/Application Support/Nimi/Runtime/trust/protected-local/v1` and builds
the exact app plus records into one Developer-ID-Installer-signed, notarized and
stapled package. Record files are root-owned mode `0644` regular single-link
files beneath mode `0755` root-owned ancestors; the `_nimiruntime` state
directory is a sibling and cannot replace them. macOS Installer serializes the
package payload transaction while `preinstall` keeps the Runtime launchd job
booted out. `postinstall` then acquires the custody lock before it reads or
changes Keychain, ledger, release-lineage or protected-state truth, validates
the exact installed app/record set, and never activates the service. No lock is
claimed to span two installer scripts. After an update, an explicit Desktop
start observes the still-enabled SMAppService registration with an absent
launchd-owned endpoint, waits for asynchronous unregister completion, and only
then re-registers the exact new embedded daemon as required by ServiceManagement.
An approval-required status remains user-owned and is never bypassed. A crash-
mixed app/record set cannot activate and fails digest/CDHash verification as
installer-repair-required on the next transaction.

Runtime and Desktop embed only the stable Platform release-root public key and
key id. The record signature is its content authority; the signed/notarized
installer and fixed root-owned path are installation authority; strict outer-
bundle validation independently proves the running application seal. A record
selected by a peer, environment, argv, renderer, app manifest, application
resources or user-writable path is forbidden. Missing, non-canonical, expired,
incompatible, rollback, wrong-role, digest-mismatched, CDHash-mismatched,
root-path-ownership-mismatched or outer-bundle-unsealed state fails closed
before protocol bytes.
The guarded builder never accepts the Platform release-root private key in
argv, environment, a repository file or an artifact. It sends only canonical
record payload bytes and the public key id over stdin to the fixed root-owned,
non-writable, same-Team-signed
`/usr/local/libexec/nimi-release-record-signer`; that release-service boundary
owns HSM/Keychain custody and returns only an Ed25519 signature. The builder
verifies every returned signature against the embedded public key before
packaging. Missing or replaced signer service fails the release.
Runtime's Keychain-anchored protected ledger stores an append-only per-role
release-generation high-water mark. It advances only after that exact running
Runtime, Desktop or supervised host has passed dynamic-code and same-open-vnode
verification. Reusing a generation for different release bytes or presenting a
lower generation is a rollback failure across Runtime restarts and reinstall;
an app-owned file, Desktop cache or installer receipt cannot reset it.

The two fixed sockets are Desktop control and local-app bootstrap/host at
`/private/var/run/nimi/runtime-desktop.sock` and
`/private/var/run/nimi/runtime-local-app.sock`. The canonical `/private` path is
mandatory; the `/var` system symlink spelling is not an authority-bearing path.
launchd creates and retains both listening descriptors from the signed
LaunchDaemon `Sockets` dictionary before Runtime starts, and Runtime adopts
exactly one descriptor per declared activation name with
`launch_activate_socket`. Their root-owned non-writable parent directory and
socket `root:staff` mode-`0660` vnode attributes come only from launchd's signed
daemon profile. The owner is fixed root rather than the installer-assigned
numeric UID of `_nimiruntime`, because `SockPathOwner` is a numeric signed-plist
field and the dedicated service UID is not a stable cross-machine release
constant. The daemon receives launchd's already-open descriptors after dropping
to `_nimiruntime`; it never owns or replaces the path. Symlinked ancestors,
pre-existing non-socket nodes, app-created listeners, a different owner, an
unexpected descriptor count/type/address, or a replacement vnode fail closed. Filesystem eligibility
is defense in depth. Exact active-user, login-session, role and code identity
remain mandatory even when another local process can reach the socket pathname.

Local-development process admission is two-stage. The verified Desktop carrier
uses `posix_spawn` with `POSIX_SPAWN_START_SUSPENDED` for the exact Runtime-
approved host executable and retains the child witness. Runtime binds the
suspended PID, start identity, canonical executable vnode, dynamic code
identity, project/capability/shell policy and process liveness. After resume,
the child must connect through the local-app socket; Runtime obtains its full
audit token and pidversion from that connection, repeats dynamic-code and vnode
validation, and atomically correlates it with the pre-bind witness before
promoting the same connection. PID reuse, `exec`, host/path replacement,
copied projects, changed manifests or a host outside the live Desktop
supervisor cannot promote.

Electron and Tauri close independently. Electron requires a separately signed
and notarized `Nimi Local App Host.app` with its own bundle identifier and
designated requirement; the generic npm Electron binary, ad-hoc Electron,
Desktop's own executable, renderer helpers and ordinary Node processes are
forbidden hosts. Chromium `sandbox: true`, `contextIsolation: true` and
`nodeIntegration: false` remain mandatory. CDP is absent by default and may be
enabled only by an explicit acceptance build profile with loopback binding and
isolated user data. Every production local-development Electron host also uses
a Desktop-created mode-`0700` Chromium user-data directory beneath the active
user's fixed Nimi local-app profile root. Its opaque leaf is a one-way digest
domain-separated from the Runtime authorization id: the raw authorization,
account id, project root, app id, Runtime epoch and session material never enter
the path or argv. The same live authorization reuses the partition across
controlled host replacement; another authorization (including reapproval after
revoke, account change or copied/changed project) resolves to another partition.
The partition is browser/app-owned data and is neither a Nimi grant nor a trust
root. Desktop rejects symlinked, wrong-owner, non-directory or group/world-
accessible partition ancestors before launch. An explicit acceptance profile
may select its own isolated temporary user-data root, but cannot make that root
production authority. Tauri requires its own signed Rust carrier, WKWebView origin
proof, command-registration audit, updater/install proof and live acceptance.
An Electron close cannot make Tauri positive.

The macOS protected Node-API carrier is sealed inside each exact signed host at
`Contents/Resources/nimi-native/protected-local`. Electron main code resolves
that one canonical resource directly; project/workspace `node_modules`,
`NODE_PATH`, environment, argv and app manifests cannot supply or replace it.
Its `.node` image must have the same Developer ID Team and satisfy hardened
runtime library validation. This fixed carrier remains the only authority path
when the signed local host imports the Runtime-approved external project main.
The Electron release normalizes its inherited `Info.plist` before signing:
arbitrary ATS loads are disabled, only local-network transport needed by the
supervised development origin is declared, and Camera/Microphone/Bluetooth/
audio-capture usage strings are absent while those `os_right` surfaces remain
unadmitted. A usage string or entitlement never substitutes for Nimi permission
or Runtime operation admission.

Runtime System Keychain custody is Runtime-only. Desktop, local apps,
renderers, login Keychain items and shared application storage cannot read the
secret. The daemon validates the System Keychain item ACL against its exact
designated requirement on every open; missing, locked, restored with a
different ACL, or inaccessible custody fails before listeners. Secure Enclave
is not required for the symmetric ledger MAC/anchor material because it is
non-exportable only at the Keychain policy boundary and no asymmetric user
presence operation is admitted. Runtime reinstall preserves custody only when
the same admitted designated requirement and installer release lineage remain;
reset/rotation is an explicit repair transaction. Logout/account switch
revokes account/session state but does not redefine durable machine custody.

The aggregate macOS gate is the conjunction of:

1. Runtime principal, protected state, Keychain custody and real launchd
   restart/crash/sleep-wake/multi-user evidence;
2. UDS owner/mode/vnode and mutual audit-token/dynamic-code verification,
   including ordinary/other-user/unsigned/copied/modified/wrong-Team/wrong-
   requirement/process-replacement denial;
3. production Developer ID signatures, hardened runtime, exact entitlements,
   notarization ticket, Gatekeeper assessment and native arm64 or admitted
   universal architecture for Runtime, Desktop and each claimed host;
4. account binding, boot epoch, process liveness, restart/reconnect/revoke and
   Desktop-quit no-orphan evidence;
5. real Electron DOM/CDP/console/network/accessibility and desktop/390px
   acceptance for Desktop plus Zhiyu;
6. a separate Tauri gate before any Tauri-positive claim; and
7. all Runtime/SDK/Kit/Desktop/app-tools/Zhiyu/spec/generation/boundary gates.

Until the conjunction is green, the product projection is one of the exact
negative states `runtime-service-unavailable`, `runtime-service-untrusted`,
`runtime-service-repair-required`, `runtime-restarted`, `process-replaced`,
`account-changed`, or `session-revoked`; it must not collapse trust or repair
failures into generic availability.

This platform admission does not change `P-PERM-*`. App-owned SQLite, schema,
migrations, private JSON/media/cache/index/settings/routes and exact app-native
commands remain `app_owned_authority` and require no Nimi permission or
operation admission. Runtime-mediated app-private JSON/opaque partition access
remains a `base_entitlement`; the sixteen public permission ids remain reserved
until their own owner-complete admissions; Camera, Microphone, Files,
Accessibility, Screen Recording and Notifications remain independent macOS
`os_right` decisions.
