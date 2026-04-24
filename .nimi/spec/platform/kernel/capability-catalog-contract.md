# Capability Catalog Contract — P-CAPCAT-*

> Canonical cross-layer identity authority for the model capability catalog consumed by Nimi
> apps. The catalog is spec-resident and is the single source for `CanonicalCapabilityId`
> values referenced by `AIConfig.capabilities` (D-AIPC-003, D-AIPC-010),
> `ConversationCapabilitySelectionStore` keys (D-LLM-015..021), `AppModelConfigSurface`
> consumers, and runtime route registry lookups. Codegen output lives in the
> `kit/core/runtime-capabilities` module per P-KIT-043; this contract owns the identity set
> and its resolver semantics, not the presentation or routing layers.

## P-CAPCAT-001 — Canonical Capability Identity Authority

- `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml` is the single
  authoritative enumeration of `CanonicalCapabilityId` values admitted by Nimi apps.
- Every row declares one capability with fields `capabilityId`, `section`, `editorKind`,
  `sourceRef`, `i18nKeys`, and `runtimeEvidenceClass`; no app, kit module, or runtime
  surface may admit a `CanonicalCapabilityId` that is not present in this table as either
  an active row or a `deferred:` entry.
- `section` values are drawn from the fixed set `chat | tts | stt | image | video | embed
  | voice | world`; `editorKind` values are drawn from the fixed set `text | image |
  video | audio-transcribe | audio-synthesize | voice-workflow | null`.
- The catalog is a cross-layer identity contract: it does not admit provider, model,
  engine, routing, or binding preference; those remain owned by `provider-catalog.yaml`,
  `provider-capabilities.yaml`, `local-adapter-routing.yaml`, and
  `AIConfig.capabilities`. Adding a new `CanonicalCapabilityId` requires a catalog row
  before any consumer may emit or accept the value.

## P-CAPCAT-002 — Runtime Source Reference Resolver Semantics

- Every active row in `canonical-capability-catalog.yaml` must carry a structured
  `sourceRef: { table, capability }` anchor where `table` is one of
  `provider-capabilities` or `local-adapter-routing`, and `capability` is the token as
  it appears in that runtime kernel table.
- An active row may additionally carry `additionalRuntimeTables: [{ table, capability
  }, ...]` when the same canonical capability is admitted by more than one runtime
  kernel table. Each entry must name a different `table` from the primary `sourceRef`
  and must resolve under the same resolver semantics. This keeps a strict
  one-row-per-`capabilityId` invariant while admitting multi-table runtime sources.
- Resolver semantics are table-specific and fixed:
  - For `table: provider-capabilities`, the resolver flattens
    `.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml` over
    `providers[].capabilities[]` and succeeds when the `capability` value is present in
    the flattened set.
  - For `table: local-adapter-routing`, the resolver reads
    `.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml` over
    `routes[].capability` and succeeds when the `capability` value is present.
- A drift checker is required to run both a consistency predicate (every active row's
  primary `sourceRef` and each `additionalRuntimeTables` entry resolves) and a
  completeness predicate (the union of capability tokens admitted by the two runtime
  kernel tables equals the union of active catalog rows — across primary and
  additional runtime tables — and `deferred:` entries scoped per table). The checker
  must fail closed on any violation; partial success, silent skip, or placeholder
  admission is forbidden.

## P-CAPCAT-003 — Deferred Entry Admission

- Capability tokens that are admitted by a runtime kernel table but that are not yet
  admitted as active cross-layer `CanonicalCapabilityId` rows must be recorded under the
  top-level `deferred:` list in `canonical-capability-catalog.yaml`.
- Every `deferred:` entry must carry non-empty `capability`, `reason`, and `source_rule`
  fields, where `source_rule` references an existing kernel Rule ID (for example a
  `K-*` runtime rule or a `P-*` platform rule that owns the deferral reason). The drift
  checker must reject any `deferred:` entry that omits `reason` or `source_rule`.
- A `deferred:` entry is not a `CanonicalCapabilityId` admission. Apps, kit modules, and
  runtime consumers must not emit or accept `deferred:` tokens as canonical catalog
  values; they exist only to acknowledge the runtime-admitted token and to record why it
  has not yet entered the canonical identity set.

## Fact Sources

- `tables/canonical-capability-catalog.yaml`
- `tables/rule-evidence.yaml`
