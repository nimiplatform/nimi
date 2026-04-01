# Moment Generation Contract - MM-GEN-*

> Story-opening generation behavior and output posture.

## MM-GEN-001: Story-Bearing Opening, Not Summary

Generation must return a playable story opening.

It must not degrade into:

- captioning
- visual description only
- lore summary
- writing-tool analysis
- atmosphere with no implied story motion

## MM-GEN-002: Required Threshold Shape

Every generated story opening must include the required fields defined in `tables/moment-model.yaml`.

At minimum, the story opening must present:

- title
- opening
- three actions

The opening itself must carry the story doorway in natural language.
The core product shape must not depend on rigid labeled sub-slots such as separate "presence" and "mystery" blocks in the primary UX.

## MM-GEN-013: Imaginative Pull With Enough Shape

Before stylistic flourish, generation must create imaginative pull.

At minimum, the generated opening must let the user feel:

- that a possible story has become faintly visible
- that something human may already be underway here
- that there is some angle from which the user could drift closer

These may remain quiet, subtle, or emotionally restrained.
They must still give the imagination enough concrete shape to hold onto.
They must not disappear into pure mood writing, disconnected poetic imagery, or opaque stream-of-consciousness.

## MM-GEN-014: Natural-Language Entrance, Not Hidden Template

Moment may internally reason about scene carrier, unresolved situation, emotional lane, or entry stance, but the primary opening must read as natural language rather than a filled template.

The product should avoid openings that feel like:

- a list of labeled slots
- a writer's worksheet
- a decomposed atmosphere card
- separate mini-ideas that never fuse into one lived moment

Good openings may still be lyrical.
They must remain graspable as one coherent human situation.

## MM-GEN-015: Leave Space Without Losing Readability

Moment should leave room for wonder, aftertaste, and user imagination.

It should not:

- explain the whole story too early
- resolve the scene into a hard answer
- flatten the moment into synopsis

It also should not:

- become so impressionistic that the user cannot tell what kind of possible story is being glimpsed
- replace human situation with free-floating atmosphere

## MM-GEN-003: Scene Must Suggest An Unfolding Story

Generation must infer a plausible sense that something may already be happening inside the scene.

The opening does not need to reveal the full story, but it must imply:

- an event
- a tension
- a relationship
- or a quiet change the user can move toward

## MM-GEN-004: User Entry Stance Is Part Of Generation

Generation must make the user's initial relation to the unfolding story legible at this moment.

Valid stance patterns include, but are not limited to:

- the user is directly addressed
- the user is being drawn in
- the user is a witness
- the user is an intruder
- the user has a prior but incomplete relation to the place

The product need not expose these as explicit labels, but the opening and actions must make the stance legible.

This stance is an initial condition, not a permanently fixed mode.
Later beats may preserve it or evolve it.

## MM-GEN-005: Image Input Uses Structural Signals

Image-led generation must respond to structural visual cues rather than random theme assignment alone.

Valid inputs include, but are not limited to:

- mood
- light
- color temperature
- composition
- filename hints
- implied tension

## MM-GEN-006: Phrase Input May Lean More Literary

Phrase-led generation may use stronger literary shaping than image-led generation.

Even so, it must still produce a playable story opening rather than a decorative paragraph.

## MM-GEN-007: Threshold Voice

Generated copy must preserve the product's tonal target:

- restrained
- human-scale
- inviting
- capable of warmth, tenderness, wistfulness, romance, or mystery

Danger, uncanniness, or rupture are valid only when the scene itself strongly supports them.

## MM-GEN-008: No Analysis Voice

Generated output must not sound like:

- model commentary
- pipeline commentary
- schema commentary
- prompt commentary
- generic suspense filler

## MM-GEN-011: Natural Scene Tendency Comes First

Generation must begin from the scene's most plausible emotional and human tendency.

Ordinary scenes should default toward:

- everyday life
- small intimacy
- warmth
- wistfulness
- romance
- nostalgia
- quiet change

before escalating toward:

- threat
- horror
- occult logic
- violence
- danger-heavy twists

unless the source scene clearly earns that escalation.

## MM-GEN-012: Ordinary Detail Is Often Enough

Generation must not assume that a scene becomes compelling only after it receives invented clue objects or dramatic plot devices.

When the scene already supports a moving opening through:

- waiting
- nearness
- absence
- leftover warmth
- a repeated habit
- a missed meeting
- a small human trace

that ordinary material should be preferred over decorative symbols or over-designed twists.

## MM-GEN-009: Fast Front-Door Response

Moment is a front-door product.

The first story opening must arrive quickly enough to feel immediate.
The shell and generation path must optimize for fast opening over heavy setup.

## MM-GEN-010: Chinese Default For Early Output

Generated opening copy should follow the active desktop locale when locale handling is available.

When locale handling is missing, ambiguous, or outside the currently supported scope, generated copy defaults to Chinese.
