# Nimi Coding Whitepaper

Nimi Coding treats AI-assisted implementation as authority-bearing
work. An AI can produce code that compiles, passes tests, and looks
reasonable while still being wrong about product truth, ownership,
consumer behavior, or failure semantics.

The answer is not a second agent framework. Codex or another admitted
host remains responsible for planning and executing the task. Nimi
Coding gives that host a project-local system for knowing what is true,
what is forbidden, what must be checked, and what evidence makes a
completion claim credible.

## The Governance Split

| Host owns | Nimi Coding strengthens |
| --- | --- |
| Task definition and plan | Canonical `.nimi/spec/**` authority |
| Subagents and parallel work | Authority owner and work-type preflight |
| Retry, wait, resume, completion | Fail-closed methodology and contracts |
| Code and product edits | Deterministic scripts and validators |
| Real app and runtime interaction | Typed local evidence and acceptance |

The split prevents two systems from trying to drive the same work. It
also prevents a fluent final answer from becoming the only proof that a
high-risk change succeeded.

## Four Independent Questions

Before a high-risk task is complete, evidence answers four questions:

1. **Authority:** did the change follow the canonical owner?
2. **Semantic:** does the implementation mean what the authority says?
3. **Consumer:** do real consumers use the intended behavior?
4. **Drift resistance:** will tests and gates catch regression or owner
   bypass?

A build can answer part of the semantic question. It cannot, by itself,
answer the other three.

## Why Real Runtime Evidence Matters

UI and app changes make the gap obvious. Unit tests can pass while the
real shell has an inaccessible button, stale auth state, broken narrow
layout, console error, or disconnected SDK. Nimi therefore requires
the host to inspect the real application, its DOM or native structure,
runtime state, and visual output.

## Why Project Truth Matters

Without a canonical authority tree, an AI fills gaps with plausible
rules. `.nimi/spec/**` makes ownership explicit. Methodology requires
the host to stop on a missing or contradictory owner instead of
inventing local truth. Deterministic gates then protect that boundary.

## The Result

Nimi Coding is successful when it becomes quiet infrastructure around
the host: precise truth before work, hard boundaries during work, and
real evidence after work. The host remains free to use its native task,
planning, delegation, and recovery capabilities without competing
project-side execution state.

## Source Basis

- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
