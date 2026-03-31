# Moment Spec

> Scope: one image or one phrase -> one story-opening moment -> 2 to 4 short continuation beats -> app-local shelf
> Normative Imports: `spec/platform/kernel/architecture-contract.md`, `spec/platform/kernel/kit-contract.md`, `nimi-realm/spec/realm/kernel/truth-contract.md`, `nimi-realm/spec/realm/kernel/world-state-contract.md`, `nimi-realm/spec/realm/kernel/world-history-contract.md`

## 0. Document Positioning

Moment is a standalone app under `apps/moment/`.

It is not:

- a mod browser
- a world editor
- a writing assistant
- a chat client with a prettier landing page
- a thin wrapper around `textplay`, `world-studio`, `scene-atlas`, or `agent-capture`

Moment is the front door to Nimi.

Its job is not to explain the system.
Its job is to make the user feel that a story has just started to open somewhere inside an ordinary scene.

## 1. Product Positioning

Moment is an ultra-light entry product.

The user offers exactly one lightweight seed:

- one image, or
- one phrase

Moment returns one story opening, structured as one threshold:

- a title
- a charged opening
- a presence
- a mystery
- three ways in

The product does not sell a full story or a fully authored world.
It sells the first caught moment where a scene starts to reveal that a story is already happening inside it.

## 1A. Term Alignment

This spec uses three related terms on purpose:

- `story opening`: the user-facing product idea; the first opening into the hidden story inside a scene
- `MomentThreshold`: the compact app-owned object that carries that story opening in structured form
- `relation state`: the short-loop session variable that tracks how the story currently relates to the user

The product should feel like a story opening.
The implementation may store that opening as a threshold object.
Those are not competing concepts.

## 2. Core Promise

`Give me a picture or a line. I will find the moment where its story starts to open.`

## 3. Experience Thesis

Moment should feel:

- restrained
- human-scale
- quietly charged
- cinematic
- immediate
- capable of tenderness, wistfulness, or mystery when the scene earns it

Moment must avoid feeling like:

- a document page
- an AI report
- a prompt lab
- a creator workbench
- a schema demo

The home screen must behave like a film opening, not a dashboard.
The first version should default to Chinese in user-facing shell copy and generated output when locale handling is absent, unknown, or undecided.

## 4. Core Product Unit

The core unit is a `MomentThreshold`.

A `MomentThreshold` is not a lore dump and not a complete narrative arc.
It is the first visible slice of a larger story.

It must make the user feel two things at once:

- something is already happening here
- I can look into it, step into it, or be pulled into it from some angle

This is why the product is called `Moment`.
It does not promise the whole story.
It promises the one charged moment where the story becomes visible and starts to open.

The user's position inside that moment is not fixed in advance.
The story may let the user remain outside it, notice them slowly, address them suddenly, or pull them inward over a few beats.

## 5. Input Posture

The first version accepts only:

- one image
- one phrase

The first version does not accept:

- long text passages
- documents
- multiple images
- audio
- video
- world packages

Front-door products win by being light.
Moment must stay light.

## 6. Primary Experience Flow

1. The user lands on a calm but charged home screen.
2. The user gives one image or one phrase.
3. Moment interprets the scene as if there may already be a story taking place inside it.
4. Moment produces one dominant threshold on the main stage, showing not only atmosphere but also a concrete story-facing opening.
5. The user chooses how to approach that opening, either by acting or by holding back and observing.
6. Moment continues for 2 to 4 beats while updating how the story relates to the user.
7. The story may keep the user outside it, may begin to notice them, or may draw them inward if that is the most compelling development.
8. Once the moment feels complete enough to keep, Moment should encourage it to stop there rather than inflate into generic long chat.
9. The user may let the moment stop there, or start a new one.

## 7. Home-Screen Principle

The home screen has exactly one protagonist:

- the story-bearing moment itself

This means:

- the seed area is quiet and supportive
- the empty state still feels like a stage, not a help page
- the generated threshold owns the visual center of gravity
- shelf, timeline, sample triggers, and explanatory copy stay subordinate

If another surface becomes more visually important than the threshold, the page has failed the product.

The threshold must not read like a static flavor card.
It must read like the instant when a hidden story becomes briefly visible.
It must also preserve the feeling that the user's relationship to that story can still change.
It must also preserve the feeling that the moment can stop at the right place without being over-explained.

## 8. Cross-Repo Boundaries

Moment is an app-layer experience product.

It owns:

- app-local threshold objects
- app-local short-play session state
- app-local saved shelf state

It does not own:

- Realm truth
- Realm world state
- Realm canonical world history
- mod runtime contracts
- world-authoring control-plane semantics

Moment output is private application output by default.
It must not be described as canonical world truth, canonical world history, or durable shared world state unless a later explicit downstream write contract is added.

## 9. Relationship to Neighboring Products

Moment may later connect to nearby products, but it must remain its own product:

- `scene-atlas` may become an upstream scene-seed supplier
- `agent-capture` may become an upstream character-seed supplier
- `textplay` or `local-chat` may become an optional deeper continuation layer
- `world-studio` may become an explicit downstream creator handoff surface for high-value thresholds

None of those system names should be required to understand Moment's primary UX.
The user should only feel:

`I found a scene that felt like it had a story inside it, and Moment opened the first way for me to look in.`

## 10. Non-Goals

- no creator dashboard posture
- no mod vocabulary in the core experience
- no hidden requirement to understand worlds, agents, routes, or models before using the app
- no automatic promotion of app output into Realm canonical data
- no collapse into a generic AI chat product after the first beat
- no purely decorative mystery card that never clarifies what kind of story may be unfolding
- no fixed pre-play role picker that asks the user to choose "observer" or "participant" before the story has earned that distinction
- no English-first shell posture in the early product if locale handling is not yet complete
