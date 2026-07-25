# Platform Authority Admission - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/platform/authority-admission.authority.yaml`。

---

<!-- source: .nimi/spec/platform/kernel/app-slice-admission-contract.md -->

# App Slice Admission Contract

> Owner Domain: `P-APP-*`

## P-APP-001 — Single Admission Source

`.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml` is the only repo-wide admission source for app-local spec slices. Files under `apps/**/spec/**` are not repo-wide authority by location alone; they become audit authority only when an `admission_posture=active` admission row names their app id, authority root, owner domain, and evidence roots.

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

---

<!-- source: .nimi/spec/platform/kernel/package-authority-admission-contract.md -->

# Package Authority Admission Contract

> Owner Domain: `P-PKG-*`

## P-PKG-001 — Single Package Admission Source

Package-local spec roots outside `.nimi/spec/**` become spec-first audit authority only when an `admission_posture=active` row in `.nimi/spec/**/kernel/tables/package-authority-admissions.yaml` names the package id, authority root, owner domain, and evidence roots. Audit tools must not infer package authority from workspace membership, package names, or directory shape alone.

## P-PKG-002 — Package Authority Scope

An admitted package authority root owns only the reusable methodology, spec-construction contracts and configuration, deterministic validators, package tests, and implementation surfaces named by its evidence roots. It must not override repo-wide product authority under `.nimi/spec/**`, and it must not promote host-local projections into package truth.

## P-PKG-003 — Host-Local Projection Boundary

Host-local `.nimi/config/**` support inputs and `.nimi/contracts/**` or `.nimi/methodology/**` projections are Nimi host surfaces only when a `.nimi/spec/**` authority contract admits those roots as audit evidence. Support configuration has no independent semantic authority. Host-local files must not be silently treated as package-owned truth, and package-owned source files must not be silently treated as host-local projections.

## P-PKG-004 — No Parallel Truth

If a package authority file and a host-local projection describe the same contract family, the active ownership line must be explicit: package source owns reusable package semantics, while `.nimi/spec/**` owns whether and how the host project admits or projects that contract. Conflicts must fail closed until one authority line is corrected.

## P-PKG-005 — Audit Expansion

Spec-first audit planning may expand admitted package-local specs into authority chunks only by reading package authority admission tables. Each expanded chunk must retain an admission reference, keep `authority_refs` as authority files only, and place implementation or host-local support files under `evidence_inventory`.

## P-PKG-006 — Host-Local Evidence Admission

Audit evidence roots for managed host-local `.nimi/{config,contracts,methodology}/**` surfaces must be admitted through `.nimi/spec/**/kernel/tables/audit-evidence-roots.yaml` and anchored to an explicit `.nimi/spec/**` authority file. Unadmitted host-local truth must remain unmapped evidence and block full-audit closeout.

## P-PKG-007 — Host Authority Projection Merge

When a managed host-local file projects a package-local authority file, or a host `.nimi/spec/**` authority file explicitly admits one, the package authority admission table must declare an explicit `host_authority_projection_refs` mapping from the host ref to the package authority ref. Spec-first audit planning must merge those refs into one package-owned audit chunk, retain both refs in `authority_refs`, and audit implementation evidence only once under the package evidence roots. Tools must not infer this relationship from matching content hashes or file names.

## P-PKG-008 — Authority-Specific Package Evidence Admission

Host-generated `.nimi/spec/**` authority artifacts that are enforced by package implementation code must admit the exact package implementation files or host-local contract files as audit evidence through `.nimi/spec/**/kernel/tables/audit-evidence-roots.yaml`. Exact file evidence roots must be assigned to the named authority chunk before broad package evidence roots, so package-owned implementation evidence cannot be hidden inside a different package authority chunk.

## P-PKG-009 — Delegated Source Projection Admission

When a host `.nimi/spec/**` subtree is a projection from an external implementation authority that owns evidence outside the host worktree, `.nimi/spec/**/kernel/tables/delegated-projection-admissions.yaml` must name the projected authority root, opaque source authority locator, local projection evidence roots, delegated evidence locators, delegated declared-evidence prefixes, and required verifier locators. Spec-first host audit must audit the local projection/parity evidence and delegate matching declared implementation refs through admitted opaque locators; it must not resolve those refs through filesystem topology guesses or rewrite them to unrelated host evidence owners.

## P-PKG-010 — External AI Host Workflow Ownership

The active external AI host is the sole owner of repository task and execution-workflow orchestration. Its authority includes task identity and status, planning and decomposition, agent or subagent scheduling, wait and resume behavior, continuation, and completion or blocked verdicts.

`@nimiplatform/nimi-coding`, its package authority, and its host-local projections must not become a second owner of that workflow state. A deterministic command may consume transient host inputs, but it must not persist or interpret a parallel task state as authority.

External-host workflow ownership does not weaken `.nimi/spec/**` authority or deterministic gate verdicts. The host must consume those authority and gate results when deciding completion; it must not override them or ask nimi-coding to choose the next execution step.

## P-PKG-011 — Nimi-Coding Admission Ceiling And Host Boundary Hardcut

Nimi admits `@nimiplatform/nimi-coding` only for structured spec and methodology semantics, deterministic validation / generation / gate commands, and evidence contracts or projections. Support configuration has no independent semantic authority and may exist only as an input to those admitted roles. Package files reachable through a broad audit evidence root are evidence inventory, not automatic semantic admission.

The Nimi host must not require, generate, route, or mirror any nimi-coding-owned:

- topic lifecycle or topic status directory;
- wave / packet execution DAG;
- run ledger, execution cursor, or package-owned completion state;
- goal bridge, automatic continuation, or package-owned resume loop;
- nested launch of the external AI host.

If the installed package still contains those surfaces, they remain unadmitted and must not affect host task execution, gates, evidence validity, or completion. `pnpm check:nimicoding-host-hardcut` must fail closed if a host entrypoint or active projection restores them.

This hardcut governs repository-work orchestration only. It does not rename, retire, or constrain Runtime `K-WF-*` product workflows, Nimi App product or developer workflows, Nimi2D Image2 pipelines, domain-native motion and scenario terms such as `greet_wave`, or other product semantics whose owner contracts are outside `P-PKG-*`.

---
