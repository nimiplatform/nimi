# Runtime App Surface

Runtime owns local app principals, records, protected sessions, supervised
local-development launch, app messaging, and principal-scoped app storage.
Platform package metadata and app display identifiers do not grant Runtime
authority.

## Current Lifecycle

Production Developer Mode is the only positive app lifecycle. A foreground
Desktop decision can authorize an unchanged local project for a supervised run
or project scope. Launch preparation, process binding, and the app session are
new protected Runtime state; app code receives no portable credential or
account material.

Revoke and run-once completion tombstone the development principal. Project
identity changes, capability expansion, uncontrolled output, or carrier
mismatch require a fresh decision. Ordinary install, import, update, uninstall,
repair, package readiness, account inventory, lifecycle jobs, and lifecycle
events are deferred and physically absent.

## Messaging And Storage

App messaging derives its sender from the authenticated connection, uses closed
message families, bounds payloads and rates, and keeps live delivery
process-local. LocalAgent access through app messaging uses the same
session-derived authorization seam as every other LocalAgent consumer; an app
cannot attach caller-authored authorization proof.

Runtime app storage is keyed by the current local-app principal. The public app
surface exposes only the bounded JSON operations admitted by canonical
authority and never discloses host paths or a generic file API.

## Authentication

RuntimeAuthService owns app and external-principal session mechanics, not local
account custody. Protected local session opens are request-empty and derive
identity from the verified connection. Registration, AppMode, manifest fields,
and a fresh session cannot restore stale authority.

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
