# The Package

`@nimiplatform/nimi-coding` is a standalone package that projects Nimi
Coding methodology and contracts into a host repository and exposes
deterministic CLI checks.

## Nimi Admission Surface

Within the Nimi repository, the package is admitted for:

- the retained host-owned `.nimi/config/**`, `.nimi/contracts/**`, and
  `.nimi/methodology/**` projection set;
- compatibility-wrapped projection and doctor checks;
- external-host skill declarations and result contracts;
- spec reconstruction and governance validation;
- authority preflight and static/local high-risk evidence;
- deterministic prompt, result, and acceptance validation.

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
| Retained project projections | Nimi host, bounded by the admission contract |
| Product authority | Nimi `.nimi/spec/**` |
| Project checks | Nimi scripts plus admitted package validators |
| Task execution | Active external host |
| Local evidence | Project-local, non-semantic |

## Source Basis

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
