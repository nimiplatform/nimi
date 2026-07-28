# App Messaging

> Status: Running today. `RuntimeAppService.SendAppMessage` and
> `SubscribeAppMessages` are the shipped runtime-mediated cross-app
> messaging primitive (`K-APP-001..K-APP-013+`).

Cross-app coordination on Nimi goes through **runtime-mediated app
messaging**. Apps do not poke each other directly — they emit typed
messages and subscribe to typed events through `RuntimeAppService`,
which authenticates senders, enforces rate limits, detects loops,
and revalidates the current session and exact operation when a
protected local app uses an agent surface.

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

Returns `message_id` (ULID), `accepted`, `reason_code`.

Runtime derives the current account and App identity from the
authenticated connection. A protected local app carries no token,
binding, or caller-minted proof: the verified local-app host injects
its process-bound session, and Runtime authorizes the exact operation
again at the operation owner. Request ids remain correlation and
routing data; they do not create authority.

## SubscribeAppMessages

| Field | Required | Notes |
| --- | --- | --- |
| `app_id` | yes | Subscriber app id |
| `subject_user_id` | no | Filter to a specific user |
| `cursor` | no | Resume cursor |
| `from_app_ids` | no | Filter by senders (repeated) |
| `local_agent_ref` | local app agent subscription only | Resource selector revalidated by Runtime; never an authorization proof |
| `conversation_anchor_id` | local app agent subscription only | Resource selector revalidated by Runtime; never an authorization proof |

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
| App authentication | Ordinary callers use their admitted authenticated session. A protected local app uses only the host-injected process-bound session and an exact per-operation decision. Runtime derives or verifies `from_app_id`; unauthenticated requests fail closed | Prevents arbitrary processes from spoofing a registered app |
| Payload size limit | `payload` Struct serialized must not exceed **64 KB**. Over: `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | Prevents one message from exhausting runtime memory |
| Send rate limit | Per `from_app_id`: **100 msgs/sec** sliding window. Over: `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | Prevents storms / DoS |
| Loop detection | Same `(from_app_id, to_app_id)` pair > **20 messages bidirectional within 1 second** auto-circuit-breaks the pair for **60 seconds** with `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`. Both apps may continue to talk to others during the breaker | Prevents fork-bomb between two apps |

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
| Agent-surface authorization | App-side trust assumption | Current session and exact operation are revalidated by Runtime |
| Cross-app coordination semantics | Ad-hoc | Typed event stream |

The runtime is the coordination substrate. Apps don't reinvent it.

## Reader Scenario: An App Sends A Typed Message To Another App

A notes app wants to ask a calendar app for the user's free time.

1. **App registered + authenticated.** `RuntimeAuthService` knows
   about the notes app; the current session has a valid token.
2. **`SendAppMessage`.** notes app calls with
   `from_app_id: notes`, `to_app_id: calendar`,
   `message_type: 'free-time-query'`,
   `payload: { date: '...' }`.
3. **Runtime authenticates sender.** Verifies `from_app_id`.
4. **Runtime checks size + rate.** Within limits.
5. **Runtime delivers.** Calendar app's
   `SubscribeAppMessages` stream emits `RECEIVED`.
6. **Calendar processes.** Sends back a response via its own
   `SendAppMessage`.
7. **Notes receives.** Through its own subscription stream.

Both apps participate through `RuntimeAppService`. Neither tries to
reach behind the runtime.

## Reader Scenario: An App Messages The Agent Surface

An app wants to send a typed message to the user's agent.

1. **The app has a current admitted session.** For a protected local
   app, Desktop prepared the launch lease, Runtime bound the exact
   process, and the verified host opened the process-bound session.
2. **Runtime authorizes the exact operation.** The operation owner
   revalidates the current account, App identity, session, permission,
   and relevant LocalAgent/conversation selectors.
3. **`SendAppMessage`.** The app sends an admitted K-APP-008 family
   to `runtime.agent`; Runtime derives the sender identity rather than
   trusting a caller-supplied id.
4. **Delivery.** The message reaches the agent surface only under
   that current per-operation decision.

An expired or replaced session, revoked permission, mismatched
process, or invalid selector rejects the request. No portable proof
can restore authority.

## Reader Scenario: A Loop Trips The Breaker

Two apps accidentally enter a chatter loop sending each other rapid
messages.

1. **Send rate climbs.** Within one second, the
   `(app-a, app-b)` pair exchanges > 20 messages bidirectional.
2. **Breaker trips.** Runtime emits `APP_MESSAGE_LOOP_DETECTED` for
   subsequent sends in the pair.
3. **Pair is gated for 60 seconds.** Other apps continue messaging
   normally; only the offending pair is gated.
4. **Authors see typed reason.** App authors fix their loop logic.

## What App Messaging Does Not Do

- It does not let unregistered processes send messages.
- It does not allow payloads over 64 KB.
- It does not allow per-app rate to exceed 100/sec.
- It does not let two apps create a fork-bomb loop without a
  breaker.
- It does not let caller-supplied ids or a portable proof authorize
  access to the runtime agent surface.
- It does not replace `RuntimeAuthService` — apps still authenticate
  there.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| `SendAppMessage` / `SubscribeAppMessages` semantics | `RuntimeAppService` (`K-APP-001..002`) |
| `AppMessageEventType` enum | `K-APP-004` |
| Security baseline (auth, size, rate, loop) | `K-APP-005` |
| Protected local-app session and per-operation authorization | `RuntimeAuthService` plus the Runtime operation owner |
| App-to-app path comparison | `K-APP-006` |

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
