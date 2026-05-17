# Library Contract — AM-LIB-*

> Available and saved package views.

## AM-LIB-001: Library Shape

Library is the creator's package library.

Current Library sections are limited to:

- `Available`
- `Saved`

## AM-LIB-002: Available Meaning

`Available` means the creator currently has access to use the package.

Current spec does not require exposing entitlement internals as a first-class object.

Package availability is currently evidenced through `PackageAcquisition`, not by mutating Bundle truth.

## AM-LIB-003: Saved Meaning

`Saved` means the creator has bookmarked the package for later consideration, without implying current use.

The current saved object is the package itself, not a creator or a single asset.

## AM-LIB-004: No Import-Derived Section

Library does not currently split out a separate imported section.

Import is a downstream consumption action; it does not define current library structure.

## AM-LIB-005: Avatar Package Acquisition and Import

Avatar package acquisition records access to the Asset Market `Package`; it does not mutate Realm `Bundle` truth and does not create Desktop or Agent Center package authority.

Avatar import produces an authorized opaque package ref and local materialization eligibility for Avatar consumers. It must fail closed unless:

- the package is published and `package_kind = avatar`
- the selected backend is `live2d` or `vrm`
- package readiness is true
- compatibility diagnostics contain no blocking finding
- the target consumer is admitted for Avatar package consumption

The output of import is an opaque ref plus materialization evidence. It is not a launch payload package descriptor and not a loose file activation path.
