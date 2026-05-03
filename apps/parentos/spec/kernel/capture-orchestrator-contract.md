# Capture Orchestrator Contract

> Owner Domain: `PO-CAPT-*`

## Scope

This contract governs the unified ParentOS health data capture path. All
structured health data entry routes through the capture orchestrator after the
health record console hard cut. The orchestrator unifies the path and
transaction semantics; storage target is still selected by the canonical
capture protocol so retained stateful domains do not become dual-written.

The orchestrator owns intent shape, protocol selection, dynamic fields,
validation, save transaction semantics, reminder-linked completion, and
post-save behavior. It does not own reminder eligibility or console projection.

Governing fact sources:

- `tables/health-capture-protocols.yaml`
- `tables/health-metric-registry.yaml`
- `tables/reminder-capture-targets.yaml`
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#health_record_values`
- `health-record-console-contract.md`
- `reminder-interaction-contract.md`

## PO-CAPT-001 Capture Intent

Every capture entry point creates a typed `CaptureIntent`.

```text
CaptureIntent {
  intentId
  origin:
    profile_add_icon |
    metric_row |
    reminder |
    detail_page |
    ocr_confirm
  childId
  groupId
  captureProtocolId
  metricIds
  recordedAtDefault
  source: manual | ocr | imported | reminder
  linkedReminder: null | { childId, ruleId, repeatIndex }
  prefillValues
  postSaveBehavior
}
```

The orchestrator must reject an intent whose protocol or metric ids do not
resolve in canonical tables.

## PO-CAPT-002 Modes

The modal supports exactly these modes:

| Mode | Origin |
|---|---|
| `manual` | independent profile add-data icon |
| `prefilled` | metric row or detail page |
| `guided` | multi-metric protocol selected by parent |
| `reminder` | `record_data` reminder with a capture target |
| `ocr_confirm` | OCR candidates requiring parent confirmation |

A flat mega-dropdown is not an admitted capture model. Selection must be
group-to-protocol or group-to-metric-set.

## PO-CAPT-003 Protocol Binding

`tables/health-capture-protocols.yaml` defines required fields, optional fields,
metric ids, value types, validation, and completion semantics for every
protocol.

The UI may render fields from the protocol. It must not invent fields or save
values outside the protocol.

## PO-CAPT-004 Save Transaction

A save is successful only when all required writes complete in one logical
transaction:

1. Validate child, protocol, metric ids, units, value types, side semantics, and
   recorded date.
2. Resolve the protocol `storageTarget`.
3. For `storageTarget=health_record_event`, persist one `health_record_events`
   row and all required `health_record_values` rows.
4. For `storageTarget=retained_table`, persist exactly one owner-contract row
   in the retained table named by the protocol/domain and do not also write a
   parallel health record event.
5. Compute required derived metrics such as BMI from admitted source values.
6. Persist derived values through the same transaction or a deterministic
   post-save rebuild named by the protocol.
7. Rebuild or invalidate the health record console snapshot.
8. If linked to a `record_data` reminder, complete the reminder only after the
   saved record satisfies the reminder target.

Validation or persistence failure must surface as failure. It must not create a
placeholder row or mark a reminder complete.

## PO-CAPT-005 Reminder-Linked Completion

When `origin=reminder`, the intent must include `linkedReminder`.

The orchestrator must load the reminder target from
`tables/reminder-capture-targets.yaml`. It must not infer required metrics from
button copy, route path, or reminder prose.

`completedAt` can be written only after the persisted event satisfies the
target's completion policy.

## PO-CAPT-006 Detail Page Interaction

Detail pages may open the orchestrator with `prefilled` mode. Detail pages must
not keep independent add-data save paths after PO-CAPT admission.

## PO-CAPT-007 OCR Confirmation

OCR intake is extraction-only until the parent confirms values. OCR candidates
must map to canonical metric ids and capture protocols. Unsupported candidates
must be rejected or shown as non-importable.

## PO-CAPT-008 Fail-Close Behaviors

The orchestrator must fail closed when:

- an intent lacks a valid child id
- a protocol id is not present in `health-capture-protocols.yaml`
- a metric id is not present in `health-metric-registry.yaml`
- a required field is missing
- a value cannot be coerced to the protocol's declared value type
- a protocol lacks a storage target, or its retained-table target has no owner contract
- a left/right pair protocol receives only one side when both are required
- a reminder-linked save does not satisfy the reminder target
- an OCR candidate attempts to auto-save without parent confirmation
- a detail page bypasses the orchestrator
