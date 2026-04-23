# Taxonomy Contract — PI-TAX-*

> Sector, narrative, core variable, and custom-sector import semantics.

## PI-TAX-001: Sector Types in V1

In the current app, `Sector` admits two source types:

- official sectors sourced from Polymarket's front-end category structure
- custom sectors created locally inside Polyinfo

Official sectors remain the default discovery path, but custom sectors are first-class workspaces rather than temporary views.

## PI-TAX-002: Narrative Definition

`Narrative` is a sector-local market clustering object.

It exists to answer:

- which markets are expressing the same class of situation
- which markets should be interpreted together before higher-order signal construction

Narrative is not a news storyline and not a final analytical conclusion.

## PI-TAX-003: Core Variable Definition

`CoreVariable` is a sector-local analytical question or axis.

It exists to answer:

- which higher-order question the user wants to track
- whether the market complex is strengthening, weakening, or splitting around that question

Core variables may read across multiple narratives.

## PI-TAX-004: Proposal and Confirmation Flow

Narratives and core variables may originate from:

- direct user creation
- agent proposal during discussion
- imported template suggestions in future versions

Agent proposals do not become canonical app-local taxonomy until a user confirms them. Direct form-based creation inside the workspace is treated as already user-confirmed input.

## PI-TAX-005: Definition Requirement

Every narrative and core variable must have:

- a stable title
- a one-sentence definition
- a confirmation state

Unnamed or undefined taxonomy objects must not be admitted into canonical app-local use.

## PI-TAX-006: Custom-Sector Imported Event Ownership

Imported events inside a custom sector are app-local cache records rather than new canonical upstream truth.

Polyinfo must support:

- Polymarket URL import into a custom sector
- local caching of the imported event's title, options, and source metadata
- refresh of upstream validity when the custom sector is opened
- stale visibility and manual deletion when the upstream event is closed, missing, or invalid

Imported events provide evidence for analysis, but Polyinfo must not persist event-to-narrative or event-to-core-variable mappings as canonical taxonomy.

## PI-TAX-007: Change History

The current app does not retain embedded edit-history versions on narrative or core-variable records.

Current behavior is:

- updates overwrite the current record in place
- deactivation removes the current record from the active overlay
- historical context survives only indirectly through saved chat messages and lightweight snapshots

Polyinfo therefore preserves current taxonomy state, but not full version history, in the present app.

## PI-TAX-008: Sector-Local Ownership

Narratives and core variables belong to a single sector.

They must not be global cross-sector objects in the current app.

Copying or adapting taxonomy across sectors may be added later, but the current spec keeps sector-local authority explicit.
