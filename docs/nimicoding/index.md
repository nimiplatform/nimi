# Nimi Coding

Nimi Coding is **a vendor-neutral AI-native methodology product
for governing high-risk AI-assisted software work**. It ships as a
standalone npm package (`@nimiplatform/nimi-coding`), bootstraps a
project-local `.nimi/**` truth surface into any repository, and
turns "AI plausibly finished this" into "the four closure
dimensions are evidenced."

Nimi Coding is one of the products inside the Nimi platform — the AI
development methodology that ships with everything else. It can also be
adopted on its own: the package is host-agnostic and works in any
repository, regardless of whether the rest of the Nimi platform is in
use.

Nimi Coding and the rest of the platform stress-test each other. Nimi
Coding is what makes a system as ambitious as Nimi buildable by a small
team using AI; the platform's actual scale is what makes Nimi Coding's
claims falsifiable in practice.

## Why This Section Exists

Most AI products solve "AI in the editor." Nimi Coding solves "how
does anyone trust the work AI did?" The answer is not better
prompts and not better tests. It is **methodology** — explicit
machinery for declaring closure conditions before work begins, and
verifying them as evidence after work ends.

If you have ever watched an AI-assisted change look complete to
every available signal — type checker green, tests green, code
review approved — and turn out to be wrong about authority,
scope, or product meaning, this section is for you.

## Start Here If You Are New

The first successful Nimi Coding path is intentionally bounded:

1. **Install the Nimi workspace.** See
   [Host Integration](/nimicoding/installation).
2. **Verify the host hardcut** with the project compatibility wrappers.
3. **Select a retained skill** from `.nimi/config/skill-manifest.yaml`.
4. **Let the admitted AI host reconstruct authority when required** into
   `.nimi/spec/**`, recording source basis and unresolved gaps instead
   of inventing clean rules.
5. **Validate the tree** with `pnpm exec nimicoding validate-spec-tree
   .nimi/spec`; when reconstruction ran, also validate its declared
   audit with `pnpm exec nimicoding validate-spec-audit`.

That path verifies the project truth surface and mechanical validators.
The admitted AI host remains the sole owner of task
planning, execution, delegation, retries, resume behavior, and completion.
For high-risk work, Nimi Coding strengthens the host with explicit
preflight, authority convergence, scoped gates, and typed evidence; it
does not introduce another execution lifecycle.

## What's In This Section

### The Paradigm

- [The Paradigm](/nimicoding/the-paradigm) — what's actually new
  about AI-coding governance and why this is a paradigm rather
  than a checklist.
- [Four Closures](/nimicoding/four-closures) — authority,
  semantic, consumer, and drift-resistance closure as a thinking
  framework.
- [False Closure Typology](/nimicoding/false-closure-typology) —
  the named failure shapes the methodology catches.
- [Forbidden Shortcuts](/nimicoding/forbidden-shortcuts) — the
  catalog of refused anti-patterns.

### Roles And Convergence

- [Role Separation](/nimicoding/role-separation) — host executor,
  authority owner, independent reviewer, and human decision owner.
- [Authority Convergence](/nimicoding/authority-convergence) —
  why an independent audit has to come before implementation
  when spec changes.

### Methodology And Evidence

- [Whitepaper](/nimicoding/whitepaper) — the conceptual case
  argument for treating AI-assisted implementation as
  authority-bearing work.
- [Walkthrough](/nimicoding/walkthrough) — a synthetic example
  of host-owned execution with spec, gates, and evidence end-to-end.

### The Package

- [The Package](/nimicoding/the-package) — what
  `@nimiplatform/nimi-coding` ships, what it does not ship.
- [Host-Agnostic Boundary](/nimicoding/host-agnostic) — why
  switching AI hosts does not change the methodology.
- [Skills](/nimicoding/skills) — the three declared skills
  (`spec_reconstruction`, `doc_spec_audit`, `audit_sweep`).
- [CLI Surface](/nimicoding/cli) — concept-level overview of the
  command surface.
- [Installation](/nimicoding/installation) — current installation
  posture.

### Practical Sub-Trees

- [Tutorials](/nimicoding/tutorials/) — learning-oriented
  step-by-step lessons, including the full path from install to
  `.nimi/spec/**`, scoped validation, and host-owned execution.
- [How-to](/nimicoding/how-to/) — problem-shaped recipes.
- [Reference](/nimicoding/reference/) — schema-level dictionary.

## Source Basis

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
