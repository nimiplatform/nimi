# SDK World Contract

> Owner Domain: `S-WORLD-*`

## Scope

This contract defines the SDK kernel authority home for the app-facing
`sdk/world` facade.
It owns the public world-domain family boundary, the world-input projection
boundary, the fixture package boundary, the renderer orchestration boundary,
and the world-session composition boundary.
It does not redefine Realm canonical truth semantics, Runtime provider
execution semantics, renderer-driver implementation semantics, or branch-local
simulation semantics.

## S-WORLD-001 Public Facade Ownership Boundary

`sdk/world` is the SDK kernel authority home for the app-facing world-domain
facade.

It owns only:

- the public world-domain family boundary
- the world-input projection boundary
- the fixture package boundary
- the renderer orchestration vs driver boundary
- the world-session composition boundary

It does not own:

- Realm canonical truth semantics
- Runtime provider execution semantics
- renderer-driver implementation semantics
- branch-local simulation semantics

## S-WORLD-002 First-Wave Family Set

The first-wave `sdk/world` family set is fixed to:

- `truth`
- `generate`
- `fixture`
- `render`
- `session`

All five families are admitted in coarse-grained form.

## S-WORLD-003 World-Input Projection Boundary

Provider-bound world-generation requests must pass through a world-domain
truth-to-world-input projection layer before final provider request shaping.

`sdk/world` must not expose provider-native payloads as the first public input
shape.

## S-WORLD-004 Fixture Package Boundary

Local materialized world output is represented publicly as a fixture package
rather than as raw provider payload.

Current-phase conversion semantics remain intentionally shallow and may remain
identity/pass-through where needed.

## S-WORLD-005 Renderer Orchestration Boundary

`sdk/world.render` owns renderer orchestration consume only.

It may expose:

- render plan
- initial coordinate or camera policy
- capability requirements
- fallback guidance

It must not expose:

- renderer-driver lifecycle
- window or canvas ownership
- GPU or runtime handles
- renderer-native config blobs as stable public truth

## S-WORLD-006 World Session Composition Boundary

`sdk/world.session` owns world-session composition semantics for the active
world experience.

It may compose:

- activity mode
- chat context
- agent context
- local session status

It does not transfer ownership of chat, agent, cognition, or renderer truth
into the world-domain facade.

## S-WORLD-007 First-Wave Exclusions

The first `sdk/world` cut excludes:

- shared multi-user projection truth
- world simulation semantics
- provider-native request authoring
- renderer-driver APIs
- direct Realm mutation surfaces beyond existing authority homes
- cognition or Forge ownership
