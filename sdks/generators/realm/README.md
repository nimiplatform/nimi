# Realm Generator

Realm core manifests and typed clients are generated from the OpenAPI source
declared in `config/realm-openapi-source.json`, with relative paths resolved
from the repo root. If that source is unavailable in a worktree, set
`NIMI_REALM_OPENAPI_PATH` to the canonical OpenAPI file before running the
generator.

The generator may classify missing OpenAPI as `realm_spec_fallback` internally,
but full client generation fails closed before writing artifacts. Admitted Realm
spec tables are not schema authority for generated Realm clients.
