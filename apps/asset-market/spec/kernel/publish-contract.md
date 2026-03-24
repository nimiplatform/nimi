# Publish Contract — AM-PUBLISH-*

> Package composition, editing, and publish flow.

## AM-PUBLISH-001: Source of Truth for Package Composition

Publish composes market packages from existing Realm truth.

- Publish does not compose directly from `ScenePack`
- Any Scene-Atlas-origin material must first be admitted into Realm as `Asset` and then organized into `Bundle`
- Publish workbench may create a draft `Bundle`, but package composition still starts from Realm `Bundle` truth rather than raw working-state objects

## AM-PUBLISH-002: Single-Page Workbench

Publish uses a single-page workbench, not a multi-step wizard.

Creators should be able to:

- search assets
- filter assets
- add/remove assets from the current bundle draft
- reorder bundle members
- edit package fields
- publish

within one coherent work surface.

## AM-PUBLISH-003: Basic Asset Search and Filter

Asset and bundle selection inside Publish must support basic search and filtering only.

Current scope excludes advanced query syntax, smart recommendations, or complex batch tooling.

## AM-PUBLISH-004: Package Editing

Creators may freely edit draft bundles and packages, including:

- add assets to bundle membership
- remove assets from bundle membership
- reorder bundle membership
- change bundle cover
- update package fields

Removing all assets invalidates readiness and may eventually delete the empty draft per `AM-PKG-009`.

## AM-PUBLISH-005: Publish Preconditions

Creators may publish only when both:

- the underlying `Bundle` satisfies bundle readiness requirements
- the market `Package` satisfies package readiness requirements
- the referenced `Bundle` will enter or remain in `published` status

from `tables/package-model.yaml`.

`isReady` and `readinessIssues[]` govern the publish affordance.

## AM-PUBLISH-006: Republish Semantics

Editing a published package does not immediately change the market-visible package.

Creators must publish again to update the current market-visible version.

## AM-PUBLISH-007: Package Size Floor

A bundle may contain only a single asset.

The current market does not require multi-asset minimums.
