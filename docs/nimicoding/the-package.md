# The Package

`@nimiplatform/nimi-coding` is a standalone package that projects Nimi
Coding methodology and contracts into a host repository and exposes
deterministic CLI checks.

## Nimi Admission Surface

Within the Nimi repository, the package is admitted for:

- package-managed `.nimi/config/**`, `.nimi/contracts/**`, and
  `.nimi/methodology/**` governance projections;
- guarded projection and doctor checks;
- canonical spec construction contracts and generation-audit validation;
- spec taxonomy, placement, table-family, projection-edge, and tracked-output
  validation;
- deterministic spec and AI-governance gates.

The project owns `.nimi/spec/**`. Local evidence under
`.nimi/local/**` supports review and cannot promote itself to semantic
truth.

## Execution Ceiling

The package does not own Nimi's task plan, progress, delegation, retry,
wait, resume, or completion state. It does not launch a nested host or
select the host's next action. Codex App or another admitted external
host owns those capabilities end to end.

## Package And Project Ownership

| Surface | Owner |
| --- | --- |
| Package source and release | `@nimiplatform/nimi-coding` repository |
| Package-canonical projections | Nimi Coding package |
| Declared host profile overrides | Nimi host, bounded by package projection policy |
| Product authority | Nimi `.nimi/spec/**` |
| Project checks | Nimi scripts plus admitted package validators |
| Task execution | Active external host |
| Local evidence | Project-local, non-semantic |

## Source Basis

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/contracts/surface-taxonomy.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/surface-taxonomy.schema.yaml)
