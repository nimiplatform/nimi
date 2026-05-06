# How To Reopen After Overflow

A wave returned `OVERFLOW`, not `PASS` or `FAIL`. The worker hit
the packet boundary mid-implementation. You want to continue.

## Recipe

1. **Read the OVERFLOW result.** What did the worker complete?
   Where did it stop? What is the current state?
2. **Evaluate continuation admissibility.** Three positive
   conditions; three blockers.
3. **If admissible**, admit a continuation packet that extends
   the boundary; resume work.
4. **If not admissible**, return wave to revision; admit a new
   wave or re-scope.

## Continuation Admissibility

| Condition | Admissible | Not admissible |
| --- | --- | --- |
| Direction | Still correct | Direction has shifted |
| Scope | Has not crossed into a new owner domain | Has crossed |
| Current state | Acceptable; packet boundary was too thin | Shadow truth introduced or fallback was needed |

The methodology's `overflow-continuation-policy` is explicit:

```yaml
allowed_when:
  - direction_is_still_correct
  - scope_has_not_crossed_into_a_new_owner_domain
  - current_state_is_acceptable_but_packet_boundary_was_too_thin
reject_when:
  - shadow_truth_was_introduced
  - fallback_or_alias_was_needed
  - packet_crossed_into_a_new_owner_domain
```

## Recipe For An Admissible Continuation

1. **Author continuation packet.** New `packet_id` distinct
   from original; references original packet.
2. **Wave state moves to `continuation_packet_open`.** This is
   the typed state for "overflow continuation admitted."
3. **Continuation packet's `allowed_writes`** extends — same
   owner domain, broader path coverage if appropriate.
4. **Continuation packet's `acceptance_invariants`** are
   tightened or extended to capture the missing finish.
5. **Dispatch worker.** Worker resumes from where the original
   stopped.
6. **Audit.** Independent audit on continuation result.
7. **Closeout.** When the work is complete, close the wave.

## Recipe For A Not-Admissible Overflow

1. **Document the overflow reason.** Specifically: shadow truth /
   fallback / new domain.
2. **Wave state moves to `needs_revision`.** Not closed; not
   continuation-admitted.
3. **If the issue is recoverable in the same domain**: a new
   packet replaces the original; original packet becomes
   `superseded`.
4. **If the issue requires owner-domain re-scope**: a new wave
   admits, with new owner domain. The current wave moves to
   `superseded` or is retired with explicit lineage.

## Reader Scenario: An Overflow That Continues

A wave was implementing a substantial refactor. The worker
completed 80% before hitting the packet's allowed_writes
boundary. Direction is correct; scope stayed in the declared
owner domain; no shadow truth introduced.

| Step | Action |
| --- | --- |
| Result kind | OVERFLOW |
| Direction correct | Yes |
| Owner domain crossed | No |
| Shadow truth introduced | No |
| Fallback needed | No |
| Continuation admissible | Yes |
| Continuation packet authored | Extending allowed_writes |
| Wave state | `implementation_active → continuation_packet_open` |
| Worker resumes | Completes |
| Audit | PASS |
| Closeout | Four-closure dimensions met |

## Reader Scenario: An Overflow That Cannot Continue

A wave was implementing a refactor. The worker, hitting the
boundary, introduced a fallback path to "make it work" and
returned OVERFLOW.

| Step | Action |
| --- | --- |
| Result kind | OVERFLOW |
| Inspect the work | Fallback path introduced |
| Continuation admissible? | No (fallback was needed = blocker) |
| Wave state | `needs_revision` |
| Resolution | New packet replaces original; fallback removed; work scoped tighter |
| Original packet | `superseded` |

The fallback would have been `placeholder_success` if accepted.
The methodology refuses; the wave returns to revision.

## Reader Scenario: An Overflow Crosses Into A New Owner Domain

A wave was implementing changes in `runtime/`. Mid-flight, the
worker realized changes are needed in `realm/` for the work to
make sense. Worker stopped at the packet boundary returning
OVERFLOW, having identified the cross-domain need.

| Step | Action |
| --- | --- |
| Result kind | OVERFLOW |
| Owner domain crossed in the analysis | Yes |
| Continuation admissible? | No (new owner domain = blocker) |
| Resolution | Admit a new wave with `realm/` as owner domain; current wave moves to `needs_revision` or `superseded`; new wave deps include this one |

The methodology forces the cross-domain need into the open: a
new wave admits the realm work properly, rather than the runtime
worker silently extending into realm.

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Continuation admitted to "save time" despite blocker present | Soft; reject |
| Continuation crosses owner domain in next packet | Reject; admit new wave |
| Overflow normalized to PASS | False closure; reject |
| Overflow normalized to FAIL | Loss of progress evidence; reject |

## Source Basis

- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
