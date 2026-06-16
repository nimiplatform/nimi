# Wake And Local Audio Lifecycle Contract

> App: `@nimiplatform/avatar`
> Authority: Avatar kernel contract
> Status: Active owner-boundary authority
> Related contracts:
> - [App shell contract](app-shell-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
> - [Companion participation consumer contract](companion-participation-consumer-contract.md)
> - [Backend branch contract](backend-branch-contract.md)

---

## 1. Scope

This contract defines Avatar-local handling for wake-adjacent and local-audio
lifecycle states. It does not admit wake-word activation in Avatar UI. It
establishes the owner boundary required before a future Runtime-owned wake
phrase lifecycle can be admitted.

Current admitted slice:

- Runtime-owned wake/listening/foreground response projection rendered by Avatar
- visible local audio privacy feedback for every Runtime-projected capture/playback state
- Runtime-owned turn and playback projection rendered by Avatar presentation UI
- backend-local lipsync driven by Runtime-owned audio artifacts
- fail-closed degraded and blocked states

Out of scope until separate Runtime authority admits it:

- wake-word / wake-phrase activation
- background listening
- lock-screen continuation
- hidden hot mic
- Avatar-local wake toggles
- Desktop-local wake parsing

---

## 2. Owner Boundary

| Capability | Runtime owner | Avatar owner | Desktop owner |
|---|---|---|---|
| Wake phrase admission | Owns future lifecycle, consent, model/session gating, event projection, and policy | Must not locally admit or fake wake behavior | Must not parse wake audio or create wake truth |
| Foreground voice / wake listening | Owns wake phrase lifecycle, listener fan-out, accepted turn, transcript, participation, foreground response priority, and turn lifecycle projection | Renders Runtime-projected listening/privacy/playback state and may request foreground response priority; must not start/commit microphone capture locally | May host OS permission prompts and launch handoff only |
| Background listening | Owns future admitted lifecycle if added | Forbidden in this slice | Forbidden as hidden app behavior |
| Audio playback | Owns presentation timing, artifact identity, playback state projection, and interruption truth | Owns local playback pipeline, visual speaker state, lipsync sink, and fail-closed rendering | Does not own playback truth |
| Lipsync | Owns audio artifact and presentation timing; does not own backend mouth parameters | Owns backend-local mouth driver and visible lipsync state | No ownership |
| Interrupt | Owns accepted cancellation semantics and current-turn result | Owns current-anchor interrupt affordance and request emission | May display host state but cannot cancel independently |
| Privacy feedback | Owns policy/state projection for future lifecycle modes | Must visibly render mic/audio/privacy state for every local capture/playback state | Owns OS/window-level permission surfacing only |

Boundary invariants:

1. Avatar must not enter listening from local UI state. Listening requires
   Runtime projection.
2. Avatar must not represent wake as available unless Runtime has admitted and
   projected a wake lifecycle in a future authority batch.
3. Desktop launch context may identify an Avatar instance, agent, and anchor;
   it must not supply raw wake/audio truth to Avatar.
4. Runtime turn projection is the only source for reply/pending/interrupted
   truth. Avatar UI state may be optimistic only for text composer submission
   and must fail closed on Runtime rejection.
5. Every state that uses the microphone or plays agent audio must have a visible
   privacy or activity indicator in the presence capsule.

---

## 3. Lifecycle States

Avatar maps Runtime, local voice capture, audio playback, and lipsync projection
into the following closed visual lifecycle ids.

| State id | Source inputs | Avatar visual obligation | Allowed action |
|---|---|---|---|
| `idle` | ready surface, no active Runtime-projected voice/capture/playback/error | neutral presentation state; no local mic start control | request foreground priority, open composer/settings |
| `foreground_listening` | Runtime projects this avatar/agent as actively listening | active mic/listening indicator, privacy label when a visible voice overlay is admitted | no local commit; Runtime owns capture lifecycle |
| `transcribing` | Runtime projects capture/transcription in progress | busy mic indicator, capture privacy no longer active | wait or fail closed |
| `turn_pending` | transcript/typed turn submitted, Runtime active turn not yet projected | pending indicator | no mic start; allow no fake speaking |
| `assistant_speaking` | Runtime active turn/reply projection or audio playback started/requested | speaker/lipsync indicator, bounded cue/caption when available | interrupt current anchor turn |
| `interrupted` | Runtime terminal interrupted/canceled projection or local interrupt result | interrupted indicator, audio/lipsync silent | clear via next turn or anchor change |
| `muted_or_audio_unavailable` | audio playback failed/canceled/unavailable while surface remains ready | unavailable speaker indicator, no fake lipsync | text may remain based on binding availability |
| `blocked` | foreground voice availability is blocked or binding missing | mic disabled with visible blocked/error state | text/settings only where binding permits |
| `error` | local capture/submit error for current anchor | transient error indicator and bounded error text | retry explicit action |
| `runtime_degraded` | non-ready composition state | degraded surface only; no presence capsule | reload shell if admitted |
| `wake_future_unadmitted` | requested or configured wake behavior without Runtime admission | fail closed as unavailable; no toggle | none |

The ready state and any degraded state remain mutually exclusive per
`app-shell-contract.md`; lifecycle states above are sub-states of the ready
presence capsule unless explicitly marked `runtime_degraded`.

---

## 4. Runtime-Owned Voice Wake

The admitted voice mode is Runtime-owned wake/listening orchestration:

1. Runtime owns microphone listener lifecycle, wake phrase matching, consent,
   fan-out across multiple avatars, foreground respondent selection, transcript,
   accepted turn, and final reply truth.
2. Avatar may request foreground response priority by double-click or context
   menu. This is only an intent signal; it is not a local capture start.
3. Avatar renders Runtime-projected voice/listening/playback/lipsync state when
   Runtime emits it.
4. Avatar must not expose local start-listening, stop-listening, or commit
   capture controls in the default embodied output layer.
5. Text input remains a transient Runtime-bound composer and does not imply
   voice authority.

---

## 5. Future Wake Admission Requirements

A future wake phrase slice must be owned by Runtime before Avatar may expose it.
Minimum Runtime-owned requirements:

- wake lifecycle projection with admitted state ids
- policy/consent and profile/session binding
- wake phrase detector ownership and privacy posture
- visible state projection for armed/listening/matched/blocked/degraded
- explicit stop/disable semantics
- audit/evidence events outside Avatar-local UI truth

Avatar may then render Runtime projection, but must still not own wake parsing,
background microphone capture, consent policy, or lifecycle admission.

---

## 6. Event Binding

Avatar-local evidence for this lifecycle is limited to UI/render facts:

- `avatar.audio.lifecycle.state_changed`
- `avatar.audio.privacy.indicator_changed`
- `avatar.shell.foreground_priority.requested`
- existing `avatar.audio.playback.*`
- existing `avatar.lipsync.*`

Runtime-owned wake lifecycle events are not admitted in Avatar authority and
must not be invented under the `avatar.*` namespace.

---

## 7. Drift Rules

- A wake toggle in Avatar settings is drift until Runtime wake lifecycle
  authority is admitted.
- Any Avatar-local transition into listening without Runtime projection is drift.
- Any Avatar-local start/stop/commit listening control in the default embodied
  output layer is drift.
- Any hidden mic, background continuation, or lock-screen continuation is drift.
- Any local fake transcript/reply/speaking state is drift.
- Any audio/lipsync success claim without Runtime artifact or backend evidence
  is drift.
