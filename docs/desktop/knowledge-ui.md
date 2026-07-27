# Knowledge UI

Desktop owns the user-facing Knowledge experience: navigation, search and
curation controls, loading and error presentation, and ephemeral UI state.

Runtime owns LocalAgent operational Knowledge. Desktop reaches it through the
standard SDK and authorized Runtime surface; it does not define a second
Knowledge service or maintain canonical Knowledge data locally.

## Boundary

| Desktop owns | Runtime owns |
| --- | --- |
| Browse, search, and curation UX | Knowledge ingestion, retrieval, isolation, and lifecycle |
| Draft input and local presentation state | Session-derived authorization and LocalAgent scope |
| Typed unavailable and failure presentation | Admitted results and failure semantics |

Desktop submits typed user intent and renders the returned projection. A local
cache cannot become Knowledge, Conversation, Memory, source, or authorization
truth.

When a request is unauthorized, unavailable, pending, or failed, the UI keeps
the typed result visible and does not bypass Runtime through a private store,
provider call, or app-local service.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
