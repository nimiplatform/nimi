# Package Authority Admission Contract

> Owner Domain: `P-PKG-*`

## P-PKG-001 — Single Package Admission Source

Package-local spec roots outside `.nimi/spec/**` become spec-first audit authority only when an active row in `.nimi/spec/**/kernel/tables/package-authority-admissions.yaml` names the package id, authority root, owner domain, and evidence roots. Audit tools must not infer package authority from workspace membership, package names, or directory shape alone.

## P-PKG-002 — Package Authority Scope

An admitted package authority root owns only the reusable package methodology, contracts, configuration, adapters, tests, and implementation surfaces named by its evidence roots. It must not override repo-wide product authority under `.nimi/spec/**`, and it must not promote host-local projections into package truth.

## P-PKG-003 — Host-Local Projection Boundary

Host-local `.nimi/contracts/**` and `.nimi/methodology/**` files are Nimi host truth or projections only when a `.nimi/spec/**` authority contract admits those roots as audit evidence. They must not be silently treated as package-owned truth, and package-owned source files must not be silently treated as host-local projections.

## P-PKG-004 — No Parallel Truth

If a package authority file and a host-local projection describe the same contract family, the active ownership line must be explicit: package source owns reusable package semantics, while `.nimi/spec/**` owns whether and how the host project admits or projects that contract. Conflicts must fail closed until one authority line is corrected.

## P-PKG-005 — Audit Expansion

Spec-first audit planning may expand admitted package-local specs into authority chunks only by reading package authority admission tables. Each expanded chunk must retain an admission reference, keep `authority_refs` as authority files only, and place implementation or host-local support files under `evidence_inventory`.

## P-PKG-006 — Host-Local Evidence Admission

Audit evidence roots for host-local `.nimi/contracts/**` and `.nimi/methodology/**` must be admitted through `.nimi/spec/**/kernel/tables/audit-evidence-roots.yaml` and anchored to an explicit `.nimi/spec/**` authority file. Unadmitted host-local truth must remain unmapped evidence and block full-audit closeout.

## P-PKG-007 — Host Authority Projection Merge

When a host `.nimi/spec/**` authority file is a projected copy or host admission of a package-local authority file, the package authority admission table must declare an explicit `host_authority_projection_refs` mapping from the host authority ref to the package authority ref. Spec-first audit planning must merge those refs into one package-owned audit chunk, retain both refs in `authority_refs`, and audit implementation evidence only once under the package evidence roots. Tools must not infer this relationship from matching content hashes or file names.

## P-PKG-008 — Authority-Specific Package Evidence Admission

Host-generated `.nimi/spec/**` authority artifacts that are enforced by package implementation code must admit the exact package implementation files or host-local contract files as audit evidence through `.nimi/spec/**/kernel/tables/audit-evidence-roots.yaml`. Exact file evidence roots must be assigned to the named authority chunk before broad package evidence roots, so package-owned implementation evidence cannot be hidden inside a different package authority chunk.
