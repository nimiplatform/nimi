# Knowledge UI

The Knowledge page is where you browse, search, and curate what your
agent knows. Desktop runs the whole experience: navigation, search and
curation controls, loading and error presentation, and transient UI
state.

The knowledge itself lives in Runtime. Desktop reaches it through the
standard SDK and the authorized Runtime surface; it doesn't run a
second Knowledge service or keep its own copy of record.

## Boundary

| Desktop owns | Runtime owns |
| --- | --- |
| Browse, search, and curation UX | Knowledge ingestion, retrieval, isolation, and lifecycle |
| Draft input and local presentation state | Session-derived authorization and LocalAgent scope |
| Typed unavailable and failure presentation | Admitted results and failure semantics |

Desktop sends your request in and renders what Runtime returns. A local
cache never counts as the real Knowledge, Conversation, Memory, source,
or authorization state.

If a request comes back unauthorized, unavailable, pending, or failed,
the UI shows you exactly that state. Desktop never works around Runtime
with a private store, a side-channel provider call, or an app-local
service.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
