# App Messaging

> Status: Running today. `RuntimeAppService.SendAppMessage` and
> `SubscribeAppMessages` are the shipped runtime-mediated cross-app
> messaging primitive (`K-APP-001..K-APP-013+`).

Cross-app coordination on Nimi goes through **runtime-mediated app
messaging**. Apps do not poke each other directly — they emit typed
messages and subscribe to typed events through `RuntimeAppService`,
which authenticates senders, enforces rate limits, detects loops,
and applies the credential-plane scoped binding requirement when an
app messages an agent surface.

## Method Surface

`RuntimeAppService` methods are frozen:

| Method | Purpose |
| --- | --- |
| `SendAppMessage` | Send an inter-app message |
| `SubscribeAppMessages` | Subscribe to an event stream of inter-app messages |

## SendAppMessage

| Field | Required | Notes |
| --- | --- | --- |
| `from_app_id` | yes | Sender app id (must be runtime-authenticated) |
| `to_app_id` | yes | Recipient app id |
| `subject_user_id` | no | Associated user |
| `message_type` | no | Message type identifier |
| `payload` | no | JSON struct |
| `require_ack` | no | Whether sender wants delivery acknowledgement |
| `scoped_binding` | conditional | Required when `to_app_id=runtime.agent` and the message family is in the K-APP-008 set |

Returns `message_id` (ULID), `accepted`, `reason_code`.

The `scoped_binding` field is the credential-plane boundary: an app
that sends to the runtime agent surface in admitted families must
present its admitted scoped binding (issued by
`RuntimeAccountService.IssueScopedAppBinding`). The binding carries
non-secret binding id / optional handle / non-secret relation
selectors. This is why the app-messaging surface lives in the
auth/identity wave — the binding is itself auth-bearing.

## SubscribeAppMessages

| Field | Required | Notes |
| --- | --- | --- |
| `app_id` | yes | Subscriber app id |
| `subject_user_id` | no | Filter to a specific user |
| `cursor` | no | Resume cursor |
| `from_app_ids` | no | Filter by senders (repeated) |
| `scoped_binding` | conditional | Required when `from_app_ids` includes `runtime.agent` AND the stream is for explicit binding-only consume |

`AppMessageEvent` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `event_type` | `AppMessageEventType` | `RECEIVED` / `ACKED` / `FAILED` |
| `sequence` | uint64 | Monotonically increasing |
| `message_id` | string | Message id |
| `from_app_id` | string | Sender |
| `to_app_id` | string | Recipient |
| `subject_user_id` | string | Associated user |
| `message_type` | string | Message type |
| `payload` | Struct | Payload |
| `reason_code` | ReasonCode | Result code |
| `trace_id` | string | Trace id |
| `timestamp` | Timestamp | Event time |

## Security Baseline

Phase 2 launch baseline rules:

| Rule | Constraint | Reason |
| --- | --- | --- |
| App authentication | `SendAppMessage` must verify `from_app_id` is registered with `RuntimeAuthService` and the current session holds a valid token. Unauthenticated returns `UNAUTHENTICATED` | Prevents arbitrary process from spoofing a registered app |
| Payload size limit | `payload` Struct serialized must not exceed **64 KB**. Over: `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | Prevents one message from exhausting runtime memory |
| Send rate limit | Per `from_app_id`: **100 msgs/sec** sliding window. Over: `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | Prevents storms / DoS |
| Loop detection | Same `(from_app_id, to_app_id)` pair > **20 messages bidirectional within 1 second** auto-circuit-breaks the pair for **60 seconds** with `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`. Both apps may continue to talk to others during the breaker | Prevents fork-bomb between two mods |

The security baseline is part of the contract, not advisory.

## Why Runtime-Mediated Instead Of Direct

Two apps could in principle talk directly. The runtime-mediated path
exists because:

| Concern | Direct path | Runtime-mediated path |
| --- | --- | --- |
| Sender authentication | App-side trust assumption | Runtime verifies `from_app_id` against admitted registration |
| Audit | Per-pair audit logic | One canonical audit surface |
| Rate limiting | Per-pair logic | One canonical rate limit |
| Loop detection | Each pair re-implements | One canonical breaker |
| Credential-plane binding to agent surfaces | App responsibility | Enforced via `scoped_binding` |
| Cross-app coordination semantics | Ad-hoc | Typed event stream |

The runtime is the coordination substrate. Apps don't reinvent it.

## Reader Scenario: A Mod Sends A Typed Message To Another App

A notes mod wants to ask a calendar mod for the user's free time.

1. **Mod registered + authenticated.** `RuntimeAuthService` knows
   about the notes mod; the current session has a valid token.
2. **`SendAppMessage`.** notes mod calls with
   `from_app_id: notes`, `to_app_id: calendar`,
   `message_type: 'free-time-query'`,
   `payload: { date: '...' }`.
3. **Runtime authenticates sender.** Verifies `from_app_id`.
4. **Runtime checks size + rate.** Within limits.
5. **Runtime delivers.** Calendar mod's
   `SubscribeAppMessages` stream emits `RECEIVED`.
6. **Calendar processes.** Sends back a response via its own
   `SendAppMessage`.
7. **Notes receives.** Through its own subscription stream.

Both mods participate through `RuntimeAppService`. Neither tries to
reach behind the runtime.

## Reader Scenario: A Mod Messages The Agent Surface

A mod wants to send a typed message to the user's agent. This is the
case the `scoped_binding` requirement covers.

1. **Mod has a scoped binding.** Issued earlier by
   `RuntimeAccountService.IssueScopedAppBinding` for the admitted
   purpose.
2. **`SendAppMessage`.** `from_app_id: mod-x`,
   `to_app_id: runtime.agent`, message family in the K-APP-008 set,
   plus the `scoped_binding`.
3. **Runtime validates binding.** Binding id resolves; relation
   selectors check; non-secret handle (if present) matches.
4. **Delivery.** Message reaches the agent surface under the
   admitted binding context.

Without a valid scoped binding, the same message is rejected. The
boundary is what keeps mod-to-agent messaging from becoming a
credential-plane bypass.

## Reader Scenario: A Loop Trips The Breaker

Two mods accidentally enter a chatter loop sending each other rapid
messages.

1. **Send rate climbs.** Within one second, the
   `(mod-a, mod-b)` pair exchanges > 20 messages bidirectional.
2. **Breaker trips.** Runtime emits `APP_MESSAGE_LOOP_DETECTED` for
   subsequent sends in the pair.
3. **Pair is gated for 60 seconds.** Other apps continue messaging
   normally; only the offending pair is gated.
4. **Authors see typed reason.** Mod authors fix their loop logic.

## What App Messaging Does Not Do

- It does not let unregistered processes send messages.
- It does not allow payloads over 64 KB.
- It does not allow per-app rate to exceed 100/sec.
- It does not let two apps create a fork-bomb loop without a
  breaker.
- It does not let mod messages reach the runtime agent surface
  without an admitted scoped binding.
- It does not replace `RuntimeAuthService` — apps still authenticate
  there.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| `SendAppMessage` / `SubscribeAppMessages` semantics | `RuntimeAppService` (`K-APP-001..002`) |
| `AppMessageEventType` enum | `K-APP-004` |
| Security baseline (auth, size, rate, loop) | `K-APP-005` |
| Scoped binding issuance | `RuntimeAccountService.IssueScopedAppBinding` |
| Mod inter-mod path comparison | `K-APP-006` (Desktop Mod interMod path) |

## Source Basis

- [`.nimi/spec/runtime/kernel/app-messaging-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/app-messaging-contract.md)
- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
