# Realm Generator

Realm core manifests are generated from the OpenAPI source declared in
`config/realm-openapi-source.json`. If that source is unavailable in a worktree,
the generator can still emit a provenance-marked fallback from admitted Realm
spec tables so alignment work can continue without promoting `sdk/src/**` as
truth.

