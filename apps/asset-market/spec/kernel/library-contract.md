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

## AM-LIB-003: Saved Meaning

`Saved` means the creator has bookmarked the package for later consideration, without implying current use.

The current saved object is the package itself, not a creator or a single asset.

## AM-LIB-004: No Import-Derived Section

Library does not currently split out a separate imported section.

Import is a downstream consumption action; it does not define current library structure.
