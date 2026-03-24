# Publish Contract — AM-PUBLISH-*

> Package composition, editing, and publish flow.

## AM-PUBLISH-001: Source of Truth for Package Composition

Publish composes packages only from existing Realm assets.

- Publish does not compose directly from `ScenePack`
- Any Scene-Atlas-origin material must first be admitted into Realm as assets
- Package composition starts from already admitted assets

## AM-PUBLISH-002: Single-Page Workbench

Publish uses a single-page workbench, not a multi-step wizard.

Creators should be able to:

- search assets
- filter assets
- add/remove assets
- reorder assets
- edit package fields
- publish

within one coherent work surface.

## AM-PUBLISH-003: Basic Asset Search and Filter

Asset selection inside Publish must support basic search and filtering only.

Current scope excludes advanced query syntax, smart recommendations, or complex batch tooling.

## AM-PUBLISH-004: Package Editing

Creators may freely edit draft packages, including:

- add assets
- remove assets
- reorder assets
- change cover
- update package fields

Removing all assets invalidates readiness and may eventually delete the empty draft per `AM-PKG-009`.

## AM-PUBLISH-005: Publish Preconditions

Creators may publish only when the package satisfies readiness requirements from `tables/package-model.yaml`.

`isReady` and `readinessIssues[]` govern the publish affordance.

## AM-PUBLISH-006: Republish Semantics

Editing a published package does not immediately change the market-visible package.

Creators must publish again to update the current market-visible version.

## AM-PUBLISH-007: Package Size Floor

A package may contain only a single asset.

The current market does not require multi-asset minimums.
