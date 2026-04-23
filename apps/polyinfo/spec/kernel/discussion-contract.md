# Discussion Contract — PI-DISCUSS-*

> Sector analyst sessions, proposal workflow, and disagreement semantics.

## PI-DISCUSS-001: Sector Analyst Session

Every sector owns a first-class analyst session surface.

- opening a sector must allow immediate analyst conversation
- a new sector chat starts with that sector's active narratives and core variables already loaded
- the analyst agent is sector-bound rather than generic across the entire app
- route selection for that analyst chat must come from the app-level runtime config surface, not sector-local settings

## PI-DISCUSS-002: Discussion Scope

Polyinfo supports user-agent discussion about:

- sector interpretation
- narrative proposals
- core variable proposals
- signal interpretation

Discussion is app-local and does not redefine Realm chat authority.

Polyinfo discussion is an AI analyst subset of the desktop chat pattern:

- only the sector analyst mode is admitted
- human / group / generic agent chat modes are out of scope for Polyinfo
- runtime-backed route selection still follows the same config ownership pattern as desktop

## PI-DISCUSS-003: Evidence Boundary

The sector analyst agent may reason from:

- upstream market facts already ingested by Polyinfo
- app-local taxonomy
- app-local signal snapshots
- app-local discussion history

The sector analyst agent must not rely on news, social commentary, or hidden external facts as canonical evidence.

## PI-DISCUSS-004: Proposal Semantics

The agent may propose:

- new narratives
- new core variables
- revised narrative definitions
- revised core-variable definitions
- retirement of narratives or core variables

These remain proposals until user confirmation.

## PI-DISCUSS-005: Chat-Native Structure Editing

Narrative and core-variable maintenance must be admitted inside the analyst session itself.

The user may ask the agent to:

- create a new narrative
- revise a narrative definition
- retire a narrative
- create a new core variable
- revise a core-variable definition
- retire a core variable

The product may render these changes as reviewable structured actions before confirmation.

## PI-DISCUSS-006: Disagreement Handling

The product must support explicit disagreement.

When a user disputes a signal or proposal, the discussion flow should return to:

- included markets
- chosen window
- weighting effects
- taxonomy assumptions

The agent must not answer disagreement by introducing outside news or authority shortcuts.

## PI-DISCUSS-007: Manual Confirmation Is Final

User confirmation is the only authority that admits:

- new narratives
- new core variables
- revised narrative definitions
- revised core-variable definitions
- retired narrative or core-variable state

Agent confidence language must not masquerade as confirmation.

## PI-DISCUSS-008: Discussion and Analysis Relationship

Discussion and analysis are connected but not identical.

- the analyst agent may generate the current analytical conclusion
- discussion turns may trigger a fresh analysis run using the latest structured input package
- free-form chat text alone must not mutate canonical signal state without an explicit analysis run or explicit user confirmation action

## PI-DISCUSS-009: Thread Binding

Discussion threads must bind to a concrete context:

- sector
- optional narrative
- optional core variable
- optional signal snapshot

Free-floating discussion without analytical context is out of scope for v1.
