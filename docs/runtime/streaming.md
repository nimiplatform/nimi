# Streaming

Streaming is not just text arriving gradually. Runtime's streaming
contract defines four typed modes, terminal frames, backpressure,
and fail-closed semantics. Apps treat a stream as an authoritative
event timeline, not as arbitrary chunk soup.

## The Four Streaming Modes

| Mode | What it carries | Close semantics |
| --- | --- | --- |
| Mode A | Text and voice generation; deltas until terminal | Explicit `STREAM_EVENT_COMPLETED` or `STREAM_EVENT_FAILED` event |
| Mode B | State event streams (ScenarioJob events, status updates) | Closes after a terminal status |
| Mode C | Audit export | Closes after an `eof` marker |
| Mode D | Long-lived subscriptions (health, app messaging, realtime events) | Long-lived; closes only on session teardown |

Each mode has explicit close semantics. An app that consumes a
Mode A stream watches for a completed or failed stream event; an app
that consumes a Mode B stream watches for a terminal status. The
stream's mode is declared; apps do not have to guess.

## Terminal Frames

A stream that ends without its admitted terminal signal is a
contract violation. Runtime emits a typed terminal failure rather
than truncating silently.

| Mode | Terminal signal |
| --- | --- |
| Mode A | `STREAM_EVENT_COMPLETED` or `STREAM_EVENT_FAILED` frame |
| Mode B | terminal status event |
| Mode C | `eof` marker |
| Mode D | session teardown |

If a provider mid-stream fails the contract — wrong shape, missing
required field, schema violation — the streaming contract emits a
typed failure terminal frame. The active operation fails closed.
There is no silent truncation.

## Backpressure

Streaming has end-to-end backpressure. The budget is shared from
producer to consumer; a slow consumer applies pressure upstream
rather than dropping frames.

| Property | Value |
| --- | --- |
| Budget | Per-stream |
| Direction | Producer → consumer |
| Spillover | Apps see backpressure via the SDK; runtime does not silently drop |

This matters for long generations. A user stops typing into the
chat window for 30 seconds; the consumer applies pressure; the
producer pauses. Once the consumer resumes, the stream resumes.
No frames are lost.

## Fail-Closed Semantics

Streaming contract failures fail closed:

| Failure type | Behavior |
| --- | --- |
| Wrong frame shape | Typed terminal failure; operation failed |
| Missing required field | Typed terminal failure |
| Schema violation | Typed terminal failure |
| MIME mismatch | Typed terminal failure |
| Transient transport error | Retry per transport policy; if recoverable, stream continues |
| Auth refresh required | Refresh per auth policy; if recoverable, stream continues |

Retry rescues transport-level failure only. It doesn't rescue
contract failure. A schema violation is a contract failure that
fails closed; it does not retry into success.

## Reader Scenario: Mode A Text Streaming

An app issues a text generation that streams.

1. **Stream opens.** Mode A. Runtime begins emitting text chunks.
2. **Chunks arrive.** Each chunk has typed shape. The app
   renders incrementally.
3. **Provider stutters.** A transient transport error. Runtime
   retries per transport policy. The stream resumes from the
   appropriate boundary.
4. **Provider returns content.** The stream continues.
5. **Generation completes.** Runtime emits a
   `STREAM_EVENT_COMPLETED` terminal event.
6. **App marks the response complete.** The user can now
   interact with the next turn.

What did **not** happen: the stream never silently truncated.
Either it reached `STREAM_EVENT_COMPLETED` or it emitted a typed
`STREAM_EVENT_FAILED` failure.

## Reader Scenario: Mode B ScenarioJob Event Stream

An app subscribes to a ScenarioJob event stream.

1. **Stream opens.** Mode B. Runtime begins emitting job events.
2. **Events arrive.** `SUBMITTED → RUNNING → ...`
3. **ScenarioJob reaches a terminal.** Runtime emits `COMPLETED`,
   `FAILED`, `TIMEOUT`, or `CANCELED`.
4. **Stream closes.** The Mode B close semantic is satisfied.

The app's UI updates incrementally as events arrive. There is no
polling; the event stream is the source of truth for "what's
happening with this job."

## Reader Scenario: A Slow Consumer Applies Backpressure

An app is consuming a long Mode A stream. The user opens a heavy
modal that pauses rendering.

1. **Consumer slows.** The app's chunk processing rate drops.
2. **Backpressure applies.** The SDK's stream consumer signals
   backpressure upstream.
3. **Producer pauses.** Runtime pauses provider stream
   consumption per the budget.
4. **User closes modal.** Consumer resumes.
5. **Producer resumes.** Stream continues from the appropriate
   boundary.

No frames are lost. No queue grows unbounded. Backpressure is
end-to-end.

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`config/runtime-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-reason-codes.yaml)
