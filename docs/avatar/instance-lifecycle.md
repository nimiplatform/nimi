# Instance Lifecycle

An Avatar instance is a running Avatar process that presents one
Runtime-authorized LocalAgent. A launch can also reattach to an existing
Avatar instance. Runtime keeps the active binding and conversation
continuity; Avatar handles only the local shell and the rendering
lifecycle.

## Minimal Launch Intent

The default launch payload is deliberately small:

| Field | Required? | Meaning |
| --- | --- | --- |
| `agentId` | yes | A `local-agent:` reference selected by the caller |
| `avatarInstanceId` | optional | The Avatar instance to resume |
| `launchSource` | optional | Non-authoritative launch attribution |

Every field is untrusted until Runtime validation completes. Account and user
identity, Realm endpoints, credentials, conversation anchors, visual packages,
model selection, calibration, renderer settings, and raw filesystem paths are
not launch inputs. The verified native host materializes only the visual
package authorized by Runtime under the protected data root.

Avatar does not read or store access tokens, refresh tokens, JWTs,
authorization headers, or durable account sessions. Realm-mediated work goes
through the protected first-party Runtime surface.

## Runtime Binding

After launch, Avatar asks Runtime to resolve or register the typed
`AvatarLiveInstanceBinding` for the selected LocalAgent and instance. That
binding associates the active Avatar instance with Runtime-owned conversation
continuity. It is not a public registry, a cross-app subscription surface, or
an Avatar-owned source of agent truth.

Avatar accepts the binding only when its LocalAgent, Avatar instance, account
context, and conversation snapshot agree. A missing or mismatched binding keeps
the shell non-ready.

## Closed Shell Lifecycle

The shell occupies exactly one of these states:

| State | Meaning |
| --- | --- |
| `loading` | Bootstrap, Runtime binding, and visual carrier readiness are still in progress |
| `ready` | Bootstrap is complete, the Runtime binding is valid, and the carrier has visible output |
| `degraded:reauth-required` | The protected Runtime session requires the host to reauthenticate |
| `degraded:cloud-offline` | Required cloud access is unavailable |
| `degraded:runtime-unavailable` | The local Runtime cannot serve the required operation |
| `degraded:launch-context-invalid` | The launch intent or resolved binding is invalid |
| `error:bootstrap-fatal` | Bootstrap cannot continue |
| `relaunch-pending` | A validated relaunch is pending |

Only `ready` mounts the embodiment stage and explicitly opened transient
overlays. Every other state unmounts the stage and shows only its bounded
loading, degraded, error, or relaunch surface. Avatar does not infer readiness
from cached or fixture state.

## Reader Scenario: Desktop Opens an Avatar

1. Desktop sends `{ agentId: "local-agent:ren" }`.
2. Avatar validates the payload shape and remains in `loading`.
3. The protected Runtime surface resolves the LocalAgent, continuity snapshot,
   and active instance binding.
4. The native host materializes the exact Runtime-authorized visual package.
5. Avatar creates one of the admitted backend branches and waits for visible
   carrier output.
6. The shell enters `ready`.

Desktop and Avatar do not exchange package, credential, account, model, or
conversation truth through the launch payload.

## Reader Scenario: Runtime Becomes Unavailable

1. A Runtime prerequisite fails while the Avatar is active.
2. The shell enters `degraded:runtime-unavailable`.
3. The embodiment and transient overlays unmount.
4. Recovery requires a new valid Runtime result and visual readiness before the
   shell can return to `ready`.

## Ownership Summary

| Concern | Owner |
| --- | --- |
| LocalAgent execution and continuity | Runtime |
| Active `AvatarLiveInstanceBinding` | Runtime |
| Launch intent validation | Avatar shell |
| Protected package materialization | Verified Avatar native host |
| Shell lifecycle and local presentation | Avatar |
| Backend resources and shutdown | Avatar backend branch |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
