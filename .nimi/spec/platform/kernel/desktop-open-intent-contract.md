# Desktop Open Intent Contract

> Authority: Platform Kernel

## Scope

This contract defines the cross-app protocol for a Nimi app to request an
already-running Nimi Desktop process to focus itself and open an admitted
Desktop-owned surface. It does not admit Desktop cold-start, OS custom-scheme
launch, arbitrary URL opening, OAuth opener reuse, or app-owned Desktop routing
truth.

## P-DOPEN-001 - Sole Running Desktop Open Contract

`DesktopOpenIntent` is the only admitted other-app-to-running-Desktop open
contract. The public SDK TypeScript name is `NimiDesktopOpenIntent`.

`desktop-open.openIntent` is the standard shell operation for this contract.
Apps must not construct Desktop URLs, emit Desktop menu-bar events, or call
Desktop-private IPC to request Desktop navigation.

## P-DOPEN-002 - Running-Only Boundary

The standard must not start Desktop when Desktop is not running. Missing,
stale, malformed, refused, or mismatched Desktop presence resolves as
`desktop-open-desktop-not-running`.

Running-not-ready resolves as `desktop-open-desktop-not-ready`. The standard
must not queue requests while Desktop is not ready.

## P-DOPEN-003 - Closed Target Kind Set

Valid target kinds are:

- `open-explore`
- `open-runtime-config`
- `open-agents`
- `open-apps`
- `open-settings`

Target-specific enum values are owned by Desktop target catalogs referenced
from `tables/desktop-open-intents.yaml`. Platform must not duplicate Desktop
IA truth.

## P-DOPEN-004 - Closed Envelope

`DesktopOpenEnvelope` carries:

- `schemaVersion=1`
- host-injected `sourceApp`
- host-injected `sourceHost`
- host-generated-or-validated `requestId` matching `^desktop-open-[A-Za-z0-9][A-Za-z0-9._:-]{0,114}$` with max length 128
- `intent`

Apps do not provide trusted identity fields. `sourceApp` is host-injected
metadata and is never authorization truth. `sourceApp` and `open-apps.appId`
use the canonical Platform app id grammar from
`tables/nimi-app-identity-surfaces.yaml` (`app_id_pattern`) with a Desktop Open
max length of 96. Unknown fields are rejected.

## P-DOPEN-005 - Not An Arbitrary URL Opener

`desktop-open.openIntent` is a closed intent operation. It does not accept raw
URLs, OAuth URLs, OS custom schemes, or browser navigation requests.

`oauth.openExternalUrl` must not dispatch Desktop Open Intent and must reject
Desktop Open reserved loopback routes before bridge authentication is involved.

## P-DOPEN-006 - Transport Boundary

OS custom scheme transport is not canonical for this standard because it can
start Desktop. Production transport is the Desktop-owned running presence
descriptor plus exact-loopback bridge, invoked by Kit standard shell hosts.

## P-DOPEN-007 - Local App Host Identity

`desktop-electron-local-app-host` is the admitted third-party `sourceHost` value
for `local-nimi-app-standard-shell-v1`. A verified local-app carrier injects
that host class into Desktop Open envelopes; application code cannot select or
override it, and the host must not collapse it into generic Electron identity.
The value carries routing provenance only and is never principal, grant,
session, package, or authorization truth.

## P-DOPEN-008 - Domain Result Codes

The admitted v1 domain result codes are:

- `desktop-open-desktop-not-running`
- `desktop-open-desktop-not-ready`
- `desktop-open-intent-invalid`
- `desktop-open-target-unsupported`
- `desktop-open-bridge-auth-failed`
- `desktop-open-host-unavailable`

`desktop-open-bridge-unavailable` is not an admitted v1 result code.

Connection refused, stale descriptor, malformed descriptor, non-loopback
endpoint, and `bridgeId` mismatch are `desktop-open-desktop-not-running`, not
bridge-unavailable.

## P-DOPEN-009 - Evidence Requirement

Closeout evidence must cover every row in the Desktop Running Open Intent
acceptance matrix by stable row id. Summary prose alone is not evidence.

## Fact Sources

- `.nimi/spec/platform/kernel/tables/desktop-open-intents.yaml`
- `.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml`
- `.nimi/spec/desktop/kernel/tables/desktop-open-targets.yaml`
- `.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml`
