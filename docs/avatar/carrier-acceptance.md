# Carrier Visual Acceptance

A **carrier** is the host surface that renders an embodiment. The
carrier visual acceptance contract decides whether a given
embodiment can be displayed on a given carrier. It is the
admission gate for "this agent can be shown here."

## What Carrier Acceptance Decides

| Decision | Result |
| --- | --- |
| Embodiment fits the carrier's typed contract | Admit and render |
| Embodiment exceeds the carrier's contract | Refuse or fall back to admitted projection |
| Embodiment is malformed | Refuse with typed error |
| Embodiment would violate carrier policy | Refuse with typed reason |

The carrier does **not** silently render a half-version. The
contract decides; the result is one of admit, fallback, or
refuse.

## Why The Carrier Decides

If embodiments could render anywhere they wanted, a high-detail
package designed for a desktop carrier might overrun a constrained
mobile carrier. A package designed for one backend might attempt
to render on a different backend.

The carrier visual acceptance contract is what each carrier
declares about what it can host. Embodiments either fit or do
not fit; the platform makes the decision typed.

## Reader Scenario: A Heavy Embodiment On A Constrained Carrier

A user installs a richly-animated embodiment package and tries to
view it on a constrained carrier (e.g., low-power device).

1. **Carrier declares its contract.** What backend, what motion
   complexity tier, what asset size limits.
2. **Embodiment package is read.** Embodiment package's
   declared requirements.
3. **Acceptance check.** Carrier visual acceptance contract
   compares.
4. **Decision: fall back.** The full embodiment would exceed
   the carrier's tier; the contract decides to fall back to an
   admitted projection (e.g., a static or simplified
   presentation).
5. **User sees fallback.** With a typed reason — "your device
   does not support this embodiment's full motion tier."

The fallback is admitted; the user is not surprised by silent
half-rendering.

## Reader Scenario: A Carrier Refuses A Backend Mismatch

An embodiment is Live2D-only; carrier is VRM-only.

1. **Acceptance check.** Live2D embodiment vs VRM-only carrier.
2. **Reject.** Backend mismatch; not admitted.
3. **Typed error.** "This carrier does not support Live2D
   backend."
4. **No partial render.** The carrier does not attempt to
   project Live2D into VRM space.

The discriminated union of backends makes mismatches detectable
before any rendering attempt.

## Reader Scenario: An Embodiment Is Updated Mid-Session

A creator updates the embodiment package while a user is viewing
the agent.

1. **New embodiment delivered.** Possibly through admitted
   update flow.
2. **Carrier re-evaluates.** Acceptance contract checks the new
   version.
3. **If admitted.** Carrier transitions smoothly (within
   admitted transition contract).
4. **If not admitted.** Carrier holds the previous version; or
   moves to `degraded:embodiment-incompatible` state.
5. **User sees state.** Either the new embodiment or a typed
   degraded state.

A creator's update does not silently break a user's session.

## What Acceptance Does Not Do

| Concern | Why not |
| --- | --- |
| Determine the agent's identity | Identity is canonical Realm; carrier accepts visual |
| Mutate embodiment package | Carrier reads; package is creator-published |
| Render outside its admitted tier | The contract limits are explicit |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
