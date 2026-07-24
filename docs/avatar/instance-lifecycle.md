# Instance Lifecycle

> Status: Running today. The Avatar app launch path, instance
> registry, and bounded handoff semantics are shipped per
> `app-shell-contract.md` and `nimi-avatar.md`.

An Avatar **instance** is a running Avatar app process bound to one
agent and (optionally) one explicit avatar instance id. The instance
lifecycle covers how it starts, how Desktop hands off launch context,
how multiple instances coordinate, and what state can survive across
launches.

## What an Instance Is

| Concept | Meaning |
| --- | --- |
| Avatar instance | A running Avatar Tauri process |
| Default Avatar app id | `nimi.avatar` |
| `agent_id` | Required at launch; identifies the agent driving this instance |
| `avatar_instance_id` | Optional at launch; identifies a specific persisted instance |
| `launch_source` | Optional, non-authoritative trace of who launched it |

Avatar is a Runtime-admitted local first-party app. It can use
runtime account projection and runtime-issued short-lived access
tokens like other first-party apps. It does not hold refresh tokens,
durable auth sessions, or independent Realm auth truth.

## Launch Intent

Desktop launches Avatar with a minimal intent payload:

| Field | Required? | Notes |
| --- | --- | --- |
| `agent_id` | yes | Identifies the agent |
| `avatar_instance_id` | optional | Targets a specific instance for replay |
| `launch_source` | optional | Non-authoritative; trace only |

Desktop **must not** pass scoped binding truth, visual package truth,
conversation anchor truth, account / user truth, or auth material
into the default Avatar launch path. Avatar resolves what it needs
through runtime account projection.

Explicit binding-only / embedded / delegated Avatar mode remains
admittable per `K-BIND-*`, but it is not the default Desktop launch
path.

## Instance Registry

The `avatar_instance_registry` is the platform's projection that
tracks live and persisted Avatar instances. It is the seam used for
cross-app coordination.

| Used by | What it provides |
| --- | --- |
| Desktop chat | "Is there a live Avatar instance for this agent?" |
| Avatar companion surface | Health indicator: is this instance still admitted? |
| Other apps subscribing to avatar events | Cross-instance correlation when multiple instances exist |

The registry projection is a **projection**, not a remote control
surface. The composition state of an Avatar instance is decided by
the runtime carrier. The registry reports; it does not command.

## Composition State Machine

An Avatar instance moves through composition states managed by the
Avatar carrier:

```
loading → ready → degraded:* → relaunch-pending
```

| State | Meaning |
| --- | --- |
| `loading` | Backend mounting, model resolving, surface composition initializing |
| `ready` | Embodiment stage + companion surface live; backend reports admitted bounds |
| `degraded:*` | Specific degraded posture (typed reason code); degraded surface replaces embodiment + companion |
| `relaunch-pending` | Instance scheduled to relaunch (e.g., backend restart required) |

Transitions emit `avatar.composition.*` events. Companion surface
must not self-decide ready / degraded — it consumes the projection.

## Cross-Surface Continuity

The same agent often appears in:

- Desktop chat (via `kit/features/avatar` consuming
  `.nimi/spec/canonical/desktop/agent-projection.authority.yaml`)
- The standalone Avatar carrier (this app)

These surfaces stay in sync because both consume the **same runtime
projection**. They do not coordinate with each other; they consume
the runtime event stream and the registry projection.

## Bounded Handoff at Close

When Avatar closes (user-initiated or Desktop-initiated), bounded
handoff is allowed:

| Field | Allowed in handoff |
| --- | --- |
| `avatar_instance_id` | yes |
| `surface attribution` | yes |
| `agent_id` | yes (re-asserted) |
| package descriptor / paths | no |
| auth material | no |
| anchor truth | no |

Persisted instance state is keyed by `avatar_instance_id` and is
re-validated against runtime snapshot before reuse. Avatar does not
trust local state to represent runtime authority across launches.

## Reader Scenario: Desktop Launches Avatar for Agent X

1. **Desktop emits launch intent.** `{ agent_id: 'agent-x' }`.
   No package truth. No conversation anchor.
2. **Avatar starts.** Resolves agent context through runtime account
   projection. Acquires runtime-issued short-lived access token.
3. **Backend mounts.** Composition state moves `loading → ready` once
   the backend reports admitted bounds.
4. **Registry updates.** `avatar_instance_registry` reflects the
   live instance for agent-x.
5. **Desktop chat surface updates.** Consumes the registry; renders a
   "live instance" indicator without coordinating directly with the
   Avatar process.

Two surfaces, one source of truth.

## Reader Scenario: Replaying a Specific Instance

1. **Desktop emits launch intent.** `{ agent_id: 'agent-x',
   avatar_instance_id: 'inst-7' }`.
2. **Avatar resolves persisted state.** Persisted state is keyed by
   `avatar_instance_id` and **must** be re-validated through runtime
   snapshot before reuse.
3. **Validation passes.** Backend mounts; previous bounds restore.
4. **Composition reaches `ready`.** Registry updates.

If snapshot validation fails, the instance does not silently start
with stale state. Failure is typed; the instance either starts fresh
or does not start.

## Reader Scenario: Degraded Posture

1. **Backend reports a typed degraded reason.** (e.g., asset tier
   downgrade, audio bridge offline, generated motion provider
   blocked).
2. **Composition transitions to `degraded:<reason>`.**
3. **Degraded surface activates.** Replaces embodiment + companion.
   Companion surface does not stay live; the degraded surface owns
   the entire visual region per the contract.
4. **Registry updates.** Cross-app subscribers can render a degraded
   indicator.
5. **Recovery.** When the backend recovers, projection emits the
   transition back to `ready`.

Degraded is a typed posture, not a fallback.

## What the Instance Lifecycle Does Not Do

- It does not silently elevate Avatar to durable auth ownership.
- It does not allow Desktop to seed package truth into the default
  launch path.
- It does not allow the companion surface to override composition
  state.
- It does not persist auth material across launches.
- It does not silently relaunch on backend error — `relaunch-pending`
  is an explicit composition state.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Launch intent shape | App shell contract (NAV-SHELL-*) |
| Composition state machine | App shell contract |
| Instance registry projection | Runtime / Avatar app shell |
| Persisted instance keying | App shell contract |
| Cross-surface continuity | Runtime account projection + registry |
| Bounded handoff at close | App shell contract |

## Source Basis

- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/nimi-avatar.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/nimi-avatar.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md)
- [`.nimi/spec/canonical/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/desktop/agent-projection.authority.yaml)
