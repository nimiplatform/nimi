# API Contract — AM-API-*

> Backend API surface inventory rules for Asset Market package-market flows.

## AM-API-001: API Surface Table Authority

`tables/api-surface.yaml` is the authoritative inventory for new Asset Market package-market backend API proposals.

Contract prose may explain API posture, but route/method/controller inventory must live in the table.

## AM-API-002: Package-Market Scope

Asset Market API proposals operate on admitted Asset Market objects and projections.

They must not create a second Realm asset/bundle truth model, an Avatar-local package model, or a Desktop/Agent Center package authority.

## AM-API-003: Package Kind Awareness

Any API proposal that filters, creates, publishes, acquires, imports, or diagnoses package-kind-specific behavior must reference `Package.package_kind` from `tables/package-model.yaml`.

`Package.category` remains discovery classification and must not be used as the technical discriminator for package-kind behavior.

## AM-API-004: Future Kind Fail-Closed Rule

API rows must not accept reserved future `package_kind` values as active until an admitted Asset Market topic promotes those values and defines readiness, publish, acquisition/import, and diagnostics behavior.

## AM-API-005: Avatar Package API Posture

Avatar package APIs reuse the generic package-market API surface with package-kind-aware validation.

`/api/asset-market/packages/{packageId}/acquire` and `/api/asset-market/bundles/{bundleId}/imports` must apply the `avatar` package-kind readiness, provenance, compatibility, and target-consumer gates from `AM-PKG-*`, `AM-PUBLISH-*`, and `AM-LIB-*`.

They must not expose an Avatar-local package descriptor endpoint, Agent Center install endpoint, or loose file activation endpoint.
