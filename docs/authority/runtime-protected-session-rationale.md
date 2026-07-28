# Runtime Protected Sessions

Runtime owns protected local session truth. Localhost reachability, a claimed
app id, renderer metadata, or a caller-provided token is not trusted identity.
The native host verifies the service, endpoint, executable, and current
connection before opening a protected session.

Desktop is a replaceable Home host. Renderer code receives no protected
authority, and native platform mechanisms do not change product semantics.
Runtime owns app-path credentials and derives caller identity and LocalAgent
access from the current session and operation.

Scaffolded apps reach Realm-owned data through Runtime mediation and never
receive a Realm JWT or provider credential. Direct SDK consumers remain a
separate posture and keep their own standard Realm authentication custody.

Disconnect, account transition, revocation, service replacement, or missing
owner evidence invalidates affected access. A fresh connection or app session
does not restore an earlier decision. Missing protected access always fails
closed.

Windows is the current product priority. macOS requires an independent native
security result and follows without blocking Windows readiness. Linux support
remains deferred. Automated tests support these contracts but do not substitute
for native product acceptance.

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
