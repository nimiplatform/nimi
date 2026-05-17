# How To Admit A Wave

You have a topic in `ongoing` state. You want to admit a new
wave under it.

## Recipe

1. **Confirm topic state.** `topic.yaml` shows `state: ongoing`.
   If `pending`, move to `ongoing` first (or admit a remediation
   wave that justifies reactivating).
2. **Authoritative wave id.** Compose `wave_id` following
   `wave-N-<slug>` pattern; ensure no collision with existing
   waves in this topic.
3. **Add wave entry to `topic.yaml`.** Required fields:
   - `wave_id`, `slug`, `state` (start as `candidate`)
   - `primary_closure_goal` (one paragraph)
   - `deps` (list of prior closed waves this depends on; can
     be empty)
   - `owner_domain` (one primary owner domain)
   - `parallelizable_after` (one of admitted values)
   - `selected: true` (if this is now the active wave)
4. **At most one selected wave.** Set previously-selected wave's
   `selected: false`.
5. **Author packet artifact.** Use a wave-qualified packet id and
   filename, for example `packet-wave-2-content-rewrite.md`. Required
   fields are `packet_id`, `topic_id`, `wave_id`, `packet_kind`,
   `status`, `authority_owner`, `canonical_seams`,
   `forbidden_shortcuts`, `acceptance_invariants`, `negative_tests`,
   and `reopen_conditions`. For worker-bound packets, also include
   `allowed_reads` and `allowed_writes` so the execution boundary is
   explicit.
6. **Run preflight.** `preflight-result-<wave_id>.md` with
   verdict.
7. **If authority convergence gate fires** (packet kind is
   `authority`/`spec`/`redesign`/`preflight` or refs
   `.nimi/spec/`): run pre-implementation audit; record
   `result_kind: audit, verdict: PASS`.
8. **Update wave state.** `state: candidate → admitted` in
   `topic.yaml` once preflight (and audit, if required) PASS.
9. **Update `topic.yaml.last_transition_reason`.** Concise
   reason like `wave-2-foo-admitted_after_pre_audit_pass`.

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Two waves both `selected: true` | Reject; only one selected at a time |
| Wave admitted without preflight | Reject; preflight is the stop-line |
| Wave touches `.nimi/spec/` without pre-audit | Reject; authority convergence gate must fire |
| `deps` references a wave id that does not exist | Reject; deps must be real |
| `owner_domain` says multiple domains | Reject; one primary owner per packet |
| Packet id omits the wave identity | Reject; generated `packet-*.md` names can become ambiguous |

## Reader Scenario

You are managing a docs remediation topic. Wave-1 closed; user
accepted; wave-2 needs admission.

| Step | Output |
| --- | --- |
| Confirm topic ongoing | Yes |
| Wave id `wave-2-content-rewrite` | Composed |
| Add to topic.yaml | `state: candidate, selected: true` |
| Set wave-1 selected: false | Done |
| Author packet | All required fields present |
| Preflight PASS | Recorded |
| No spec touch → no auth convergence required | OK |
| Move state to admitted | Done |
| `last_transition_reason` updated | "wave-2-content-rewrite_admitted_after_user_acceptance_of_wave_1" |

Wave-2 is now ready for dispatch.

## Source Basis

- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle.yaml)
- [`nimi-coding/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/wave-dag-policy.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
