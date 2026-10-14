# Realm Generator

Realm core manifests and typed clients are generated from the OpenAPI source declared in `config/realm-openapi-source.json` (with relative paths resolved from the repo root). If that file is unavailable in your current worktree, set `NIMI_REALM_OPENAPI_PATH` to the canonical OpenAPI file before running the generator.

Although the generator may internally classify a missing OpenAPI source as `realm_spec_fallback`, full client generation fails closed before writing any artifacts. Admitted Realm spec tables cannot replace the OpenAPI schema as the authority for generated Realm clients.
