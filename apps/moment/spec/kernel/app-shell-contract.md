# App Shell Contract - MM-SHELL-*

> Home-screen hierarchy, empty state, stage behavior, and shell posture.

## MM-SHELL-001: Standalone App Shape

Moment is a standalone app with a single front-door home surface.

- shell responsibility: seed intake, threshold stage, short-play continuation, local shelf access
- product responsibility: open one story-bearing threshold quickly
- excluded responsibility: world authoring, mod hosting, canonical write ownership

## MM-SHELL-002: Home Is A Front Door, Not A Dashboard

The home surface must feel like an invitation to enter a moment, not a management console.

The primary reading posture is:

- arrive
- offer one seed
- receive one story-bearing threshold
- step in

## MM-SHELL-003: Single-Protagonist Rule

The generated `MomentThreshold` is the sole protagonist of the home screen.

No other surface may compete with it for primary visual ownership, including:

- sample walls
- shelf cards
- timeline blocks
- explanatory copy
- status summaries

## MM-SHELL-004: Quiet Seed Area

The seed area must be calm, legible, and light.

It exists to help the user approach the story opening, not to explain the whole product.
It must not read like an information panel, settings form, or prompt-engineering surface.
The first version should prefer fewer, stronger controls over many simultaneous visible panels.

## MM-SHELL-005: Stage-First Empty State

The empty state must already feel like a stage before generation occurs.

It must not collapse into:

- documentation layout
- feature checklist layout
- card-wall layout
- admin or dashboard layout

It should prepare the user to believe that a story may already be hiding behind an ordinary scene.

## MM-SHELL-006: Secondary Surfaces Must Sink

`play timeline` and `local library` are mandatory surfaces, but they are secondary by design.

They must remain available without blocking the generate flow, while staying visually below the threshold stage in prominence and narrative ownership.

Visual order must not be mistaken for visual authority: the threshold stage must dominate the first screen even when header and seed controls appear above it in document structure.

## MM-SHELL-007: Equal Seed Legibility

Image input and phrase input are both first-class entrances.

The shell must not visually treat one mode as real and the other as secondary filler.

## MM-SHELL-008: No Internal Product Vocabulary

The user-facing shell must remain self-contained.

It must not require or foreground internal ecosystem terms such as:

- mod
- runtime route
- world-studio
- scene-atlas
- agent-capture
- textplay
- local-chat

Those may exist as implementation or future-integration context only.

## MM-SHELL-009: Samples Are Triggers, Not Heroes

Sample prompts or sample images may exist, but only as lightweight triggers.

They must not become the home screen's main visual subject.

## MM-SHELL-010: Threshold Stage Must Suggest Active Story

The main stage must communicate that something is already happening or about to happen inside the scene.

It must not read as a static aesthetic mood board.

## MM-SHELL-011: Chinese-First Early Shell

User-facing shell copy should follow the active desktop locale when locale handling is available.

When locale handling is missing, ambiguous, or outside the current support scope, the early product defaults to Chinese rather than English.
