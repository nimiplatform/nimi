# CLI Reference

This page describes the role of the Nimi Coding CLI surfaces at a
conceptual level. It isn't a full command manual.

## What The CLI Is For

The CLI exists to make governance actions explicit:

- create and validate topics;
- add, select, and admit waves;
- freeze execution packets;
- dispatch worker or audit steps;
- record results;
- close waves and topics;
- validate lifecycle and graph consistency.

Those commands matter because topic state should not live only in a
chat transcript. It needs durable artifacts that another session can
audit.

## Reader Scenario: Why The CLI Is Not Optional Even When You Are Working Solo

Suppose a single developer is running a wave end-to-end with AI
assistance. The CLI seems redundant in that setting; the developer
already knows what is happening. The CLI still matters because:

1. The artifacts it produces are how a future review (or a future
   contributor) reconstructs what was decided.
2. The validation steps catch shape errors a single session might
   miss.
3. The artifacts form the boundary the audit step relies on.
4. The closeout artifacts are how "this was actually finished" gets
   recorded as more than a memory.

A solo developer benefits from the same gate that a team would. The
gate is what protects the work from quietly drifting later.

## Command Categories, At A Reading Level

| Category | What it covers |
| --- | --- |
| Topic | Init, validate, hold (pending), close |
| Wave | Add, select, admit, close |
| Packet | Freeze, validate |
| Execution | Preflight, dispatch, record result |
| Audit | Record audit evidence, judge |
| Validation | Lifecycle and graph consistency checks |

The exact command arguments belong to the local CLI help and to the
methodology source. Public command examples appear in these docs only
when the project has stabilized the external user path.

## Reader Scenario: A Validation Step That Catches Drift

Suppose someone hand-edits a topic artifact in a way that no longer
matches the schema. A validation command would surface that as a
typed error rather than letting the drift slip through.

That is a small example, but it is the kind of guardrail the
methodology relies on. The CLI is what enforces shape so the audit
step has clean evidence to work against.

## How To Use This Page

Use this page to understand the workflow categories. For exact command
arguments, inspect the local CLI help or existing topic artifacts in
`.nimi/topics/**`. Public command examples should be expanded only
when the project has stabilized the external user path.

## Source Basis

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
