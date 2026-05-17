/**
 * Dispatch helper for orthodontic-protocol record_data reminders surfaced in
 * the dashboard 待办事项 panel.
 *
 * Orthodontic record_data rules (PO-ORTHO-EXPANDER-ACTIVATION,
 * PO-ORTHO-ALIGNER-CHANGE, PO-ORTHO-UNWEAR-OPEN) deliberately do NOT live in
 * `reminder-capture-targets.yaml` — their capture surface is the per-appliance
 * orthodontic modal stack (see `orthodontic-protocols.yaml` constraint
 * "Orthodontic protocol actionType=record_data rules are governed by
 * orthodontic-protocols.yaml checkinType bindings and must not be duplicated
 * here.").
 *
 * The reminder_state row's `notes` column carries the appliance binding in the
 * shape `[ortho-protocol] applianceId={id}` (with optional `; intervalId={id}`
 * for unwear-open), written by the Rust protocol-reminder seeder
 * (`orthodontic_protocol_reminders.inc.rs`). This helper parses that binding
 * so the dashboard can route the click to the correct existing modal without
 * navigating away from the home surface.
 */

import type { ActiveReminder } from '../../engine/reminder-engine.js';

export type OrthodonticReminderKind =
  | 'expander-activation'
  | 'aligner-change'
  | 'unwear-open';

const RULE_KIND_MAP: Readonly<Record<string, OrthodonticReminderKind>> = {
  'PO-ORTHO-EXPANDER-ACTIVATION': 'expander-activation',
  'PO-ORTHO-ALIGNER-CHANGE': 'aligner-change',
  'PO-ORTHO-UNWEAR-OPEN': 'unwear-open',
};

export const ORTHODONTIC_RECORD_DATA_RULE_IDS: ReadonlySet<string> = new Set(
  Object.keys(RULE_KIND_MAP),
);

export function isOrthodonticRecordDataReminder(
  reminder: Pick<ActiveReminder, 'rule'>,
): boolean {
  return ORTHODONTIC_RECORD_DATA_RULE_IDS.has(reminder.rule.ruleId);
}

export interface OrthodonticReminderBinding {
  kind: OrthodonticReminderKind;
  applianceId: string;
  /** Present only for `unwear-open`; the open wear-gap interval to close. */
  intervalId: string | null;
}

/**
 * Parses the orthodontic appliance binding written by the Rust seeder into the
 * reminder_state notes column. Returns null when the reminder is not an
 * orthodontic record_data reminder; throws when the binding is missing or
 * malformed (fail-close per PO-ORTHO-001: the surface must not invent an
 * applianceId).
 */
export function parseOrthodonticReminderBinding(
  reminder: ActiveReminder,
): OrthodonticReminderBinding | null {
  const kind = RULE_KIND_MAP[reminder.rule.ruleId];
  if (!kind) return null;

  const notes = reminder.state?.notes ?? null;
  if (!notes) {
    throw new Error(
      `Orthodontic reminder ${reminder.rule.ruleId} has no reminder_state.notes binding`,
    );
  }
  const applianceMatch = /applianceId=([^;\s]+)/.exec(notes);
  const applianceId = applianceMatch?.[1];
  if (!applianceId) {
    throw new Error(
      `Orthodontic reminder ${reminder.rule.ruleId} notes missing applianceId: ${notes}`,
    );
  }
  const intervalMatch = /intervalId=([^;\s]+)/.exec(notes);
  const intervalId = intervalMatch?.[1] ?? null;

  return { kind, applianceId, intervalId };
}
