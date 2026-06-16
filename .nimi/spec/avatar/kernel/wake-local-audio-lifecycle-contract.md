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

- foreground user-started voice capture only
- visible local audio privacy feedback for every capture/playback state
- Runtime-owned turn and playback projection rendered by Avatar presence UI
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
| Foreground voice capture | Owns accepted turn, transcript, participation, and turn lifecycle projection | Owns explicit foreground mic control, capture UI state, visible privacy feedback, and typed SDK calls | May host OS permission prompts and launch handoff only |
| Background listening | Owns future admitted lifecycle if added | Forbidden in this slice | Forbidden as hidden app behavior |
| Audio playback | Owns presentation timing, artifact identity, playback state projection, and interruption truth | Owns local playback pipeline, visual speaker state, lipsync sink, and fail-closed rendering | Does not own playback truth |
| Lipsync | Owns audio artifact and presentation timing; does not own backend mouth parameters | Owns backend-local mouth driver and visible lipsync state | No ownership |
| Interrupt | Owns accepted cancellation semantics and current-turn result | Owns current-anchor interrupt affordance and request emission | May display host state but cannot cancel independently |
| Privacy feedback | Owns policy/state projection for future lifecycle modes | Must visibly render mic/audio/privacy state for every local capture/playback state | Owns OS/window-level permission surfacing only |

Boundary invariants:

1. Avatar must not enter listening without an explicit user action in the
   foreground Avatar surface.
2. Avatar must not represent wake as available unless Runtime has admitted and
   projected a wake lifecycle in a future authority batch.
3. Desktop launch context may identify an Avatar instance, agent, and anchor;
   it must not supply raw wake/audio truth to Avatar.
4. Runtime turn projection is the only source for reply/pending/interrupted
   truth. Avatar UI state may be optimistic only for local capture/composer
   initiation and must fail closed on Runtime rejection.
5. Every state that uses the microphone or plays agent audio must have a visible
   privacy or activity indicator in the presence capsule.

---

## 3. Lifecycle States

Avatar maps Runtime, local voice capture, audio playback, and lipsync projection
into the following closed visual lifecycle ids.

| State id | Source inputs | Avatar visual obligation | Allowed action |
|---|---|---|---|
| `idle` | ready surface, no active voice/capture/playback/error | neutral presence capsule, mic available if foreground capture is available | start foreground listening, open composer/settings |
| `foreground_listening` | user clicked mic and capture session is active | active mic indicator, voice level meter, privacy label | commit capture by explicit mic click |
| `transcribing` | foreground capture committed, SDK submit in progress | busy mic indicator, capture privacy no longer active | no mic start; wait or fail closed |
| `turn_pending` | transcript/typed turn submitted, Runtime active turn not yet projected | pending indicator | no mic start; allow no fake speaking |
| `assistant_speaking` | Runtime active turn/reply projection or audio playback started/requested | speaker/lipsync indicator, bounded cue/caption when available | interrupt current anchor turn |
| `interrupted` | Runtime terminal interrupted/canceled projection or local interrupt result | interrupted indicator, audio/lipsync silent | clear via next turn or anchor change |
| `muted_or_audio_unavailable` | audio playback failed/canceled/unavailable while surface remains ready | unavailable speaker indicator, no fake lipsync | text/foreground capture may remain based on availability |
| `blocked` | foreground voice availability is blocked or binding missing | mic disabled with visible blocked/error state | text/settings only where binding permits |
| `error` | local capture/submit error for current anchor | transient error indicator and bounded error text | retry explicit action |
| `runtime_degraded` | non-ready composition state | degraded surface only; no presence capsule | reload shell if admitted |
| `wake_future_unadmitted` | requested or configured wake behavior without Runtime admission | fail closed as unavailable; no toggle | none |

The ready state and any degraded state remain mutually exclusive per
`app-shell-contract.md`; lifecycle states above are sub-states of the ready
presence capsule unless explicitly marked `runtime_degraded`.

---

## 4. Foreground Hands-Free Voice

The admitted voice mode is foreground hands-free after explicit activation:

1. User clicks the presence capsule mic.
2. Avatar starts a foreground capture session through the existing Runtime/SDK
   handle for the current `agent_id + conversation_anchor_id`.
3. The mic remains visibly active until the user clicks again to commit.
4. Avatar submits the captured audio through the existing voice capture turn
   path.
5. Runtime owns transcript, participation, active turn, and final reply truth.

This is not wake-word support. It is a foreground session with a visible active
mic indicator and an explicit user commit.

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
- existing `avatar.companion.voice.*`
- existing `avatar.audio.playback.*`
- existing `avatar.lipsync.*`

Runtime-owned wake lifecycle events are not admitted in Avatar authority and
must not be invented under the `avatar.*` namespace.

---

## 7. Drift Rules

- A wake toggle in Avatar settings is drift until Runtime wake lifecycle
  authority is admitted.
- Any automatic transition into listening without a user action is drift.
- Any hidden mic, background continuation, or lock-screen continuation is drift.
- Any local fake transcript/reply/speaking state is drift.
- Any audio/lipsync success claim without Runtime artifact or backend evidence
  is drift.
