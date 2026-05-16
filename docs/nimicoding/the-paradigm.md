# The Paradigm

Nimi Coding is a **new paradigm for AI development** — not a checklist
and not a workflow library. This page explains what makes it a paradigm.

## What Today's Engineering Tools Assume

Code review, tests, type checking, linters, CI — they all share one
assumption: **the failures they catch are local and visible in the
code.** A bug lives in a function. A type mismatch sits on a
boundary. A test failure is a behavior assertion that didn't hold.

These tools work because the developer's intent and the code they
produce stay tightly coupled. If a developer wanted X and accidentally
wrote Y, code review and tests will surface the gap.

## What AI Coding Actually Breaks

AI-assisted implementation routinely produces output that:

- compiles
- passes existing tests
- looks plausible to a reviewer
- and is still wrong about authority, scope, semantics, or
  product meaning

The failure shapes the methodology was designed to catch:

| Shape | Mechanism |
| --- | --- |
| Stale-doc anchoring | Assistant follows a document that looked authoritative but had drifted from active spec |
| Implicit scope expansion | Assistant edits an adjacent surface "while it's in the file"; ownership silently shifts |
| Plausible synthesis | When authoritative source is missing, assistant invents a coherent answer indistinguishable from a real one |
| Old-route preservation | Assistant adds a new route alongside the old one as "safe migration"; the old route was supposed to be deleted |
| Build-pass closure | Work declared done because tests run, even though consumer-facing behavior is wrong |
| False reopen safety | A closed surface is touched again "just to fix this small thing"; closed authority silently mutated |
| Pseudo-success | A typed contract failure is hidden behind a fallback that returns "something" instead of failing closed |
| Context-budget gate drift | A gate meant to protect AI context is satisfied by compression, superficial summaries, or thin artifacts that pass the letter of the gate while losing the evidence needed for audit |

These are not bugs in the conventional sense. They are **closure
failures** — the work was claimed done in a state where the
closure conditions had not actually held.

Context-budget gate drift is especially important in AI-native
workflows. A file can be "made smaller" by collapsing unrelated
logic into dense prose, or a large evidence set can be summarized
until the next auditor can no longer reconstruct the claim. The
gate's purpose was correct — keep AI context usable — but the
execution layer satisfied the gate in a way that weakened audit.
Nimi Coding treats that as drift, not success: the right response
is to preserve bounded, cohesive source files and typed evidence,
not to hide complexity behind compressed artifacts.

## Why "Paradigm" And Not "Checklist"

A checklist is "make sure you do these things." A paradigm is "a
worldview that changes how you frame the work."

Nimi Coding's response is not a list of additional things to
remember. It is **explicit machinery for declaring closure
conditions before work begins, and verifying them as evidence
after work ends.**

The four moves that make it a paradigm rather than a checklist:

1. **Authority is named.** Every change names where its truth
   lives (`.nimi/spec/**`), who owns the surface, and what kind
   of work is happening (alignment / redesign / refactor / spec /
   authority).
2. **Execution is packetized.** Implementation is bounded by a
   frozen packet that names allowed reads, allowed writes,
   acceptance invariants, negative tests, stop lines, and reopen
   conditions before the worker begins. The worker cannot widen
   scope.
3. **Closure is multidimensional.** Authority closure, semantic
   closure, consumer closure, and drift-resistance closure are
   independent gates. A wave that passes three out of four is
   not closed.
4. **Roles are separated and the audit is independent.** Manager
   owns wave admission and judgement; worker owns the packet
   write set; auditor performs structural review and drift
   detection without authority to mutate or to admit.

The combination is the paradigm: a system in which an AI's
plausibly-good output cannot graduate to "done" without external
evidence, structurally separated from the loop that produced it.

## Reader Scenario: A Failure Code Review Cannot Catch

A developer asks an AI to "add a new field to the user profile."
The AI does it. Code review approves. Tests pass.

What code review and tests cannot answer:

- Did this change need to update the canonical user identity
  contract, or was it just a presentation field?
- Does the new field interact with any existing migration that
  was supposed to be deleted?
- Are there other surfaces (other apps, other docs) that now
  imply the field exists when it does not?
- Is the new field auditable, or did it sneak past audit?

Nimi Coding makes these questions **structurally answerable**:
the change is bounded by a packet that names its authority
domain; the packet's negative tests check for the things code
review cannot; the closure dimensions force the question "is the
consumer using the right seam now?"

## Reader Scenario: Why "Just More Prompts" Doesn't Work

A common attempted fix: "if AI keeps making mistakes, give it
better prompts." This addresses the symptom (the AI's output) but
not the structural problem (the loop reviewing the output is the
same loop that produced it).

Nimi Coding's role separation is what addresses the structural
problem. The auditor role is **not the same loop** that produced
the work. In `manager_worker_auditor` execution mode, the audit
comes from a structurally separate loop — a different AI session,
a different vendor, a different host.

A better prompt cannot replace structural separation. The
paradigm is what introduces the separation.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
