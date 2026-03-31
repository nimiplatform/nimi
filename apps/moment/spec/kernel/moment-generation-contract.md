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
- presence
- mystery
- three actions

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
