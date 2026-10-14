# Kit Protected Local Host Carrier

`kit/shell/protected-local` is the shared native Rust boundary for protected
Windows and macOS Runtime transports. Production retains its independently
admitted fixed-service topology; source D2 uses a per-user Runtime with thin
current-user pipe/socket and process adapters. Both expose the same two
connection-bound surfaces:

- Desktop control for fixed-service account, Developer Mode, exact product
  control, and exact Desktop runtime-consumer unary operations
- The common third-party Local App carrier

The Local App carrier connects only to the active profile's native protected
endpoint, verifies the live Runtime process under that profile, performs
the request-empty `OpenLocalAppSession`, and retains the verified process,
channel, and Runtime boot epoch privately.

On macOS, the trust boundary relies on the fixed root-owned Runtime path and socket,
`LOCAL_PEERTOKEN` / `LOCAL_PEERPID`, exact PID/EUID/start and exit/exec liveness, and
strict SecCode validation. The local-development build requires an ad-hoc signature,
exact signing identifiers, and hardened runtime without consuming a Team ID,
Apple certificate chain, or notarization result. The mutually exclusive production
build requires its compile-time Team ID, Apple trust anchor, Developer ID, and
notarization policy. Neither path consumes release, role, compatibility,
artifact-hash, or CDHash records.

Windows source D2 derives owner-only named-pipe endpoints from the current OS
user, binds the pipe server to Desktop's exact child Runtime process, and keeps
production service, installer, signing, and update trust unchanged outside that
feature. Native profile choice adds no App access or reason semantics.

The published macOS Local App carrier also supports installed Apps supervised
by a source-development Home. It consumes the Host's exact Runtime executable
observation, derives the current user's fixed local-App socket, and runs the same
per-user native peer checks as the development carrier. The Host strips workspace
carrier overrides, so the App continues to load its admitted package bytes.
A missing observation defaults to the production Local App profile; an invalid
observation or mismatched peer fails closed without a production/source fallback.
This does not redirect production Desktop control or bypass Runtime's independent
installed-source, session, or App Access admission.

Windows production unsigned Beta uses the compiled Platform product public key
to authenticate the complete installed Desktop/Runtime/Avatar inventory in the
fixed administrative non-reparse Program Files product tree. The native carrier
retains the exact live SCM Runtime process and locked executable, verifies all
inventory bytes and ACLs, then opens the protected channel. Runtime independently
admits the matching Home product release and source revision while retaining its
fixed service SID, session, and protected-data custody checks. An unsigned PE or
development certificate carries no product identity. The Host-only updater query
has no arguments and returns the fixed admitted helper and public-key projection;
it never replaces code, selects a release, or controls the service.

Its complete admitted Local App operation surface is session status, three
protected principal-partitioned JSON storage operations, exact WorldCore
list/create, the selected RuntimeAgent conversation operations, bounded
Runtime-selected foreground text candidates, owner-free whole-object App
AIConfig get/overwrite, shared LocalAgent-subsystem AIConfig get/overwrite,
Agent autonomy snapshot/update, and Agent presentation snapshot/commit.
Runtime derives both AIConfig owners from the protected Local App session. The
shared Agent AIConfig surface carries no individual Agent handle; autonomy and
presentation accept only an opaque session-scoped handle and independent
revision CAS. Presentation commit projects the previous profile needed for
restore. AI profile mutation and Artifact operations are not exposed.

Independent `agent.work` requests use business Agent references, execution IDs,
ordered bounded events, and tool-result handoff. No work input or tool result is
accepted by Conversation. Fixed Integration methods carry dynamic descriptors
and operation data while Runtime retains identity, resource permission, and
credential custody. The native boundary exposes no dynamic Runtime method
selector; Home management is revalidated by its protected Runtime owner.

The `agent.local` carrier also exposes the exact embodiment snapshot and
ordered subscription operations. Their projection is limited to Runtime-owned
activity, emotion, semantic posture, provenance, and bounded voice-timing
correlation. It carries no renderer mapping, motion, lipsync parameter, audio
clock, raw replay, backend probe, or diagnostic store.

The `app.activity` operations carry `RuntimeAppActivityService` put, list,
change subscription, mark-read, source open, and the source App's open-request
subscription and completion. Records project Runtime's trusted source, user
view, and change sequence; publisher `dataJson` stays opaque text. The source
open stream yields at most one Host-private open request id, consumed by the
Kit Host for the Desktop launch and never forwarded to renderer code, followed
by the typed Runtime result; dropping the stream cancels the pending request.
Unknown enums or missing Runtime messages fail closed as untrusted.

Synchronous Scenario execution carries the caller deadline as the call's
`grpc-timeout` and a local timer (at most 120 seconds); its expiry is the typed
`timeout` reason and never drops the cached App session. The text-decide variant
is validated against the public bounds before transport, keeps JSON content as
the caller's text, and its answers must match the submitted questions exactly.
The Node binding cancels one call by its Host-generated identity and bounds the
outstanding identities.

The crate never exposes a generic method-id/bytes proxy, endpoint, credential,
portable session proof, principal, record, grant, launch lease, process tuple,
account identity, or Runtime boot epoch. Runtime independently admits each
local-development or verified-installed source and binds the exact
Desktop-launched process before opening a Local App session. Carrier selection
does not replace package verification or convert one source's admission into
another's. Linux remains compile-only and fails closed until its native trust
carrier is admitted.
