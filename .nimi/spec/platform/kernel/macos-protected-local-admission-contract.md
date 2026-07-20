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

`P-NAPP-037` also owns one independently named
`local_development_non_product_admitted` profile. This profile exists only so a
real macOS machine without an Apple Developer ID can exercise the complete
Runtime -> Desktop -> supervised Electron host chain. Its evidence is
non-promotable: it cannot satisfy, weaken, or substitute for any production
Developer ID, Team ID, SMAppService, notarization, Gatekeeper, installer, or
Tauri row in the aggregate production gate above or below.

The non-product graph is fixed and isolated from production:

```text
machine-local non-product CA and root-owned Keychain signing custody
  -> explicit administrator-owned install/update transaction
  -> launchd system-domain ai.nimi.runtime.dev LaunchDaemon
     -> dedicated non-login _nimiruntimedev principal
     -> Runtime-only System Keychain custody
     -> launchd socket-activated filesystem UDS listeners under /private/var/run/nimi-dev
        -> /Applications/Nimi Dev.app verified Desktop main
           -> fixed Kit protected carrier -> typed SDK consumers
           -> verified Desktop local-development supervisor
              -> independently signed Nimi Local App Host Dev.app
                 -> Zhiyu/local-app main + sandboxed renderer
  -> Runtime fixed local-development Realm broker -> http://127.0.0.1:3002
```

The development Runtime executable is installer-fixed at
`/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime`; its
durable state is the sibling `RuntimeDev/state`, and its external role records
are rooted at `RuntimeDev/active/trust/protected-local/v1`. The service label,
principal, bundle identifiers, Keychain service, state, role-record root,
sockets, Desktop bundle and local-host bundle are distinct from production.
Neither profile reads the other's state or trust root. Profile selection is a
compile-time build decision; environment, argv, renderer, app manifest and
user-writable configuration cannot select it, and a production verifier does
not contain the local-development release-root public key.

The machine-local CA uses distinct P-256 leaf identities for Runtime, Desktop,
local-app host, the privileged helper and release-record signing. The CA
private key is non-durable: it exists only in bootstrap process memory while
issuing this closed leaf set, is never inserted into any Keychain, file,
projection or evidence artifact, and becomes unreachable before bootstrap
retirement. Only the public root certificate and the final-helper-only signing-
Keychain unlock secret remain in the System Keychain. All five persistent role
private keys, including the release-record signer, remain in the fixed locked
signing Keychain. Zero profile private keys are admitted in System Keychain;
absence of both a durable root private key and every System profile private key
is positive custody evidence, not an unavailable state.
Apple Silicon's linker emits an ad-hoc, linker-signed CodeDirectory for the
initial helper executable. That object is a non-authorizing bootstrap input,
not a development carrier and not evidence for any admission row. Before the
explicit administrator transaction, the unprivileged orchestrator hashes one
canonical single-link build vnode and installs those exact bytes as two
root-owned, single-link regular files: the executing immutable bootstrap at
`/usr/local/libexec/nimi-macos-dev-security-bootstrap` and the never-yet-executed
final candidate at `/usr/local/libexec/nimi-macos-dev-security`. It verifies
that the source vnode and digest did not change and that both installed digests
equal the source. The root bootstrap accepts the transaction only when dynamic
inspection binds its current executable to the bootstrap path and
Security.framework proves the fixed build identifier, empty Team ID, absent
certificate chain, `adhoc` plus `linker-signed` flags, absent hardened-runtime
flag, and a designated requirement equal to its exact CDHash. Static inspection
must prove the final candidate is the same bootstrap identity before signing.
That CDHash may authorize only the bounded creation transaction or an
explicitly confirmed teardown/repair transaction that can only remove this
non-product profile. Bootstrap creates the non-durable CA key and public root
certificate, then creates the helper role key in the fixed, explicitly unlocked
root-owned signing Keychain. That one key initially names bootstrap as its ACL
owner and `/usr/bin/codesign` as its restricted signing subject, allowing it to
sign only the distinct final candidate with the new local-CA helper leaf.
Bootstrap's own vnode and code identity remain unchanged throughout.

Once static and dynamic inspection proves the final helper's exact local-CA
identity, bootstrap creates the record-signer, Runtime, Desktop and local-host
role keys in the already unlocked fixed signing Keychain with complete final
ACLs attached at insertion. It separately creates the unlock-secret generic-
password item in System Keychain with its complete final-helper-only ACL
attached at insertion. None of those items is modified after insertion.
System Keychain is forbidden from holding any profile private key: real macOS
insertion may add another partition ACL to a cryptographic key even when the
submitted `SecAccess` was complete, making the result ambiguous. Accepting the
extra ACL would widen authority, while normalizing it after insertion would
require interactive Keychain authentication. `SecKeychainItemSetAccess` is
therefore forbidden for every System profile item; neither sudo nor process
identity substitutes for that credential. Interactive fallback is disabled
and cannot become an admission path.

Only the helper role key may carry a temporary `{bootstrap, final helper}`
`changeACL` owner set, and only inside the explicitly password-unlocked fixed
signing Keychain. Its restricted signer and partition already name
`/usr/bin/codesign` and the final-helper CDHash. After the born-final unlock
secret is committed, one fresh final helper reads it, unlocks that Keychain,
removes the exact bootstrap owner from that one helper-role key, validates
final-only custody and relocks the Keychain. A second fresh final helper then
independently validates the complete certificate set, leaf SPKIs, designated
requirements, hardened runtime, fixed paths, final-only ACLs, release-record
signing, absence of every System profile private key and absence of any durable
CA private key. Only then may bootstrap be unlinked. Success requires bootstrap
absence, zero transitional ACLs, zero System profile private keys and zero
durable CA private keys.

Failure uses the still-immutable bootstrap, or the already verified final
helper after bootstrap retirement, to remove the root certificate, role keys,
trust setting, signing Keychain, public profile and both helper paths as one
privileged rollback. No ad-hoc Runtime, Desktop, local-app host, Kit carrier or
post-provision helper is admitted by this bootstrap exception. A running helper
may never authorize an ACL handoff after changing its own on-disk code identity.

`SecTrustedApplication` data is opaque and is not reconstructed or interpreted
as an executable identity by a later process. Before persistence, bootstrap
records SHA-256 for the exact final-helper and `/usr/bin/codesign` opaque ACL
entries in the root-owned public signing-profile v4. Every persistent item
and every role key born after final signing is validated against those exact
entries without an ACL update. The fresh finalizer identifies and removes only
the exact bootstrap entry from the helper-role key in the unlocked signing
Keychain, preserves the final opaque entry byte-for-byte, and compares all
persisted restricted/owner entries to the profile digests. SecCode, CDHash,
designated requirement, leaf SPKI, fixed path and process-parent/liveness checks
remain independent executable-identity proof; an opaque ACL digest never
substitutes for them. Any bootstrap-process `SecKey` or `SecAccess` view cached
before the final child closes the helper-role ownership is non-authorizing and
cannot serve as post-handoff evidence.
All five role identities live in the fixed root-owned, mode-`0600`,
normally locked system-domain Keychain at
`/Library/Application Support/Nimi/RuntimeDev/custody/local-development-signing.keychain-db`.
Its random unlock secret is a non-synchronizing System Keychain item whose
decrypt, delete, change-ACL and partition ACLs contain only the exact signed
helper. Bootstrap holds the not-yet-durable
secret in memory while creating and signing the distinct final candidate, then
creates the unlock-secret item once with its final signed-helper ACL already
attached. The fresh final helper reads that item, unlocks the fixed Keychain in
memory for the single helper-role ownership closure and validation transaction,
passes only the fixed Keychain pathname (never its password) to
`/usr/bin/codesign`, locks it in `defer` before returning, and wipes the
in-memory secret. Relocking before the final-only handoff completes, any
remaining bootstrap ACL subject, any durable CA private key, or any
authentication prompt is a fail-closed transaction error.
The bootstrap is not a durable deletion authority. Once the unlock-secret item
exists, provisioning rollback and explicit unprovision must retain and execute
the exact verified final helper until that helper targets the single item by
reference, deletes it without interaction, and proves it absent. Cleanup first
verifies this final-helper/item binding, then destroys the signing Keychain and
its five private identities, then deletes the now-useless unlock secret while
the final helper and public trust remain intact. Only after absence proof may
public trust and the final helper be removed. If the item remains while the
exact final helper is absent or untrusted, automatic cleanup fails closed as
`runtime-service-repair-required`; uid 0, a replacement bootstrap, a copied
helper, a broader query, or a deprecated deletion API cannot substitute for the
item's executable ACL. The bootstrap may complete public and fixed-path cleanup
only after the unlock secret is proven absent.
Keychain certificate labels are display/search hints and are never identity
authority. Public validation enumerates only the fixed Keychain named by the
profile and requires one unique certificate whose DER SHA-256 equals the
authority record. The root certificate additionally requires one exact admin
trust-settings usage constraint. The write request contains only
`kSecTrustSettingsPolicy` and `kSecTrustSettingsResult`; Security.framework's
read projection must contain exactly those keys plus its derived
`kSecTrustSettingsPolicyName` value `CodeSigning`. The result must be
`trustRoot`, and the policy's `SecPolicyCopyProperties` projection must contain
only the Apple code-signing OID. The derived policy name is an exact
serialization witness, not policy identity or caller-controlled authority. A
missing/wrong name or any fourth usage-constraint key fails closed. Pointer
identity or object-level equality of a policy reconstructed by
Security.framework is not authority; merely finding the certificate in System
Keychain is also insufficient.

Before the single System Keychain root certificate is inserted, the root helper
atomically records its exact DER SHA-256 in a root-owned mode-`0600` cleanup
record at
`/Library/Application Support/Nimi/RuntimeDev/dev-signing-cleanup-record.json`.
That operational record is not semantic or signing truth. It remains alongside
the public profile solely so interrupted provisioning and explicit
unprovisioning can identify exact transaction-created bytes after any subset of
the matching public/private keys has disappeared. Cleanup enumerates only the
fixed Keychain and accepts certificate identity only from a non-conflicting
public-profile or cleanup-record fingerprint. A surviving public key may add an
SPKI witness, but its absence cannot block deletion of a certificate already
identified by an exact recorded fingerprint. Common name, certificate label,
issuer text and partial key presence never authorize deletion. The cleanup
record is deleted only after the trust setting, exact certificates, labeled
keys, locked signing Keychain and unlock secret have all been removed or proven
absent.

One repair-only state machine exists for a stranded older final helper whose
unlock secret and cleanup record remain after the public profile, signing
Keychain, Runtime, Desktop, LaunchDaemon, service account and related processes
are all proven absent. The immutable current bootstrap must validate the fixed
final-helper vnode, strict signature, empty Team ID, hardened runtime, embedded
certificate chain and final-helper-only decrypt/change-ACL/partition binding.
It may recover only the embedded public root certificate whose DER SHA-256 is
identical to the cleanup-record fingerprint, and may temporarily install only
that certificate with the exact Apple CodeSigning admin trust constraint. The
bootstrap never reads or deletes the unlock secret. The stranded final helper
must then delete its own secret and the temporarily recovered public trust
material, after which the bootstrap proves zero fixed residue. Any broader
state, fingerprint mismatch, private signing custody, live carrier, or failed
zero-residue proof fails closed. This compatibility repair is not a normal
unprovision path and does not restore a CA private key.
An ordinary read-only status invocation must not unlock the mode-`0600`
root-owned signing Keychain. It verifies only the root-owned public profile,
signed helper identity and public root material, and reports
`signingCustodyVerification=privileged_transaction_required`. Provision,
fresh install and every admitted signing transaction run as the exact root helper;
the post-provision helper handoff uses a separate root-only private-custody
verification command rather than treating the public status projection as
evidence. Those transactions
unlock in memory, verify every private-key ACL/partition and record-signing
self-test, then relock before returning; no candidate can advance from the
public status projection alone. Storing role private keys in the globally
searchable System Keychain or granting them directly to the
globally callable `/usr/bin/codesign` trusted application in
`/Library/Keychains/System.keychain` is forbidden because that loses the
root-owned parent-transaction identity. No private key or unlock secret is
exported to the repository, build artifacts, argv, environment, renderer, app
storage, logs or evidence. The
local-development release record is schema v2 canonical JSON with
`environment=local_development`, `identity_class=local_ca`,
`signature_algorithm=ecdsa_p256_sha256`, an empty `macos_team_id`, the exact
leaf SPKI SHA-256, designated requirement, signing identifier, CDHash,
same-open-vnode artifact SHA-256, hardened-runtime posture, role, generation,
validity interval and compatible peer releases. Any non-empty Team ID in this
profile is rejected; the profile never claims notarization or Gatekeeper
acceptance. Production schema-v2 records continue to require
`identity_class=developer_id_application`,
`signature_algorithm=ed25519`, the exact Team ID and notarization posture.

The privileged development fresh-install helper validates the complete
candidate before elevation and writes one fsynced root-owned top-level
transaction journal before stopping the service or making the first install
mutation. Fresh admission requires the launchd job, service principal, fixed
service directories, LaunchDaemon plist, active Runtime, Desktop application,
installer ledger, Runtime custody and sockets all to be absent. The journal binds
the exact planned principal and owns every effect created after that proof. The
helper installs the fixed app/runtime/role-record set without symlink
authority, fsyncs the result, verifies it again, and only then bootstraps the
fixed system job. The journal and rollback generation are retained until final
mutually verified Runtime health succeeds; candidate commit alone is not the
installation commit boundary.
A mixed, interrupted, rollback-rebound or partially installed candidate remains
stopped and `runtime-service-repair-required`; it is never silently reset.
Rollback first boots out launchd and proves the Runtime process stopped, removes
and proves the sockets absent, and resets only custody created by this
transaction while the verified candidate Runtime remains at its fixed path. It
then removes the plist, active Runtime, Desktop, ledger and staging nodes,
deletes only transaction-created empty directories whose witnesses still
match, and finally deletes only the exact
transaction-created user before group. Any rollback failure retains the journal
and the candidate required for custody cleanup and reports both the original and
rollback errors. Initial trust provisioning, reset, uninstall and CA removal are separate,
explicit administrator operations. Runtime uninstall does not remove the
machine-local CA.

Local-development candidate update remains explicitly fail-closed. Existing
custody validation and Runtime startup currently call `AdmitReleaseLineage`,
which advances the Keychain-anchored release high-water before final installer
health. Restoring the prior candidate after a later failure would therefore be
an authority rollback. `pnpm dev:runtime` without `--install` returns
`dev-runtime-update-not-admitted` until a non-mutating lineage validation plus
installer-bound pending/commit protocol is separately specified, implemented
and admitted. This boundary does not weaken or block a fresh development-chain
installation.

One explicit delete-only repair bootstrap transaction may clean exactly two
first-install residue classes that predate the top-level journal. The normal
class `macos_local_development_v4_failed_first_install_exact_principal` requires
source principal carrier contract version `4` and the complete current
absent-authentication principal. The unique legacy class
`macos_local_development_v2_failed_first_install_disabled_user` requires an
installed signed source helper that reports principal carrier contract version
`2`. Its user must contain one raw OpenDirectory value for
`AuthenticationAuthority`; that value must be one `String` exactly equal to
`;DisabledUser;`. Every other authentication-material attribute must be absent.
Both classes require the positive user fields, dedicated group, POSIX
projection, full local-group membership projection and `_writers*` absence to
match the current authority exactly. Source carrier `4` can select only the
normal matcher and source carrier `2` can select only the legacy matcher. No
other carrier, residue class or authentication shape is repairable.

No loaded job, related process, socket, Runtime custody, active candidate,
Desktop or installer ledger may exist; the generated plist and exact empty
fixed directories must be the only filesystem install residue.

This legacy shape is evidence for deletion only. It is never admitted,
normalized or upgraded in place as a current principal. Repair deletes the
whole exact user before the exact group, proves Directory Services and POSIX
absence, and a later carrier-`4` creation must use fresh, distinct user and
group GeneratedUID values. Before deletion, the fsynced root-owned repair
journal schema is `nimi.macos-local-development-partial-install-repair/v2` and
its phases are exactly `prepared`, `artifacts-removed`, `user-removed`,
`group-removed` and `principal-removed`. The parent repair journal directly owns
all artifact and principal deletion; it cannot delegate to or recover a
principal-transaction journal. It binds the source helper SHA-256 and CDHash,
source carrier version,
residue-class identifier, authentication-evidence SHA-256, account-plan digest,
both observed GeneratedUID values, signing-profile root key id and authority
policy digest. The source-helper `status` receipt may be read exactly once only
after raw OpenDirectory classification has proved one complete unjournaled
principal baseline and before initial journal creation. A clean, partial or
conflicting unjournaled state never invokes `status`. Once a journal exists,
each phase revalidates the exact open-vnode final-helper SHA-256, CDHash,
signing identifier, empty Team ID, certificate-bound requirement, leaf and root
certificate digests, hardened runtime, signing-profile root and policy directly
against the journal. That opened vnode must match the device, inode, size,
modification time, change time, file flags and SHA-256 witness held by the
transaction's flock descriptor. The descriptor and named path are revalidated
again before the terminal commit. Delete, write, extend, link, rename, revoke,
`EV_ERROR` and `EV_EOF` observations are hard failures even when the original
name or bytes are restored. `NOTE_ATTRIB` is not path-replacement evidence by
itself: execution of the exact helper may advance observer-owned access time.
It is accepted only when device, inode, mode, ownership, link count, size,
modification time, change time, file flags and opened-vnode SHA-256 remain exact
and the complete static code identity is revalidated. Access time is never
authority. Every event diagnostic retains the exact numeric `kevent.flags`,
vnode `fflags` and decoded names
instead of collapsing them into an unqualified replacement claim. Static
revalidation is entirely in-process and must not invoke `status`, `codesign` or
any final-helper command. Recovery of the fixed non-semantic staging vnode runs
first under the locked in-process static helper authority and cannot authorize
a platform mutation. An exact clean
no-journal state returns before private custody is invoked. An active or newly
committed `prepared` journal then causes the root repair parent to obtain one
fresh private-custody receipt from the exact final helper before the first
artifact or principal effect. The invocation-local receipt binds the exact
journal terminal-proof digest, helper SHA-256/CDHash, root key, policy, parent
PID, parent process-start identity and the exact mutation-lock vnode witness. It
is not persisted; crash, restart, parent replacement or any binding change
invalidates it. Because the preserved source helper may predate bounded child
ownership, the parent uses `posix_spawn` with `POSIX_SPAWN_SETPGROUP` to create
and bind a new process group atomically before any current-bootstrap instruction
can run. The bootstrap validates `getpgrp() == getpid()` and forbids `exec` on
mismatch. The parent deadline owns that PGID, signals the whole group on timeout
or output overflow, reaps the direct child, drains both pipes to EOF, and proves
the PGID empty before emitting `child_reaped=true`; it never assumes that the
preserved helper has no descendants. Those static identity witnesses remain
stable before every phase, after final absence proof and at the terminal commit
boundary.

A fresh exact bootstrap process with a new ODSession returns a
live-parent-bound absence receipt for both Directory Services records and the
POSIX projection. It validates and returns the parent PID and process-start
identity, while the parent revalidates its own identity before accepting the
receipt. After bootstrap context validation the fresh verifier may execute only
in-process Security.framework, fixed-vnode, public-profile/root-trust,
OpenDirectory and reentrant-libc checks: it launches no descendant process and
never unlocks private custody. The parent brackets the child with bounded
quiescence proofs before launch and again after receipt acceptance, before any
phase commit or success. An exact clean state without a v2 repair journal is
not a repair success: it returns typed
`macos-dev-runtime-repair-not-required` before cache reset, principal or artifact
mutation, never invokes source-helper `status`, and never invents source-carrier
or install-readiness evidence. Trust-helper verification or rotation remains a
separate confirmed transaction. Any absent, stale or mismatching binding fails
closed.
The journal uses one fixed single-use staging path. Before any unknown-entry or
phase-state evaluation, an interrupted staging write may be removed only while
the final-helper mutation lock is held and only after an open descriptor proves
one root-owned, root-group, mode-`0600`, single-link regular file of at most
`65536` bytes and a no-follow path revalidation proves the same device and
inode. The staging node is never semantic authority. Repair also requires a
fresh final-helper private-custody proof before deletion. It preserves the
signing profile, signing Keychain, local CA and final helper and cannot become a
generic account or file deletion surface.

One repair invocation has a hard `600`-second deadline owned by the root repair
helper. Every child command has a shorter timeout and may start only when its
complete timeout/escalation budget fits inside the remaining outer deadline.
Direct-child commands atomically reserve the one launch slot before
`Process.run` and bind the PID before input or wait. Commands that can execute
the preserved helper instead use `posix_spawn` with
`POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT` while the deadline lock is
held, so successful spawn and PID/PGID binding form one indivisible transition.
An expired invocation fails before its next spawn. Timeout or output overflow
signals the whole owned PGID with `TERM` then `KILL`, reaps the direct child,
drains stdout and stderr to EOF, and requires `kill(-PGID, 0)` to report
`ESRCH` before `child_reaped=true`. Any unbound or unreaped state is
quiescence-unproven and forbids wrapper cleanup. The Node launcher does
not timeout or signal the `sudo` repair call and never starts cleanup before
`sudo` has observed the root helper exit. A hard-deadline termination therefore
leaves only a journal-owned effect-ahead state. After the privileged process is
quiescent, one bounded, sanitized, non-authoritative local JSON diagnostic is
written under `.nimi/local/acceptance/**`; it retains every admitted non-sensitive
principal diagnostic field and bounded subprocess status, excludes stderr and
custody or token material, and stops automatic retry after the first failure.
Vnode diagnostics also retain the lock device, inode, SHA-256, before/after
change-time witnesses, journal phase/presence, completion/bootstrap state and
any primary failure identity. Missing structured JSON or missing explicit
`child_reaped=true` evidence must preserve the exact bootstrap; absence of
evidence never authorizes cleanup.

The transition executor prepares the exact success receipt while the durable
`principal-removed` journal still exists. The outer final-helper vnode and
static-code proof runs next; bootstrap self-retirement must also finish while
that journal remains recoverable. A second final-helper proof immediately
precedes exact journal unlink, which is the last semantic effect. Any proof,
retirement or unlink failure therefore either preserves the journal or reaches
the independently provable clean no-journal boundary, and never emits repair
success. No authority check after journal unlink may retroactively turn a
committed repair into an unrecoverable failure.

Delete-only repair success is not equivalent to installation readiness. Repair
preserves the source final helper. If its bound source carrier is older than the
current carrier `4`, normal Runtime installation remains fail-closed until a
separately confirmed trust/helper rotation removes the old custody profile,
reprovisions one current signed helper, and independently proves its custody and
carrier. This compatibility boundary must be disclosed before repair and may
not be hidden by accepting carrier `2` in the normal carrier-`4` matcher. The
success receipt has one exact generated schema and records the preserved source
carrier, required install carrier, preserved-helper disposition, boolean rotation
requirement and the separate next privileged action; unknown or inconsistent
fields fail closed in the Node launcher.

Raw `/Local/Default` OpenDirectory name and numeric-identifier absence is the
deletion mutation truth. POSIX/libinfo is an eventually consistent acceptance
projection, not an intermediate mutation authority: the `user-removed` boundary
must not perform a positive group lookup that warms the cache immediately before
group deletion. All POSIX queries use `getpwnam_r`, `getpwuid_r`, `getgrnam_r`
and `getgrgid_r`; only return-code `0` plus a nil result means not found,
`ERANGE` has bounded buffer growth, and every other return code is a typed query
failure rather than absence.

For this non-product development profile only, after journaled user-then-group
deletion has proved exact raw OpenDirectory absence, the serialized root helper
runs exactly `/usr/bin/odutil reset cache` before final absence acceptance. This
transiently resets
all `opendirectoryd` identity, membership and kernel caches; it does not reset
DNS or mutate persistent OpenDirectory configuration. Cache reset is never a
substitute for the bound raw-record witness. For a journal-bound deletion, a
fresh bootstrap process must then prove both raw name/identifier absence and
four reentrant POSIX not-found results before the final journal is removed or
the UID/GID may be reused. An already-clean no-journal boundary has no authority
to invent a historical UID/GID or source carrier and therefore exits through
the typed no-repair-required boundary without running the repair state machine.
Lookup failure, OpenDirectory mutation failure, stale exact cache, identifier
reuse and record mismatch have distinct reason codes and bounded non-sensitive
field diagnostics; none may be collapsed into successful absence.

The development service principal is created only through the public
OpenDirectory framework. The installer selects one collision-free equal UID/GID
in the macOS role-account range `450..499`, generates distinct canonical user
and group UUIDs, and fsyncs a root-owned mode-`0600`
`RuntimeDev/principal-transaction.json` before the first Directory Services
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
machine-independent authority. Carrier `4` requires `AuthenticationAuthority`
to be absent and never accepts or normalizes `;DisabledUser;`. That exact value
is recognized only as the delete-only carrier-`2` legacy residue defined above;
it is not an admitted standalone non-login identity. The
installer then synchronizes and uses a fresh exact-signed real-root helper
process with a new ODSession to prove the exact raw OpenDirectory and POSIX
projections, including absence of every forbidden authentication, writer and
explicit-membership attribute. The child receipt is bound to the journal
transaction and account-plan digest; the parent deletes the journal only after
that receipt succeeds. Non-root status cannot promote unreadable protected
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
An already present exact admitted principal is durable installation
infrastructure and is never owned or removed by a failed candidate update.
`dscl`, `sysadminctl`, `dsimport` and direct dslocal database writes are forbidden
mutation fallbacks; `dscl` may appear only in non-authorizing human diagnostics.
Every install, restart, reset, uninstall, release-record signing and trust
unprovision mutation holds one non-blocking exclusive `flock` on the same exact
open root-owned final-helper vnode for the full transaction. Contention fails
before mutation; no pathname-only lock file or removable inode creates a second
serialization truth.

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
