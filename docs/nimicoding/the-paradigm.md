# The Paradigm

Nimi Coding changes the question from “did the AI produce plausible
code?” to “is the result aligned with authority and proven in its real
consumer?” It is a governance paradigm around host-owned execution, not
a task runner.

## Five Structural Moves

1. **Name authority.** Every high-risk change identifies the canonical
   spec owner and refuses parallel truth.
2. **Classify before editing.** Preflight distinguishes alignment from
   redesign and stops when authority is missing.
3. **Fail closed.** Missing contracts, evidence, auth, runtime, or
   provider capability become explicit failures.
4. **Verify the consumer.** Tests, DOM/native inspection, runtime state,
   and visual review cover different evidence classes.
5. **Separate production from judgement.** Independent review challenges
   authority and evidence without becoming another executor.

## Host-Native Execution

The active host decides how to plan, delegate, wait, recover, and finish
the task. Nimi Coding never needs a copy of those decisions. Its durable
surfaces are authority, methodology, validators, and evidence contracts.

This makes native Codex capabilities an advantage: the app can manage
long-running work and subagents while the repository supplies stable
truth and deterministic acceptance criteria.

## Reader Scenario

Codex is asked to add a profile field. Before editing, it determines
whether the field belongs to identity authority or presentation. It
then changes the owning contract and public SDK surface, migrates the
real consumer, tests failure states, and verifies the app.

The useful innovation is not a longer plan. It is that every ambiguity
has an owner, every prohibited shortcut is explicit, and every
completion claim has reconstructable evidence.

## Source Basis

- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
