# Tutorial: Run A Governed Codex Project

You are in Codex with an existing repository. You want Codex to help
with serious work: reconstruct project knowledge, discuss a requirement,
plan waves, run a long audit, implement or remediate findings, and close
the work without losing track of scope.

With Nimi Coding, you still talk to Codex in normal language. The
difference is that Codex keeps a durable work record in the repository:
`.nimi/spec/**` for authority, `.nimi/topics/**` for topic state, and
`.nimi/local/audit/**` for audit evidence.

## Start The Project

Tell Codex:

```text
Set up Nimi Coding in this repository for Codex. Install the package if
needed, bootstrap the `.nimi/**` layer, run the health check, and report
only the meaningful changes. Do not start a topic yet.
```

Codex runs the setup commands, including:

```bash
npm install --save-dev @nimiplatform/nimi-coding
npx nimicoding start --host codex
npx nimicoding doctor --json
```

Codex should come back with a small status report:

| What Codex reports | What it means |
| --- | --- |
| Package installed | The `nimicoding` CLI is available in the project |
| `.nimi/**` seeded | The project has contracts, methodology, config, and local state roots |
| Managed AI entrypoints updated | Future Codex sessions can see the project rules |
| `doctor` passed or named drift | Bootstrap is either healthy or blocked for a concrete reason |

At this point, Codex has not touched product code. It has only created
the governance surface future work will use.

## Reconstruct The Spec

Next, ask Codex to turn the existing project into a canonical spec tree:

```text
Use Nimi Coding to reconstruct this repository into `.nimi/spec/**`.
Read the handoff payload, inspect the code and docs, write canonical
spec files with source basis and unresolved-gap tracking, then validate
the result. Stop if the contract cannot be satisfied.
```

Codex uses Nimi Coding's reconstruction handoff and validation path:

```bash
npx nimicoding handoff --skill spec_reconstruction --json
npx nimicoding handoff --skill spec_reconstruction --prompt
npx nimicoding closeout --from spec-reconstruction-result.json --write-local
npx nimicoding validate-spec-tree .nimi/spec
npx nimicoding validate-spec-audit .nimi/spec/_meta/spec-generation-audit.yaml
npx nimicoding doctor --json
```

The useful result is not just "spec generated." Codex should report:

| Evidence | What to check |
| --- | --- |
| `.nimi/spec/**` | The project now has an authority tree |
| `.nimi/spec/_meta/spec-generation-audit.yaml` | Generated files cite source basis or record gaps |
| closeout result | The reconstruction was admitted under a typed contract |
| validation output | Structural and auditability checks passed |

If Codex cannot prove a spec claim from project evidence, it should
record an unresolved gap. That is better than inventing a clean rule.

## Discuss The Work

Now describe the real task in plain language:

```text
I want a fresh full audit of the repository against the current spec.
It should cover architecture, docs, runtime, SDK, apps, and Nimi Coding
governance. It needs to run for a long time if necessary, remain
resumable, and avoid silent closure.
```

Codex should turn that into a topic proposal before doing the audit. A
good reply looks like this:

```text
I will create a topic for a fresh full audit. Proposed waves:
1. sweep audit
2. sweep design
3. implementation waves from confirmed findings
4. closeout

Proposed owner domains:
.nimi/spec/**, docs/**, runtime/**, sdk/**, apps/**, nimi-coding/**

Please confirm the scope before I admit the first wave.
```

Behind that reply, Codex may run:

```bash
npx nimicoding topic create fresh-full-audit \
  --title "Fresh full audit" \
  --justification "Audit the repository against current spec authority, produce typed findings, and avoid silent closure." \
  --json
```

The confirmation matters. It keeps a broad request from turning into an
unbounded "Codex, audit everything" session.

## Approve The Audit Wave

After reviewing the proposed scope, tell Codex:

```text
Admit the audit wave. Do not start the full audit yet. First produce
the packet, preflight evidence, owner domains, negative tests, and stop
conditions for the audit plan.
```

Codex creates and admits the wave, freezes the packet, and asks the
topic runner what can happen next:

```bash
npx nimicoding topic wave add <topic-id> wave-1-sweep-audit sweep-audit ...
npx nimicoding topic wave select <topic-id> wave-1-sweep-audit --json
npx nimicoding topic wave admit <topic-id> wave-1-sweep-audit --json
npx nimicoding topic packet freeze <topic-id> --from packet-wave-1-sweep-audit.md --json
npx nimicoding topic run-next-step <topic-id> --json
```

Codex should show the files it created and the current decision:

| Artifact | Why you review it |
| --- | --- |
| `topic.yaml` | Shows the active wave and topic state |
| `packet-wave-1-sweep-audit.md` | Defines what Codex may read, write, and claim |
| preflight result | Records whether the design is safe to execute |
| `run-next-step` output | Says whether work can continue or must stop |

You are not expected to write packet YAML manually. You are expected to
review the contract before Codex spends hours executing against it.

## Run The Audit

When the design wave is accepted, tell Codex:

```text
Run the admitted audit sweep. Use chunks, record evidence per chunk,
review findings before freezing the ledger, and stop if any chunk
cannot be audited inside the packet boundary.
```

Codex uses `sweep audit` internally:

```bash
npx nimicoding sweep audit plan --root . --sweep-id fresh-full-audit --max-files 40 --json
npx nimicoding sweep audit chunk dispatch --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk ingest --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk review --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit ledger build --sweep-id fresh-full-audit --json
```

During a long run, ask for status instead of a narrative summary:

```text
Give me the current sweep audit status: planned chunks, reviewed
chunks, open findings, next chunk, current stop condition, and evidence
root.
```

Codex should answer in state terms:

```text
Audit sweep status:
- planned chunks: 18
- reviewed chunks: 6
- blocking findings: 3
- next chunk: chunk-007
- current stop condition: continue
- evidence root: .nimi/local/audit/
```

That state survives a long session. If Codex pauses or resumes hours
later, it can continue from the topic and audit artifacts rather than
from memory.

## Turn Findings Into Waves

After the ledger exists, the next step is not "please fix everything."
Ask Codex to design from the findings:

```text
Use sweep design on `fresh-full-audit`. Build design-auditor packets
from the findings, produce auditor prompts, ingest typed auditor
results, validate the revision ledger, finalize the design state, and
produce a wave plan. If any result reports an authority fork,
insufficient evidence, or a needed product decision, stop and ask me the
question before admitting implementation work.
```

Codex uses `sweep design` internally:

```bash
npx nimicoding sweep design intake --sweep-id fresh-full-audit --run-id fresh-full-audit-design --json
npx nimicoding sweep design packet-build-batch --run-id fresh-full-audit-design --batch-size 10 --json
npx nimicoding sweep design auditor-prompt --run-id fresh-full-audit-design --packet-id packet-001 --json
npx nimicoding sweep design result-ingest --run-id fresh-full-audit-design --from design-auditor-result.yaml --mode focused --json
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
```

Batch packet generation is only appropriate after Codex has reviewed
the inventory enough to choose a safe batch boundary. Otherwise it
should build smaller packets with `packet-build` and ask explicit
questions for findings that need more evidence, duplicate judgement, or
product decisions.

If `result-ingest`, `ledger-validate`, or `finalize` returns a
human-decision or evidence-gap state, Codex should show the decision
queue instead of continuing. A good prompt back to the user is concrete:

```text
This cluster cannot become implementation yet. It touches docs and
spec authority differently. Recommended decision: align the spec first,
then admit one docs implementation wave. Confirm or choose another
owner boundary.
```

After the decision is recorded, or when all clusters are ready, Codex
continues:

```bash
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
npx nimicoding sweep design wave-plan --run-id fresh-full-audit-design --topic-id <topic-id> --json
```

The wave plan only emits candidate `topic wave add` and `topic wave
admit` commands. It does not mutate topic state and it does not permit
worker dispatch. Codex should show the candidate waves and wait for
you to accept the implementation boundary.

## Let Codex Continue With `/goal`

For multi-hour work, give Codex a goal that keeps the topic contract in
the loop:

```text
/goal Continue topic <topic-id> until the current admitted wave reaches
a typed stop condition. Before every phase transition, run
`npx nimicoding topic run-next-step <topic-id> --json`. If the decision
is not `continue`, stop and report the required human evidence. Do not
write outside the active packet owner domain. Do not claim closure
without recorded evidence.
```

This turns Codex's long-running ability into a governed loop:

| Goal instruction | Effect |
| --- | --- |
| Continue a named topic | Work state lives in the repo, not only in chat |
| Run `topic run-next-step` | Phase changes go through typed decisions |
| Stop when not `continue` | Human gates and missing evidence stay visible |
| Stay inside owner domain | Scope cannot expand silently |
| Record evidence before closure | "Looks done" is not enough |

This is how a 40-hour audit can stay inspectable. Codex keeps returning
to topic state, packet boundaries, chunk evidence, and closeout criteria.

## Close The Work

When Codex says the wave is complete, ask for closure instead of a
general summary:

```text
Validate the active topic, record the final result, evaluate authority,
semantic, consumer, and drift-resistance closure, run true close if the
topic is ready, and show any remaining blockers.
```

Codex records the result and closeout internally:

```bash
npx nimicoding topic result record <topic-id> --kind audit --verdict PASS ...
npx nimicoding topic closeout wave <topic-id> <wave-id> ...
npx nimicoding topic true-close-audit <topic-id> --judgement "..." --json
npx nimicoding topic closeout topic <topic-id> ...
```

The final answer should be organized around closure:

| Closure dimension | What Codex must prove |
| --- | --- |
| Authority | No unadmitted authority drift remains |
| Semantic | Findings and changes match the spec and packet |
| Consumer | The intended reader or workflow can use the result |
| Drift resistance | Forbidden shortcuts and reopen conditions were checked |

If any dimension is blocked, Codex should name the missing evidence and
leave the topic open.

## What Changes Compared With Direct Codex

| Direct Codex request | Codex with Nimi Coding |
| --- | --- |
| Codex starts reading and editing | Codex first creates topic scope and packet boundaries |
| Progress lives in chat | Progress lives in `.nimi/topics/**` and `.nimi/local/audit/**` |
| Done is a model judgement | Done is a four-closure judgement |
| Findings are prose | Findings become typed evidence and ledgers |
| Scope can drift | Owner domains and packets constrain work |
| The user reviews the final answer | The user reviews gates and evidence throughout the run |

The goal is not more ceremony for the user. The goal is to let Codex do
large work while leaving a trail that another session, auditor, or human
manager can inspect.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-ledger.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-ledger.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
