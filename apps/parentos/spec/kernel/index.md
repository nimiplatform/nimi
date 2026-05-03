# ParentOS Kernel Authority Map

This directory is the normative authority landing for ParentOS.

Normative surfaces:

- `tables/routes.yaml` for registered routes and navigation exposure
- `tables/feature-matrix.yaml` for implemented and planned feature ownership
- `tables/local-storage.yaml` and the other kernel tables for structured facts and persistence shape
- `app-shell-contract.md` for shell/bootstrap/settings authority
- `timeline-contract.md` for reminders, timeline projection, and report-trigger integration
- `reminder-interaction-contract.md` for the reminder kind taxonomy, per-kind progression state machines, explain authoring contract, action enumeration, and advisor consultation writeback
- `health-record-console-contract.md` for the `/profile` first-screen health record console, metric registry consumption, latest-status projection, evaluation semantics, freshness, and next-record display
- `capture-orchestrator-contract.md` for the unified add-data modal, typed capture intent, protocol-driven fields, save transaction, and reminder-linked completion
- `profile-contract.md` for child profile and health-record surfaces
- `journal-contract.md` for journaling, voice capture, and closed-set tag suggestion
- `advisor-contract.md` for advisor chat, report generation, and AI boundary rules
- `knowledge-asset-contract.md` for knowledge asset manifests, section semantics, provenance, schema validation, generated projections, and runtime consumption boundaries
- `orthodontic-contract.md` for orthodontic cases, appliances, compliance checkins, and the orthodontic AI summary surface
- `tables/orthodontic-protocols.yaml` for admitted orthodontic dynamic reminder rules and dental follow-up protocols
- `tables/health-metric-registry.yaml` for canonical health metric ids, groups, units, value shapes, capture protocol references, evaluation policy references, freshness policy references, and detail routes
- `tables/health-evaluation-rules.yaml` for non-diagnostic health evaluation status semantics and rule references
- `tables/health-capture-protocols.yaml` for unified capture protocols and required metric sets
- `tables/reminder-capture-targets.yaml` for canonical `record_data` reminder to capture-protocol bindings
- `tables/reference-data-assets.yaml` for the admitted knowledge asset registry

Guide-only documents:

- `../INDEX.md` is the reading path for humans
- `../parentos.md` is the product overview, non-goals, and known-defects guide

Authority rules:

- Normative ParentOS product content belongs only in `kernel/*.md` and `kernel/tables/**`.
- App-local guide documents must point back to this map instead of duplicating kernel rules.
- Orphan pages, placeholder flows, and fail-open behavior are not authority unless they are explicitly listed in this kernel map and its tables/contracts.
- Concrete external/reference values and curated content datasets belong in admitted data assets under `apps/parentos/data/**`; `knowledge-asset-contract.md` owns manifest shape, provenance, schema validation, generated projection, and direct-read boundaries.
