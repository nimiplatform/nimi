# Retired Knowledge UI Contract

> Authority: Desktop Kernel
> Status: retired hard-cut

## Scope

Desktop Runtime Config must not expose a standalone "Knowledge" management
page.

The retired page was a bank/page administration surface inherited from the
absorbed `RuntimeKnowledgeService` topology. Runtime and SDK may still expose
`runtime.knowledge.*` helpers when every method routes to
`RuntimeCognitionService`, but Desktop must not present that infra slice as an
active product configuration page.

This contract separates three meanings that must not be collapsed:

- `RuntimeCognitionService` is the runtime-facing cognition service owner.
- Runtime-local knowledge banks/pages are an absorbed infra projection family.
- Desktop product cognition UX is not admitted by this retired page contract.

## D-DSYNC-014 — Retired Runtime Config Knowledge Page

Desktop Runtime Config must hard-cut the old Knowledge page.

Fixed constraints:

- no `RuntimePageIdV11` value named `knowledge`
- no Runtime Config sidebar item, page meta, route branch, or E2E page root for
  `knowledge`
- no `runtime-config-page-knowledge*` renderer modules
- no Desktop Runtime Config wrapper service dedicated to knowledge bank/page
  CRUD
- no `runtimeConfig.sidebar.knowledge` or `runtimeConfig.knowledge` locale
  subtree
- persisted or external `activePage="knowledge"` input must normalize to
  `overview`

## D-DSYNC-015 — Runtime Knowledge API Boundary

The SDK/runtime knowledge method family remains allowed only as an absorbed
`RuntimeCognitionService` API surface.

Fixed constraints:

- SDK method ids must not route to `RuntimeKnowledgeService`
- Desktop must not create a Realm REST bypass, DataSync facade, or app-local
  parallel truth for knowledge banks/pages
- Desktop must not treat runtime-local bank/page CRUD as canonical AgentCore
  knowledge, memory recall, shared truth, or prompt-serving policy
- Desktop must not add a product UI over this API without a new cognition UX
  authority contract

## D-DSYNC-016 — Workspace-Private UI Gate

Desktop must not expose a user-selectable `WORKSPACE_PRIVATE` knowledge flow in
Runtime Config.

Fixed constraints:

- workspace-private knowledge access remains fail-closed until an admitted
  workspace authorization carrier exists
- UI must not offer workspace id entry, workspace bank create/list/delete, or
  empty-state fallbacks that mask authorization denial
- workspace re-enablement belongs to a separate cognition/product admission,
  not to this retired Runtime Config page

## D-DSYNC-017 — Removed Management Surface

The old bank/page/search/graph/ingest management surface is retired from
Desktop Runtime Config.

Fixed constraints:

- no bank create/delete/detail/selection surface
- no page list/get/put/delete surface
- no bank-scoped keyword or hybrid search explorer
- no same-bank graph/backlink editor
- no single-document ingest/progress inspector

## D-DSYNC-018 — Future Cognition UX Admission

Any future Desktop cognition UI must be admitted as a new cognition product
surface rather than by reviving this retired page.

Fixed constraints:

- new UI must define its subject, scope, user value, and product vocabulary
  before implementation
- new UI must not use "Knowledge" as a generic label for an infra bank CRUD
  page
- new UI must not reuse the retired Runtime Config page contract as active
  truth
