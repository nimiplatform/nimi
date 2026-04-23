# Reminder Interaction Contract

> Owner Domain: `PO-REMI-*`

## Scope

This contract governs the parent-facing interaction model for reminders delivered by the timeline engine. It is the authority for:

- The `kind` taxonomy that distinguishes one-shot task reminders from read-and-apply guidance, ongoing behavioral practice, and AI consultation events.
- The per-kind progression state machines persisted in `reminder_states` and projected into agenda surfaces.
- The structured `explain` content contract that must accompany every non-task rule.
- The action enumeration the UI and engine are permitted to emit, including the advisor writeback path that resolves `consult` completion.
- The progression-evidence projection that downstream report and journal surfaces may cite.

The timeline engine's eligibility, scheduling, visibility, and agenda-bucket behavior remain governed by `timeline-contract.md`. This contract specifies what happens **after** a reminder has surfaced — how the parent engages with it and how that engagement is recorded.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-002` reminder engine — kind-aware action dispatch
- `PO-FEAT-003` growth timeline — kind-aware row rendering and drawer disclosure
- `PO-FEAT-010` AI growth advisor — consultation writeback binding
- `PO-FEAT-023` / `PO-FEAT-044` / `PO-FEAT-046` growth reports — progression evidence input
- `PO-FEAT-053` reminder progression surface (new; see `feature-matrix.yaml`)

Governing fact sources:

- `tables/reminder-rules.yaml` — rule `kind`, `actionType`, `explain`
- `tables/orthodontic-protocols.yaml` — admitted `PO-ORTHO-*` and `PO-DEN-FOLLOWUP-*` rules participate in this contract as `task` kind only
- `tables/local-storage.yaml#reminder_states` — persisted progression timestamps
- `tables/local-storage.yaml#ai_conversations` — FK target for `consultationConversationId`
- `tables/routes.yaml#/reminders` and `tables/routes.yaml#/advisor` — UI surfaces that render this contract

## PO-REMI-001 Kind Taxonomy

Every admitted reminder rule carries exactly one `kind`:

| Kind | Meaning | Completion character |
|---|---|---|
| `task` | Parent must perform a discrete action: attend a medical appointment, enter a measurement, start a structured training module. | One-shot; `completedAt` is the only terminal signal. |
| `guide` | Parent must read structured guidance and start applying it in daily parenting. | Acknowledged when the parent confirms they've read and intend to apply; optional reflection signal after sustained application. |
| `practice` | Parent must adopt an ongoing behavior (e.g. last-to-speak, listening without correcting, repair after conflict). | Re-entrant; tracked by first-started and last-done timestamps plus a monotonic count, with an optional habituation marker. |
| `consult` | Parent may open an AI advisor conversation anchored to this rule. | Confirmed when the advisor produces its first real assistant reply within the anchored conversation. |

Kind is **required** on every rule. The engine must read `rule.kind` directly and must not infer it from `actionType` or any other field at runtime. Rule authors may not introduce additional kinds; the enum is closed.

## PO-REMI-002 Kind ↔ actionType Binding

`actionType` remains the surface that tells the UI **where** to send the parent (route target, primary button label). `kind` tells the engine **how** completion is modeled. The two are related but not interchangeable; the mapping is authoritative:

| `actionType` | Required `kind` |
|---|---|
| `go_hospital` | `task` |
| `record_data` | `task` |
| `start_training` | `task` |
| `read_guide` | `guide` |
| `observe` | `practice` |
| `ai_consult` | `consult` |

A rule whose `kind` does not match the required value for its `actionType` is a fail-close authoring violation and must be rejected by `check:knowledge-base`.

The mapping is one-way: the UI may read `actionType` to pick a primary button copy and route; the engine must never re-derive `kind` from `actionType` at runtime.

## PO-REMI-003 Progression State Machines

Each kind defines a progression state machine whose states are derived from `reminder_states` timestamp columns. The engine projects one of these states into `ActiveReminder.lifecycle` (see PO-TIME-004). States are **derived**, never persisted as a standalone enum.

### PO-REMI-003.task

```
pending  ─(age reached)─▶  due  ─(complete)─▶  completed
                          │
                          └─(snooze)─▶ snoozed
                          │
                          └─(mark_not_applicable if non-P0)─▶ not_applicable
                          │
                          └─(dismiss_today)─▶ snoozed-today (reappears tomorrow)
```

Terminal signal: `completedAt IS NOT NULL`. No other kind may write `completedAt`.

### PO-REMI-003.guide

```
pending  ─(age reached)─▶  due  ─(acknowledge)─▶  acknowledged
                                                    │
                                                    ├─(reflect, OPTIONAL)─▶ reflected
                                                    │
                                                    └─(snooze / not_applicable / dismiss_today)

acknowledged and reflected both remove the row from today focus.
```

Terminal signal: `acknowledgedAt IS NOT NULL`. `reflectedAt` is a **marker**, not a gate — the engine must treat `acknowledged` and `reflected` as equivalent for agenda suppression. `reflectedAt` exists to trigger downstream journal or report narration (see PO-REMI-009) and to let the parent re-engage with the rule on their own initiative.

### PO-REMI-003.practice

```
pending  ─(age reached)─▶  due  ─(start_practicing)─▶ practicing
                                                       │
                                                       ├─(log_practice, CYCLIC)─▶ practicing (++count, update practiceLastAt)
                                                       │
                                                       └─(mark_habituated)─▶ habituated
                                                       │
                                                       └─(snooze / not_applicable)
```

Terminal signal: `practiceHabituatedAt IS NOT NULL`. Before habituation, the row remains surfaceable with a recomputed resurfacing gap so the parent gets periodic nudges. `log_practice` is cyclic and monotonic: each invocation increments `practiceCount` and updates `practiceLastAt`; it does not change lifecycle state.

### PO-REMI-003.consult

```
pending  ─(age reached)─▶  due  ─(open_advisor)─▶ due (advisor surface opens; no writeback yet)
                                                    │
                                                    │  advisor writes consultedAt + consultationConversationId
                                                    │  ONLY when the AI produces its first assistant reply
                                                    ▼
                                                 consulted
```

Terminal signal: `consultedAt IS NOT NULL AND consultationConversationId IS NOT NULL`. Opening the advisor surface without a completed first reply must not mark the rule consulted. A conversation started for a rule and then abandoned remains `due` until expiry.

## PO-REMI-004 Storage Invariants

The `reminder_states` progression columns (defined in `tables/local-storage.yaml#reminder_states`) have kind-scoped write rules. Violations are fail-close.

| Column | Writeable by kind | Writer |
|---|---|---|
| `completedAt` | `task` only | engine action `complete` |
| `acknowledgedAt` | `guide` only | engine action `acknowledge` |
| `reflectedAt` | `guide` only | engine action `reflect` (requires `acknowledgedAt` non-null) |
| `practiceStartedAt` | `practice` only | engine action `start_practicing` |
| `practiceLastAt` | `practice` only | engine action `log_practice` |
| `practiceCount` | `practice` only | engine action `log_practice` (monotonic, default 0) |
| `practiceHabituatedAt` | `practice` only | engine action `mark_habituated` (requires `practiceStartedAt` non-null) |
| `consultedAt` | `consult` only | advisor module on AI first assistant reply |
| `consultationConversationId` | `consult` only | advisor module; must FK-resolve to `ai_conversations.conversationId` |

Shared columns (`snoozedUntil`, `scheduledDate`, `notApplicable`, `notes`, agenda-stability metadata) remain kind-agnostic and governed by `timeline-contract.md`.

Additional invariants:

- A single `reminder_states` row must not carry two terminal timestamps from different kinds simultaneously.
- `consultedAt` and `consultationConversationId` must be written atomically; one without the other is fail-close.
- `practiceHabituatedAt` without `practiceStartedAt` is fail-close.
- `reflectedAt` without `acknowledgedAt` is fail-close.
- `practiceCount` is never decremented. Admin/debug tooling that resets it must also clear `practiceLastAt` and `practiceHabituatedAt`.

## PO-REMI-005 Action Enumeration

The engine's action dispatcher must accept exactly this discriminated union. Per-kind actions are not interchangeable.

```
ReminderAction =
  | { kind: 'task',     type: 'complete' }
  | { kind: 'guide',    type: 'acknowledge' }
  | { kind: 'guide',    type: 'reflect' }
  | { kind: 'practice', type: 'start_practicing' }
  | { kind: 'practice', type: 'log_practice' }
  | { kind: 'practice', type: 'mark_habituated' }
  | { kind: 'consult',  type: 'open_advisor' }              // no writeback; routing only
  | { kind: '*',        type: 'snooze', until: ISODate }
  | { kind: '*',        type: 'mark_not_applicable' }       // admissibility per PO-REMI-010
  | { kind: '*',        type: 'dismiss_today' }
  | { kind: '*',        type: 'restore' }                   // admin/debug
```

A `consult`-kind `open_advisor` action must not write any timestamp to `reminder_states`. It may write agenda-stability metadata (`lastSurfacedAt`) but must leave all progression columns untouched. The advisor writeback (PO-REMI-007) is the only path permitted to set `consultedAt` / `consultationConversationId`.

A `consult`-kind rule has no client-driven terminal action. This is intentional: opening the advisor is navigation, not completion.

Default snooze duration per kind:

| Kind | Default snooze |
|---|---|
| `task` | 3 days |
| `guide` | 7 days |
| `practice` | 14 days |
| `consult` | 7 days |

## PO-REMI-006 Explain Contract

Every `guide`, `practice`, and `consult` rule must carry a fully-populated `explain` object. A `task` rule may omit `explain` when `title + description` is medically or procedurally self-sufficient, but if an `explain` object is present on a `task` rule, it must still satisfy the shape requirements.

```yaml
explain:
  whyNow:    string                # 2-3 sentences: why this window, what is at stake
  howTo:     array<string>         # 3-6 concrete behavioral steps
  doneWhen:  string                # what "to the point" feels like for this kind
  ifNotNow:  string (optional)     # alternative path if the parent cannot act now
  pitfalls:  array<string> (optional)  # common mistakes the drawer should surface
  sources:   array<{ citation: string, url?: string }>  # non-empty; replaces the flat `source` field
```

Required-field rules:

- `whyNow`, `howTo`, `doneWhen`, `sources` are required for every `guide` / `practice` / `consult` rule.
- `sources[].citation` is required. Citations match the conventions in the prior flat `source:` field (`NIP-2024`, `WHO-2023`, `Gordon-PET`, etc.) but the array form allows multiple co-citations.
- The flat top-level `source:` field on a rule is retired. Every rule's citation metadata must live in `explain.sources[]`.
- `howTo` must contain 3-6 items. Fewer loses the "how" value; more should be split into `pitfalls` or condensed.

Shape mismatches are fail-close under `check:knowledge-base`.

## PO-REMI-007 Consultation Writeback

The `consult` kind binds reminders to advisor conversations. The binding has a strict writeback path:

1. The UI surfaces a `consult`-kind reminder and the parent selects `open_advisor`.
2. The router opens `/advisor` with query parameters `reminderRuleId=<ruleId>&repeatIndex=<n>` and `childId=<childId>`.
3. The advisor surface creates a new `ai_conversations` row. The row's lifecycle is governed by `advisor-contract.md#PO-ADVS-006`.
4. The advisor submits the first user turn and waits for the runtime to produce the first `assistant` message.
5. When the first assistant message is successfully persisted, the advisor module invokes `upsertReminderConsultation(childId, ruleId, repeatIndex, conversationId, now)`. This bridge call writes `consultedAt` and `consultationConversationId` onto the matching `reminder_states` row.
6. The engine's lifecycle mapper observes the new timestamps and projects `lifecycle = consulted` on the next agenda rebuild.

Constraints on the writeback path:

- The writeback must be idempotent: repeated invocation for the same `(childId, ruleId, repeatIndex)` must not overwrite an earlier `consultedAt` with a later timestamp. The first successful writeback wins.
- A conversation started from a non-consult surface (generic advisor entry, profile question) must not perform this writeback even if the user mentions a reminder topic.
- If `ai_conversations` creation fails, no `consultedAt` may be written. Advisor must fall back to structured guidance per `PO-ADVS-003`.
- Deleting the bound `ai_conversations` row is a child-scope cascade event and must clear `consultedAt` and `consultationConversationId` on the corresponding `reminder_states` row (see `PO-ADVS-006` cascade rules and `local-storage.yaml` child deletion cascade list).

## PO-REMI-008 Practice Re-entry

The `practice` kind is re-entrant. After `practiceStartedAt` is first written, the reminder:

- Remains eligible to surface in the today focus or stage focus bucket on a cadence driven by `resurfacingGap(surfaceCount)` (defined in the timeline engine), not by the underlying rule's `repeatRule`.
- Shows the parent a "再做一次" / "log this practice" affordance instead of the initial `start_practicing` affordance.
- On each `log_practice` invocation: `practiceCount += 1`, `practiceLastAt = now`. No other columns change.
- On `mark_habituated`: `practiceHabituatedAt = now`. The row is removed from all surface buckets and may only be re-surfaced by an explicit `restore` admin action.

Row deduplication (see `computeEligibleReminders` in the engine) must not drop a `practice` row once `practiceStartedAt` is set and `practiceHabituatedAt` is null. A `practice` rule with a `repeatRule` uses the rule interval only for the initial trigger window; subsequent eligibility is state-driven, not age-driven.

`practiceCount` is the signal reports may cite (see PO-REMI-009). Zero does not imply failure; it implies the parent has surfaced the guidance without yet re-engaging.

## PO-REMI-009 Progression Evidence Projection

Downstream report and journal surfaces may cite reminder progression. The projection is kind-scoped and must be extracted via a dedicated helper (to be provided by the engine in Wave 4/6) so report prompts and narrative templates never read raw `reminder_states` rows directly.

Allowed evidence phrasing per state:

| Kind state | Narrative phrasing family | Quantified signal |
|---|---|---|
| `task.completed` | "完成了" / "记录了" | `completedAt` date |
| `guide.acknowledged` | "了解了" / "读过了" | `acknowledgedAt` date |
| `guide.reflected` | "回看并反思了" | `reflectedAt` date |
| `practice.practicing` | "开始在实践" / "本周实践了 N 次" | `practiceStartedAt`, `practiceCount`, `practiceLastAt` |
| `practice.habituated` | "已形成习惯" | `practiceHabituatedAt` |
| `consult.consulted` | "和 AI 顾问聊过了" | `consultedAt` date, conversation id for cross-reference |

Evidence extraction must:

- Respect `advisor-contract.md#PO-ADVS-004` safety language — no diagnostic or treatment wording may be layered on top of progression facts.
- Treat `guide.acknowledged` as parent engagement evidence, **not equivalent** to `task.completed`. The two must carry different narrative weight in reports.
- Never fabricate progression signals: if a report cites a reminder, the backing `reminder_states` row must exist and carry the claimed timestamp.
- Exclude rules whose `nurtureMode` projects `hidden` under the current child's mode (see `PO-TIME-003` for exceptions for P0).

Report generators, journal guided prompts, and advisor context snapshots are the three permitted consumers. All three must go through the shared extraction helper.

## PO-REMI-010 Mark-Not-Applicable and Dismiss-Today Admissibility

`mark_not_applicable` is admissible for:

- every `guide` rule
- every `practice` rule
- every `consult` rule
- every non-P0 `task` rule

It is **not** admissible for P0 `task` rules. This preserves the P0 delivery floor from `PO-TIME-003`.

`dismiss_today` is admissible for every kind regardless of priority. Dismissal writes `dismissedAt = today` and `dismissReason = 'today'`; the row reappears on the next agenda rebuild on a later date.

Neither action writes any progression timestamp. A `mark_not_applicable` row retains whatever progression timestamps were previously set but is suppressed from all surface buckets until `restore` is invoked.

## PO-REMI-011 Drawer Disclosure Contract

The ReminderExplainDrawer surface (registered under `PO-FEAT-053`) is the authoritative parent-facing disclosure of a reminder's `explain` content. Its rendering rules:

- The drawer must render every non-empty `explain` section in the order defined in PO-REMI-006.
- Empty-but-required sections are a fail-close authoring error; the drawer must not silently hide them. Instead, if a rule enters the drawer with missing `whyNow`, `howTo`, `doneWhen`, or `sources`, the drawer must display a structured placeholder ("指南正在完善") and disable the primary progression button.
- Optional sections (`ifNotNow`, `pitfalls`) render only when present.
- The drawer's footer primary button is dispatched per kind and per current progression state. For example:
  - `guide` at `due` → `我已了解`
  - `guide` at `acknowledged` → `我已开始实践` (writes `reflectedAt` — see PO-REMI-003.guide reflection semantics; UI label may differ from `reflect` as long as it writes the correct timestamp)
  - `practice` at `due` → `开始实践`
  - `practice` at `practicing` → `再做一次` (primary) + `已成为习惯` (secondary)
  - `consult` at `due` → `问问 AI 顾问` (opens advisor route, no writeback)
  - `task` at `due` → kind-specific action based on `actionType` (`记录疫苗`, `去体检`, `记录数据`, `开始训练`)
- The drawer must not offer `complete` for non-task kinds. The check-circle affordance on row-level rendering is task-only.
- Source citations must render as plain text (citation key + optional external link). Source URLs must open in the system browser, never inline in the drawer.

## PO-REMI-012 Fail-Close Behaviors

The reminder interaction layer must fail closed when:

- A rule's `kind` value does not match the required mapping for its `actionType` (PO-REMI-002).
- A `guide` / `practice` / `consult` rule is missing any required `explain` field (PO-REMI-006).
- A `consult` reminder has `consultedAt` set without a matching `consultationConversationId`, or vice versa (PO-REMI-004).
- A `practice` reminder has `practiceHabituatedAt` set without `practiceStartedAt`, or `guide` has `reflectedAt` without `acknowledgedAt` (PO-REMI-004).
- An action dispatcher receives a `(kind, type)` combination outside the PO-REMI-005 union.
- The advisor writeback receives a `(childId, ruleId, repeatIndex)` triple that does not resolve to an existing `reminder_states` row.
- A progression evidence extractor is asked to cite a reminder whose backing row is missing or carries no terminal timestamp for its kind.
- The drawer is opened for a rule whose `explain` fails PO-REMI-011 shape requirements while the rule is admitted under W2 content migration.

## Exclusions

The following remain outside this contract:

- Eligibility, scheduling, age-gating, agenda bucketing, cold-start catch-up — see `timeline-contract.md`.
- Advisor prompt strategy selection and snapshot assembly — see `advisor-contract.md`.
- Custom user-authored todos (`custom_todos` table) — they remain a separate surface and do not participate in the `kind` taxonomy.
- Observation nudges sourced from `observation-framework.yaml` — they are diagnostic (watching the child), not prescriptive (changing parent behavior), and remain a separate surface even though they visually sit near `practice`-kind reminders.
- Orthodontic protocol reminders (`PO-ORTHO-*`) and dental follow-up reminders (`PO-DEN-FOLLOWUP-*`) — they participate as `task` kind only. Their authority home remains `orthodontic-protocols.yaml` and `orthodontic-contract.md`.
