# Topic Lifecycle

A topic is the canonical home for one major iteration line of
authority-bearing or high-risk work. This page covers the topic's
state machine — coarse lifecycle (`proposal → ongoing → pending →
closed`) plus fine-grained wave states plus separate true-close
status.

For the operational flow of how work moves through this state
machine, see [Topic Workflow](/nimicoding/topic-workflow).

## The Coarse Lifecycle

| State | Meaning |
| --- | --- |
| `proposal` | Pre-active planning |
| `ongoing` | Active execution |
| `pending` | Paused; awaiting evidence or external trigger |
| `closed` | No longer the active workstream |

State is recorded in `topic.yaml`. Folder location follows state;
folder moves alone are **not** the state evidence — `topic.yaml`
is.

## Fine-Grained States

Beyond the coarse roots, finer machine states exist:

| Fine state | Coarse |
| --- | --- |
| `design_only` | proposal / ongoing |
| `implementation_ready` | ongoing |
| `implementation_active` | ongoing |
| `true_close_pending` | pending / closed |
| `true_closed` | closed |
| `revoked` | closed (but revocable) |
| `superseded` | closed |

Fine-grained states are observable through topic artifacts and
through audit records.

## Movement Rules

Allowed transitions:

| Source → Destination | Notes |
| --- | --- |
| `proposal → ongoing` | Requires preflight, one selected next target, bounded stop line, consumed inputs, expected closeout checks, explicit forbidden reopenings |
| `ongoing → pending` | Requires no active implementation wave, explicit pending-note with reopen criteria or close trigger |
| `pending → ongoing` | Resume work; new wave admission required |
| `ongoing → closed` | Wave-level closeout for all closed waves; topic-level closeout records final disposition |
| `pending → closed` | Same as ongoing → closed |
| `proposal → closed` | Closing without implementation |
| `closed → ongoing` | Explicit reopen required (not casual edit) |
| `ongoing → proposal` | Re-planning from active state |

Forbidden:

- Parallel topic copies (one canonical copy at a time).

## Wave States

Inside a topic, waves have their own state machine.

| Wave state | Terminal? |
| --- | --- |
| `candidate` | no |
| `preflight_draft` | no |
| `preflight_admitted` | no |
| `implementation_admitted` | no |
| `implementation_active` | no |
| `needs_revision` | no |
| `overflowed` | no (requires explicit continuation or revision) |
| `continuation_packet_open` | no |
| `closed` | yes |
| `retired` | yes |
| `superseded` | yes |

A retired or superseded wave is not dispatchable. An
`overflowed` wave is not silently normalized to `closed` —
overflow continuation requires explicit admission.

## True Close

True close is **distinct from topic state being `closed`**. A
topic can be folder-closed without being true-closed; true close
requires a separate audit recording that the closure was
independently verified.

| `current_true_close_status` | Meaning |
| --- | --- |
| `not_started` | True close not attempted |
| `pending` | True close in progress |
| `true_closed` | True close passed |
| `revoked` | A passed true close was later revoked by independent audit |
| `superseded` | True close superseded by a later admission |

Passed true close may itself be revoked by a later independent
audit; revoked true close requires follow-up lineage. This is
what allowed the previous public docs topic to true-close
machine-side and then be remediated when human acceptance failed.

## Five Closure Layers

The full closeout discipline has five distinct evidence surfaces:

| Layer | What it covers |
| --- | --- |
| Context closure | A context has reached a stable planning stop line |
| Wave closeout | One admitted wave reached its stop line with bounded evidence (four closure dimensions) |
| Pending hold | The topic waits without active development but retains explicit reopen or close criteria |
| Topic closeout | The topic is no longer the active workstream |
| True close | The topic is independently audited as finished |

These five must remain **distinct**. Collapsing wave closeout
into topic closeout, or treating topic closeout as true close,
loses information.

## Reader Scenario: A Topic's Full Arc

A topic that ran a substantive AI-coding initiative might look
like:

| Phase | What happened |
| --- | --- |
| `proposal` | Topic created; initial design |
| `proposal → ongoing` | Preflight done; wave admitted |
| `ongoing` | Multiple waves run sequentially; each closed |
| `ongoing → pending` | Awaiting external dependency / user acceptance |
| `pending → ongoing` | External dependency satisfied; new wave admitted |
| `ongoing → closed` | All waves closed; topic-level closeout |
| `closed (true_close_status: not_started)` | Folder closed but true close not yet recorded |
| `true_close_pending → true_closed` | Independent audit verifies true close |

The state arc is observable through `topic.yaml` and audit
records.

## Reader Scenario: A Closed Topic Reopened

A closed topic is re-encountered later with a serious issue.

1. **Closed topic exists.** True closed.
2. **Independent audit reveals issue.** True close should not
   have passed.
3. **True close revoked.** `current_true_close_status: revoked`.
4. **Follow-up lineage required.** A new topic admits the
   remediation; lineage links back to the revoked true close.
5. **Original topic stays in closed state** with the revocation
   record; new topic does the remediation.

The revocation does not erase history; it adds a typed evidence
record.

## Reader Scenario: Pending With Close Trigger

A topic finishes its planned waves but cannot true-close yet —
human acceptance is required.

1. **All waves closed.** Wave-level closure for each.
2. **Pending state entered.** `topic.yaml.state: pending`.
3. **Pending-note records close_trigger.** "User explicitly
   accepts the rendered docs."
4. **Reopen criteria explicit.** "User reports docs still
   inadequate; admit remediation wave under this topic."
5. **User reviews.** Either accepts (move to true-close path)
   or surfaces blockers (admit new wave).

The pending-note is the structured wait. There is no implicit
"this is just sitting here."

## Source Basis

- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/true-close.schema.yaml)
- [`.nimi/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/pending-note.schema.yaml)
