// Pure deterministic milestone rule evaluators.
//
// Per `packet-wave-a-detail-projection.md`:
//   - NO inline metric ids, threshold values, or rule ids — all consumed
//     from GROWTH_MILESTONE_RULES (re-exported from knowledge-base/index.ts).
//   - NO Date.now() — `nowIso` flows through every signature that needs
//     current time.
//   - NO Math.random() — milestoneId is a deterministic ULID-like 26-char
//     Crockford-base32 string derived from a hash of
//     (ruleId, evidenceEventIds.sort().join(',')).
//   - NO import of react / react-dom / recharts / runtime.ai.* / sdk
//     runtime / sqlite-bridge.
//
// ULID seeding approach: ParentOS's existing `ulid()` helper in
// `bridge/ulid.ts` uses `Date.now()` + `Math.random()` and is not
// deterministic. Since this module forbids both, we synthesize a
// ULID-shaped 26-char Crockford-base32 string from a 128-bit FNV-1a-style
// rolling hash over the seed. This is not a real time-ordered ULID, but it
// is reproducible from the same seed and matches the 26-char Crockford
// alphabet contract that ParentOS's other ULIDs satisfy. Wave-B/C/D treat
// these as opaque strings.

import {
  GROWTH_MILESTONE_RULES,
  type GrowthMilestoneRule,
  type GrowthMilestoneThresholdCrossedTrigger,
  type GrowthMilestoneRelativeChangeTrigger,
} from '../../knowledge-base/index.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface HistoryPoint {
  eventId: string;
  measuredAt: string; // ISO 8601
  ageMonths: number;
  value: number;
  metricId: string;
}

export interface GrowthMilestone {
  milestoneId: string; // deterministic ULID-shaped id, see header
  ruleId: GrowthMilestoneRule['ruleId'];
  kind: GrowthMilestoneRule['kind'];
  // 'positive' for growth achievements (height thresholds, weight rises);
  // 'negative' for cautionary nodes (weight drops) the parent surface marks
  // distinctly. Descriptive of recorded data only — carries no diagnosis.
  polarity: 'positive' | 'negative';
  deltaMagnitudeDisplay: string;
  deltaUnitLabel: string;
  title: string;
  detailLine: string;
  occurredAt: string;
  evidenceEventIds: string[];
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

function makeMilestoneId(ruleId: string, evidenceEventIds: readonly string[]): string {
  const seed = `${ruleId}|${[...evidenceEventIds].sort().join(',')}`;
  // 128-bit FNV-1a-inspired rolling hash split across two 64-bit lanes so
  // we have ~26*5 = 130 bits of entropy to map onto Crockford-base32.
  let hi = 0xcbf29ce4n;
  let lo = 0x84222325n;
  for (let i = 0; i < seed.length; i++) {
    const codePoint = BigInt(seed.charCodeAt(i));
    lo = (lo ^ codePoint) & 0xffffffffffffffffn;
    lo = (lo * 0x100000001b3n) & 0xffffffffffffffffn;
    hi = (hi ^ (lo >> 32n)) & 0xffffffffffffffffn;
    hi = (hi * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // Concatenate the two 64-bit lanes into a 128-bit value, then encode as
  // 26 base-32 characters (130 bits of address space; the top bits are 0).
  let combined = (hi << 64n) | lo;
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = ULID_ALPHABET[Number(combined & 31n)] + out;
    combined >>= 5n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// History filtering helpers
// ---------------------------------------------------------------------------

function historyWithinWindow(
  history: readonly HistoryPoint[],
  evidenceWindowMonths: number | null,
  nowIso: string,
): HistoryPoint[] {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return [];
  // Use 30.436875 days/month (average month length, Gregorian) so the
  // boundary is well-defined and not subject to calendar drift between
  // months. A null window means "no lower bound" — surfaces that list every
  // milestone the record ever crossed (the history table) pass null, while
  // the hero timeline keeps each rule's trailing window.
  const cutoff = evidenceWindowMonths == null
    ? Number.NEGATIVE_INFINITY
    : nowMs - evidenceWindowMonths * 30.436875 * 86400000;
  return history
    .filter((point) => {
      const ms = Date.parse(point.measuredAt);
      if (Number.isNaN(ms)) return false;
      return ms >= cutoff && ms <= nowMs;
    })
    .slice()
    .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt));
}

function filterByMetric(
  history: readonly HistoryPoint[],
  appliesToMetricIds: readonly string[],
): HistoryPoint[] {
  const allow = new Set(appliesToMetricIds);
  return history.filter((point) => allow.has(point.metricId));
}

// ---------------------------------------------------------------------------
// Template fill helpers
// ---------------------------------------------------------------------------

function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key]);
    }
    return match;
  });
}

function roundDelta(delta: number): number {
  return Math.round(delta * 10) / 10;
}

// ---------------------------------------------------------------------------
// evaluateThresholdCrossed
// ---------------------------------------------------------------------------

export function evaluateThresholdCrossed(
  rule: GrowthMilestoneRule & { triggerCondition: GrowthMilestoneThresholdCrossedTrigger },
  history: readonly HistoryPoint[],
  nowIso: string,
  fullHistory = false,
): GrowthMilestone | null {
  const trigger = rule.triggerCondition;
  const points = historyWithinWindow(
    filterByMetric(history, rule.appliesToMetricIds),
    fullHistory ? null : trigger.evidenceWindowMonths,
    nowIso,
  );
  if (points.length === 0) return null;

  // Find the first point in the window that crosses the threshold in the
  // configured direction. "Crossing" requires a prior point on the other
  // side; if the earliest in-window point is already past the threshold we
  // do not count it (no observable cross).
  for (let i = 1; i < points.length; i++) {
    const prior = points[i - 1]!;
    const current = points[i]!;
    const crossedUp =
      trigger.direction === 'upward' &&
      prior.value < trigger.thresholdValue &&
      current.value >= trigger.thresholdValue;
    const crossedDown =
      trigger.direction === 'downward' &&
      prior.value > trigger.thresholdValue &&
      current.value <= trigger.thresholdValue;
    if (!crossedUp && !crossedDown) continue;

    const evidenceEventIds = [prior.eventId, current.eventId];
    const yearAgoMs = Date.parse(current.measuredAt) - 365 * 86400000;
    const earliestBeforeYear = [...history]
      .filter((p) => p.metricId === current.metricId)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
      .find((p) => Date.parse(p.measuredAt) >= yearAgoMs);
    const priorYearValue = earliestBeforeYear?.value ?? prior.value;
    const deltaSinceLastYear = roundDelta(current.value - priorYearValue);

    return {
      milestoneId: makeMilestoneId(rule.ruleId, evidenceEventIds),
      ruleId: rule.ruleId,
      kind: rule.kind,
      // Threshold crossings are always upward growth achievements.
      polarity: 'positive',
      title: fillTemplate(rule.titleTemplate, {
        thresholdValue: trigger.thresholdValue,
        thresholdUnit: trigger.thresholdUnit,
      }),
      deltaMagnitudeDisplay: fillTemplate(rule.deltaMagnitudeTemplate, {
        deltaSinceLastYearRounded: deltaSinceLastYear,
      }),
      deltaUnitLabel: rule.deltaUnitLabel,
      detailLine: `${current.measuredAt.slice(0, 10)} · ${current.value} ${trigger.thresholdUnit}`,
      occurredAt: current.measuredAt,
      evidenceEventIds,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// evaluateRelativeChange
// ---------------------------------------------------------------------------

// Emits a node for every consecutive measurement pair whose relative change
// meets the rule's `changePercent` in the configured direction. Unlike
// threshold crossings, one relative-change rule can yield multiple nodes
// across a long history. The comparison is point-to-point: each measurement
// versus the one immediately preceding it.
export function evaluateRelativeChange(
  rule: GrowthMilestoneRule & { triggerCondition: GrowthMilestoneRelativeChangeTrigger },
  history: readonly HistoryPoint[],
  nowIso: string,
  fullHistory = false,
): GrowthMilestone[] {
  const trigger = rule.triggerCondition;
  const points = historyWithinWindow(
    filterByMetric(history, rule.appliesToMetricIds),
    fullHistory ? null : trigger.evidenceWindowMonths,
    nowIso,
  );
  const out: GrowthMilestone[] = [];
  for (let i = 1; i < points.length; i++) {
    const prior = points[i - 1]!;
    const current = points[i]!;
    if (prior.value <= 0) continue;
    const changePct = ((current.value - prior.value) / prior.value) * 100;
    const matches =
      (trigger.direction === 'upward' && changePct >= trigger.changePercent) ||
      (trigger.direction === 'downward' && changePct <= -trigger.changePercent);
    if (!matches) continue;

    const evidenceEventIds = [prior.eventId, current.eventId];
    const changeMagnitude = Math.abs(Math.round(changePct));
    const deltaValueRounded = Math.abs(roundDelta(current.value - prior.value));
    out.push({
      milestoneId: makeMilestoneId(rule.ruleId, evidenceEventIds),
      ruleId: rule.ruleId,
      kind: rule.kind,
      // A downward swing is the cautionary node the parent surface flags;
      // an upward swing is a positive node. Descriptive only.
      polarity: trigger.direction === 'downward' ? 'negative' : 'positive',
      title: fillTemplate(rule.titleTemplate, { changeMagnitude }),
      deltaMagnitudeDisplay: fillTemplate(rule.deltaMagnitudeTemplate, { deltaValueRounded }),
      deltaUnitLabel: rule.deltaUnitLabel,
      detailLine: `${current.measuredAt.slice(0, 10)} · ${current.value} ${trigger.valueUnit}`,
      occurredAt: current.measuredAt,
      evidenceEventIds,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// evaluateAllMilestones — public dispatch entrypoint
// ---------------------------------------------------------------------------

export function evaluateAllMilestones(
  history: readonly HistoryPoint[],
  nowIso: string,
  fullHistory = false,
): GrowthMilestone[] {
  const out: GrowthMilestone[] = [];
  // Iterate in a stable order — GROWTH_MILESTONE_RULES is declared in YAML
  // order and frozen at generate time, so the loop order is deterministic.
  for (const rule of GROWTH_MILESTONE_RULES) {
    try {
      const triggerType = rule.triggerCondition.type;
      if (triggerType === 'threshold_cross') {
        const milestone = evaluateThresholdCrossed(
          rule as GrowthMilestoneRule & { triggerCondition: GrowthMilestoneThresholdCrossedTrigger },
          history,
          nowIso,
          fullHistory,
        );
        if (milestone) out.push(milestone);
      } else if (triggerType === 'relative_change') {
        out.push(
          ...evaluateRelativeChange(
            rule as GrowthMilestoneRule & { triggerCondition: GrowthMilestoneRelativeChangeTrigger },
            history,
            nowIso,
            fullHistory,
          ),
        );
      }
      // Any other trigger type has no admitted evaluator yet — PO-GROWTH-
      // DETAIL-009: skip it rather than crashing the surface.
    } catch {
      // PO-GROWTH-DETAIL-009: a rule that throws during evaluation is
      // skipped so the surface fails closed for that rule without crashing
      // the whole projection.
    }
  }
  // Sort by occurredAt ascending for deterministic order across runs; ruleId
  // breaks ties when two crossings land on the same date.
  out.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.ruleId.localeCompare(b.ruleId),
  );
  return out;
}
