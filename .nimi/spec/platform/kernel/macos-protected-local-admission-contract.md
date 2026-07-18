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
