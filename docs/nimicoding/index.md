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

The first successful Nimi Coding path is intentionally small:

1. **Install the package** in an existing repository. See
   [Installation](/nimicoding/installation).
2. **Bootstrap `.nimi/`.** Use `nimicoding start`, then check the
   result with `nimicoding doctor --json`.
3. **Reconstruct project authority** into `.nimi/spec/**`, recording
   source basis and unresolved gaps instead of inventing clean rules.
4. **Create a topic** for the first high-risk or authority-bearing
   change.
5. **Split the topic into waves** so each wave has one owner domain
   and one closure goal.
6. **Freeze a packet** before work starts: allowed reads, allowed
   writes, acceptance invariants, negative tests, stop lines, and
   reopen conditions.
7. **Run or hand off the work through an admitted AI host**, then
   record typed evidence.
8. **Close the wave only across all four dimensions**: authority,
   semantic, consumer, and drift resistance.

That path is the product in miniature: AI work becomes durable,
bounded, auditable project state instead of a chat transcript that
looked convincing at the time.

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

- [Role Separation](/nimicoding/role-separation) — manager,
  worker, auditor.
- [Authority Convergence](/nimicoding/authority-convergence) —
  why an independent audit has to come before implementation
  when spec changes.

### Lifecycle

- [Topic Lifecycle](/nimicoding/topic-lifecycle) — proposal,
  ongoing, pending, closed; wave fine-grained states; true close.
- [Whitepaper](/nimicoding/whitepaper) — the conceptual case
  argument for treating AI-assisted implementation as
  authority-bearing work.
- [Topic Workflow](/nimicoding/topic-workflow) — the operational
  topic / wave / packet / preflight / audit / closeout flow.
- [Walkthrough](/nimicoding/walkthrough) — a synthetic example
  end-to-end.

### The Package

- [The Package](/nimicoding/the-package) — what
  `@nimiplatform/nimi-coding` ships, what it does not ship.
- [Host-Agnostic Boundary](/nimicoding/host-agnostic) — why
  switching AI hosts does not change the methodology.
- [Skills](/nimicoding/skills) — the four declared skills
  (`spec_reconstruction`, `doc_spec_audit`, `audit_sweep`,
  `high_risk_execution`).
- [CLI Surface](/nimicoding/cli) — concept-level overview of the
  command surface.
- [Installation](/nimicoding/installation) — current installation
  posture.

### Comparison And Adoption

- [Comparison](/nimicoding/comparison) — vs vanilla AI coding,
  code review, DevOps governance, DDD, agile.
- [Adoption Path](/nimicoding/adoption-path) — who would adopt
  this and why.

### Practical Sub-Trees

- [Tutorials](/nimicoding/tutorials/) — learning-oriented
  step-by-step lessons, including the full path from install to
  `.nimi/spec/**`, topic execution, sweep audit, sweep design, and
  long-running host work.
- [How-to](/nimicoding/how-to/) — problem-shaped recipes.
- [Reference](/nimicoding/reference/) — schema-level dictionary.

### Appendix

- [oh-my-codex Adapter](/nimicoding/appendix/oh-my-codex) —
  admitted external host adapter overlay.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi-coding/blob/main/AGENTS.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/high-risk-admissions.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/high-risk-admissions.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
