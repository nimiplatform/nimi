# Discovery Contract — AM-DISCOVER-*

> Discover home, search, category browsing, package cards, and package detail.

## AM-DISCOVER-001: Discover Is Primary

Discover is the primary home surface of Asset Market.

- creators arrive here first
- discover serves package finding, not account management
- market browsing is package-first

## AM-DISCOVER-002: Category Model

Primary category browsing is creator-purpose-first, not media-file-first.

Current primary categories are authoritative in `tables/package-model.yaml`.

Media type remains a secondary filter only.

## AM-DISCOVER-003: Search Scope

Search covers:

- package title
- package tags
- package description
- creator

Search result ranking uses relevance first, then published recency.

## AM-DISCOVER-004: Home Views

Discover home exposes:

- `New`
- `Popular`

`Popular` is a valid market view, but its scoring algorithm is intentionally unspecified in the current spec.

## AM-DISCOVER-005: Package Card Minimum Surface

Discover cards must minimally expose:

- cover
- title
- category
- price
- creator
- a small tag subset

Cards should optimize scanability over full metadata density.

## AM-DISCOVER-006: Package Detail Surface

Package detail must expose:

- cover
- title
- description
- creator
- version
- bundle member count summary
- ordered package contents
- a clear import action for Forge

Current detail behavior does not require a separate listing object.

## AM-DISCOVER-007: Creator Navigation

Discover and detail surfaces must support navigation into a creator-scoped package list.

The first requirement is package browsing by creator, not a full creator-profile system.
