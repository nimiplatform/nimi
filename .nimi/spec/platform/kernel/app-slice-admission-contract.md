# App Slice Admission Contract

> Owner Domain: `P-APP-*`

## P-APP-001 — Single Admission Source

`.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml` is the only repo-wide admission source for app-local spec slices. Files under `apps/**/spec/**` are not repo-wide authority by location alone; they become audit authority only when an active admission row names their app id, authority root, owner domain, and evidence roots.

## P-APP-002 — Subordinate Authority Scope

An admitted app-local spec is a subordinate authority projection. It may define local shell, renderer, Tauri host, route, package, fixture, and app-specific feature contracts for its own app slice. It must not claim repo-wide semantics or become an alternate source for platform, runtime, SDK, realm, cognition, or desktop kernel truth.

## P-APP-003 — No Override

When an app-local spec conflicts with `.nimi/spec/**` kernel authority, the kernel authority wins and the app-local spec must be corrected or de-admitted. App-local specs must not override runtime transport/auth semantics, SDK public surface semantics, realm truth semantics, platform kit/design/governance semantics, or desktop kernel semantics.

## P-APP-004 — Evidence Roots Are Explicit

Every active admission row must declare evidence roots that stay inside the admitted app directory. Audit tools must not infer evidence roots from sibling apps, workspace package globs, or broad `apps/**` ownership when an app-specific admission exists.

## P-APP-005 — Audit Expansion

Spec-first audit planning may expand admitted app-local specs into authority chunks only by reading the admission table. Each expanded chunk must retain an admission reference back to this table and must keep `authority_refs` separate from implementation evidence files.

## P-APP-006 — De-admission

An app slice that is inactive, obsolete, or intentionally removed must be marked inactive or removed from the admission table. Retained implementation files without active authority admission must remain unmapped evidence and must block full-audit closeout.
