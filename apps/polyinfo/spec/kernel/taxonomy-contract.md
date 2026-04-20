# Taxonomy Contract — PI-TAX-*

> Sector, narrative, core variable, and market-mapping semantics.

## PI-TAX-001: Sector Source in V1

In v1, `Sector` uses Polymarket's upstream classification source.

- v1 sector source is authoritative in `tables/object-model.yaml`
- Polyinfo may keep an app-local overlay above the upstream source
- the app-local overlay may add display metadata or grouping aliases
- the upstream source remains the default import path for sector discovery

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

No proposal becomes canonical app-local taxonomy until a user confirms it.

## PI-TAX-005: Definition Requirement

Every narrative and core variable must have:

- a stable title
- a one-sentence definition
- a creation timestamp
- a confirmation state

Unnamed or undefined taxonomy objects must not be admitted into canonical app-local use.

## PI-TAX-006: Market Mapping Ownership

`TrackedMarket` mappings are app-local analytical decisions.

Polyinfo must support:

- market to narrative mapping
- market to core variable relevance mapping
- user override of agent-suggested mappings

Mappings may be many-to-many, but each market must expose one primary narrative binding when admitted into active signal construction.

## PI-TAX-007: Change History

Narrative and core variable changes must retain edit history.

At minimum, Polyinfo must preserve:

- prior title
- prior definition
- changed timestamp
- changed by user or agent-proposal-confirmation flow

Signals and discussions must remain attributable to the taxonomy version they were constructed against.

## PI-TAX-008: Sector-Local Ownership

Narratives and core variables belong to a single sector.

They must not be global cross-sector objects in v1.

Copying or adapting taxonomy across sectors may be added later, but the current spec keeps sector-local authority explicit.
