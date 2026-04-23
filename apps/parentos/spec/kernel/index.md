# ParentOS Kernel Authority Map

This directory is the normative authority landing for ParentOS.

Normative surfaces:

- `tables/routes.yaml` for registered routes and navigation exposure
- `tables/feature-matrix.yaml` for implemented and planned feature ownership
- `tables/local-storage.yaml` and the other kernel tables for structured facts and persistence shape
- `app-shell-contract.md` for shell/bootstrap/settings authority
- `timeline-contract.md` for reminders, timeline projection, and report-trigger integration
- `reminder-interaction-contract.md` for the reminder kind taxonomy, per-kind progression state machines, explain authoring contract, action enumeration, and advisor consultation writeback
- `profile-contract.md` for child profile and health-record surfaces
- `journal-contract.md` for journaling, voice capture, and closed-set tag suggestion
- `advisor-contract.md` for advisor chat, report generation, and AI boundary rules
- `orthodontic-contract.md` for orthodontic cases, appliances, compliance checkins, and the orthodontic AI summary surface
- `tables/orthodontic-protocols.yaml` for admitted orthodontic dynamic reminder rules and dental follow-up protocols

Guide-only documents:

- `../INDEX.md` is the reading path for humans
- `../parentos.md` is the product overview, non-goals, and known-defects guide

Authority rules:

- Normative ParentOS product content belongs only in `kernel/*.md` and `kernel/tables/**`.
- App-local guide documents must point back to this map instead of duplicating kernel rules.
- Orphan pages, placeholder flows, and fail-open behavior are not authority unless they are explicitly listed in this kernel map and its tables/contracts.
