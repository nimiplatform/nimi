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
  type GrowthMilestoneMeasurementDensityTrigger,
  type GrowthMilestonePercentileShiftTrigger,
  type GrowthMilestoneThresholdCrossedTrigger,
} from '../../knowledge-base/index.js';
import type { WHOLMSDataset } from './who-lms-loader.js';
import { computeApproxPercentile } from './growth-curve-page-shared.js';

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
  evidenceWindowMonths: number,
  nowIso: string,
): HistoryPoint[] {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return [];
  // Use 30.436875 days/month (average month length, Gregorian) so the
  // boundary is well-defined and not subject to calendar drift between
  // months.
  const windowMs = evidenceWindowMonths * 30.436875 * 86400000;
  const cutoff = nowMs - windowMs;
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
): GrowthMilestone | null {
  const trigger = rule.triggerCondition;
  const points = historyWithinWindow(
    filterByMetric(history, rule.appliesToMetricIds),
    trigger.evidenceWindowMonths,
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
// evaluatePercentileShift
// ---------------------------------------------------------------------------

export function evaluatePercentileShift(
  rule: GrowthMilestoneRule & { triggerCondition: GrowthMilestonePercentileShiftTrigger },
  history: readonly HistoryPoint[],
  whoDataset: WHOLMSDataset | null,
  nowIso: string,
): GrowthMilestone | null {
  if (!whoDataset) return null;
  const trigger = rule.triggerCondition;
  const points = historyWithinWindow(
    filterByMetric(history, rule.appliesToMetricIds),
    trigger.evidenceWindowMonths,
    nowIso,
  );
  if (points.length < 2) return null;

  const earliest = points[0]!;
  const latest = points[points.length - 1]!;
  const startPercentile = computeApproxPercentile(earliest.value, earliest.ageMonths, whoDataset);
  const endPercentile = computeApproxPercentile(latest.value, latest.ageMonths, whoDataset);
  if (startPercentile == null || endPercentile == null) return null;

  const delta = endPercentile - startPercentile;
  const matchesUp = trigger.direction === 'upward' && delta >= trigger.minMagnitudePoints;
  const matchesDown = trigger.direction === 'downward' && -delta >= trigger.minMagnitudePoints;
  if (!matchesUp && !matchesDown) return null;

  const evidenceEventIds = [earliest.eventId, latest.eventId];
  return {
    milestoneId: makeMilestoneId(rule.ruleId, evidenceEventIds),
    ruleId: rule.ruleId,
    kind: rule.kind,
    title: fillTemplate(rule.titleTemplate, {
      startPercentile,
      endPercentile,
    }),
    deltaMagnitudeDisplay: fillTemplate(rule.deltaMagnitudeTemplate, {
      magnitudePoints: Math.abs(delta),
    }),
    deltaUnitLabel: rule.deltaUnitLabel,
    detailLine: `${earliest.measuredAt.slice(0, 10)} → ${latest.measuredAt.slice(0, 10)}`,
    occurredAt: latest.measuredAt,
    evidenceEventIds,
  };
}

// ---------------------------------------------------------------------------
// evaluateMeasurementDensity
// ---------------------------------------------------------------------------

export function evaluateMeasurementDensity(
  rule: GrowthMilestoneRule & { triggerCondition: GrowthMilestoneMeasurementDensityTrigger },
  history: readonly HistoryPoint[],
  nowIso: string,
): GrowthMilestone | null {
  const trigger = rule.triggerCondition;
  const points = historyWithinWindow(
    filterByMetric(history, rule.appliesToMetricIds),
    trigger.evidenceWindowMonths,
    nowIso,
  );
  if (points.length < trigger.minCount) return null;

  // Find any contiguous window of `windowDays` containing >= minCount points.
  const sorted = [...points].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const windowMs = trigger.windowDays * 86400000;
  for (let i = 0; i + trigger.minCount - 1 < sorted.length; i++) {
    const head = sorted[i]!;
    const tail = sorted[i + trigger.minCount - 1]!;
    const headMs = Date.parse(head.measuredAt);
    const tailMs = Date.parse(tail.measuredAt);
    if (Number.isNaN(headMs) || Number.isNaN(tailMs)) continue;
    if (tailMs - headMs <= windowMs) {
      const slice = sorted.slice(i, i + trigger.minCount);
      const evidenceEventIds = slice.map((p) => p.eventId);
      return {
        milestoneId: makeMilestoneId(rule.ruleId, evidenceEventIds),
        ruleId: rule.ruleId,
        kind: rule.kind,
        title: fillTemplate(rule.titleTemplate, {}),
        deltaMagnitudeDisplay: fillTemplate(rule.deltaMagnitudeTemplate, {
          count: slice.length,
        }),
        deltaUnitLabel: rule.deltaUnitLabel,
        detailLine: `${head.measuredAt.slice(0, 10)} → ${tail.measuredAt.slice(0, 10)}`,
        occurredAt: tail.measuredAt,
        evidenceEventIds,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// evaluateAllMilestones — public dispatch entrypoint
// ---------------------------------------------------------------------------

export function evaluateAllMilestones(
  history: readonly HistoryPoint[],
  whoDataset: WHOLMSDataset | null,
  nowIso: string,
): GrowthMilestone[] {
  const out: GrowthMilestone[] = [];
  // Iterate in a stable order — GROWTH_MILESTONE_RULES is declared in YAML
  // order and frozen at generate time, so the loop order is deterministic.
  for (const rule of GROWTH_MILESTONE_RULES) {
    let milestone: GrowthMilestone | null = null;
    try {
      if (rule.kind === 'threshold_crossed') {
        milestone = evaluateThresholdCrossed(
          rule as GrowthMilestoneRule & { triggerCondition: GrowthMilestoneThresholdCrossedTrigger },
          history,
          nowIso,
        );
      } else if (rule.kind === 'percentile_shift') {
        milestone = evaluatePercentileShift(
          rule as GrowthMilestoneRule & { triggerCondition: GrowthMilestonePercentileShiftTrigger },
          history,
          whoDataset,
          nowIso,
        );
      } else if (rule.kind === 'measurement_density') {
        milestone = evaluateMeasurementDensity(
          rule as GrowthMilestoneRule & { triggerCondition: GrowthMilestoneMeasurementDensityTrigger },
          history,
          nowIso,
        );
      }
    } catch {
      // PO-GROWTH-DETAIL-009: a rule that throws during evaluation is
      // skipped so the surface fails closed for that rule without crashing
      // the whole projection.
      milestone = null;
    }
    if (milestone) out.push(milestone);
  }
  // Sort by occurredAt ascending for deterministic order across runs.
  out.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.ruleId.localeCompare(b.ruleId));
  return out;
}
