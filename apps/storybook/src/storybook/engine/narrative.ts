// App-local narrative engine (wave-8). The records live in run.ts; this module is
// the ENGINE LOGIC: the guarded turn pipeline and the append-only spine.
//
//   intent -> assembly -> generate -> guard -> write-spine
//
// Ownership: Storybook owns the spine, turn records, run envelope, and snapshots.
// Runtime may EXECUTE the model call inside the injected `generate` callback, but it
// never owns these records — this module has no Runtime/SDK import. Guard is
// fail-closed: REJECTED writes no spine; ADJUSTED persists the adjusted output plus
// the adjustment reason; APPROVED writes as-is. The spine is append-only with
// optimistic write-conflict detection.

import { mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';
import {
  type AgentTurnRequest,
  type NarrativeContextProjection,
  type NarrativeCoreOutput,
  type SpineEvent,
  type EngineGuardResult,
  type GuardStatus,
  type NarrativeTurnRecord,
  validateNarrativeCoreOutput,
} from './run.js';

export const MAX_SPINE_EVENTS_PER_TURN = 8;

export type SeqSpineEvent = SpineEvent & { seq: number };

/** Append-only run narrative history. seq is monotonic and gap-free. */
export type NarrativeSpine = {
  runId: string;
  events: SeqSpineEvent[];
};

export function createSpine(runId: string): NarrativeSpine {
  return { runId, events: [] };
}

export type GuardInput = {
  candidate: NarrativeCoreOutput;
  context: NarrativeContextProjection;
  /** Private fact strings that must never surface in spine text. */
  privateFacts?: string[];
  /** Known state targets (variable/flag ids); unknown targets are dropped (ADJUSTED). */
  knownStateTargets?: string[];
  maxSpineEvents?: number;
};

export type GuardOutcome = { result: EngineGuardResult; output: NarrativeCoreOutput | null };

function reject(reasonCode: string, actionHint: string): GuardOutcome {
  return { result: { status: 'REJECTED', reasonCode, actionHint }, output: null };
}

/**
 * The guard. Order: context sufficiency -> CoreOutput whitelist -> private-fact
 * visibility -> event-count bound -> state-target contradiction. The first two and
 * the visibility check fail-close (REJECTED, no spine). Over-count and unknown
 * targets are repaired (ADJUSTED) with a recorded reason.
 */
export function runGuard(input: GuardInput): GuardOutcome {
  const { candidate, context } = input;

  // 1. context sufficiency — CANON and STORY must be covered.
  if (context.scopes.canon.length === 0 || context.scopes.story.length === 0) {
    return reject('narrative_context_insufficient', '为该回合补全 CANON 与 STORY 上下文后重试。缺失上下文不会被降级为部分成功。');
  }

  // 2. CoreOutput whitelist (spineEvents / stateChanges / metrics only).
  const whitelist = validateNarrativeCoreOutput(candidate);
  if (whitelist.length > 0) {
    return reject('narrative_core_output_invalid', whitelist.map((f) => f.message).join('; '));
  }

  // 3. visibility — no private fact may appear in any spine event text.
  const privateFacts = (input.privateFacts ?? []).map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (privateFacts.length > 0) {
    for (const event of candidate.spineEvents) {
      const text = event.text.toLowerCase();
      if (privateFacts.some((priv) => text.includes(priv))) {
        return reject('narrative_guard_rejected', '生成内容泄露了角色私密事实，已拒绝并未写入 spine。');
      }
    }
  }

  // 4 & 5. repairs collected as ADJUSTED.
  const reasons: string[] = [];
  let events = candidate.spineEvents;
  const max = input.maxSpineEvents ?? MAX_SPINE_EVENTS_PER_TURN;
  if (events.length > max) {
    events = events.slice(0, max);
    reasons.push(`spine 事件数超过上限 ${max}，已截断。`);
  }
  let stateChanges = candidate.stateChanges;
  if (input.knownStateTargets) {
    const known = new Set(input.knownStateTargets);
    const filtered = stateChanges.filter((change) => known.has(change.target));
    if (filtered.length !== stateChanges.length) {
      reasons.push('丢弃了指向未知状态目标的 stateChange（防止 retcon）。');
      stateChanges = filtered;
    }
  }

  if (reasons.length > 0) {
    return {
      result: { status: 'ADJUSTED', reasonCode: 'narrative_guard_adjusted', actionHint: reasons.join(' ') },
      output: { spineEvents: events, stateChanges, metrics: candidate.metrics },
    };
  }
  return { result: { status: 'APPROVED' }, output: candidate };
}

/**
 * Append guarded events to the spine. Optimistic concurrency: when `expectedLength`
 * is given and does not match the current spine length, the write is a typed
 * conflict (no partial append).
 */
export function appendSpine(spine: NarrativeSpine, events: SpineEvent[], expectedLength?: number): Result<NarrativeSpine> {
  if (expectedLength !== undefined && expectedLength !== spine.events.length) {
    return fail('narrative_spine_write_conflict', `Spine write expected length ${expectedLength} but found ${spine.events.length}.`);
  }
  let seq = spine.events.length;
  const appended: SeqSpineEvent[] = events.map((event) => ({ ...event, seq: seq++ }));
  return ok({ runId: spine.runId, events: [...spine.events, ...appended] });
}

// --- run envelope + bounded snapshots ---

export type NarrativeRunEnvelope = {
  runId: string;
  projectId: string;
  packageVersion: number;
  spine: NarrativeSpine;
  turnRecords: NarrativeTurnRecord[];
  status: 'active' | 'sealed';
};

export function createRunEnvelope(input: { runId: string; projectId: string; packageVersion: number }): NarrativeRunEnvelope {
  return { runId: input.runId, projectId: input.projectId, packageVersion: input.packageVersion, spine: createSpine(input.runId), turnRecords: [], status: 'active' };
}

export type NarrativeStorySnapshot = {
  runId: string;
  atSeq: number;
  spineEvents: SeqSpineEvent[];
  takenAt: string;
};

export function snapshotStory(envelope: NarrativeRunEnvelope, now: string): NarrativeStorySnapshot {
  return { runId: envelope.runId, atSeq: envelope.spine.events.length, spineEvents: [...envelope.spine.events], takenAt: now };
}

/** Bounded hydrate/reset: rebuild a spine from a snapshot (used for replay/reset). */
export function hydrateSpine(snapshot: NarrativeStorySnapshot): NarrativeSpine {
  return { runId: snapshot.runId, events: snapshot.spineEvents.map((event, index) => ({ ...event, seq: index })) };
}

// --- the turn pipeline ---

export type TurnGenerateResult =
  | { ok: true; candidate: NarrativeCoreOutput }
  | { ok: false; reason: string; message: string };

export type TurnGenerate = (request: AgentTurnRequest, context: NarrativeContextProjection) => Promise<TurnGenerateResult> | TurnGenerateResult;

export type ProcessTurnInput = {
  request: AgentTurnRequest;
  context: NarrativeContextProjection;
  envelope: NarrativeRunEnvelope;
  generate: TurnGenerate;
  privateFacts?: string[];
  knownStateTargets?: string[];
  provenance?: Record<string, string>;
};

export type ProcessTurnOutcome = {
  record: NarrativeTurnRecord;
  envelope: NarrativeRunEnvelope;
  status: GuardStatus;
};

/**
 * Run one guarded turn: intent (implicit in request.trigger) -> assembly (context is
 * pre-built) -> generate -> guard -> write-spine. The spine is only mutated on
 * APPROVED/ADJUSTED. A generation failure or a guard rejection produces a turn
 * record with a null CoreOutput and no spine write — never a fabricated success.
 */
export async function processTurn(input: ProcessTurnInput): Promise<ProcessTurnOutcome> {
  const { request, context, envelope } = input;
  const turnId = mintId('turn');
  const baseProvenance = { ...(input.provenance ?? {}) };

  // assembly pre-check: a turn cannot run without CANON + STORY coverage.
  if (context.scopes.canon.length === 0 || context.scopes.story.length === 0) {
    return rejectedRecord(turnId, request, context, baseProvenance, envelope, 'narrative_context_insufficient', '上下文不足（缺少 CANON 或 STORY），未生成、未写入 spine。');
  }

  // generate (Runtime may execute the model here; it does not own the record).
  const generated = await input.generate(request, context);
  if (!generated.ok) {
    return rejectedRecord(turnId, request, context, { ...baseProvenance, generateReason: generated.reason }, envelope, 'agent_turn_failed', generated.message);
  }

  // guard.
  const guard = runGuard({
    candidate: generated.candidate,
    context,
    privateFacts: input.privateFacts,
    knownStateTargets: input.knownStateTargets,
  });

  if (guard.result.status === 'REJECTED' || !guard.output) {
    return rejectedRecord(turnId, request, context, baseProvenance, envelope, guard.result.reasonCode ?? 'narrative_guard_rejected', guard.result.actionHint ?? 'Guard rejected the turn.');
  }

  // write-spine (APPROVED / ADJUSTED only). Optimistic against current spine length.
  const appended = appendSpine(envelope.spine, guard.output.spineEvents, envelope.spine.events.length);
  if (!appended.ok) {
    return rejectedRecord(turnId, request, context, baseProvenance, envelope, 'narrative_spine_write_conflict', appended.message);
  }

  const record: NarrativeTurnRecord = {
    id: turnId,
    request,
    context,
    coreOutput: guard.output,
    guard: guard.result,
    status: guard.result.status,
    reasonCode: guard.result.reasonCode,
    provenance: baseProvenance,
  };
  const nextEnvelope: NarrativeRunEnvelope = { ...envelope, spine: appended.value, turnRecords: [...envelope.turnRecords, record] };
  return { record, envelope: nextEnvelope, status: guard.result.status };
}

function rejectedRecord(
  turnId: string,
  request: AgentTurnRequest,
  context: NarrativeContextProjection,
  provenance: Record<string, string>,
  envelope: NarrativeRunEnvelope,
  reasonCode: string,
  actionHint: string,
): ProcessTurnOutcome {
  const guard: EngineGuardResult = { status: 'REJECTED', reasonCode, actionHint };
  const record: NarrativeTurnRecord = {
    id: turnId,
    request,
    context,
    coreOutput: null,
    guard,
    status: 'REJECTED',
    reasonCode,
    provenance,
  };
  // No spine write on rejection. The record IS retained for audit/transcript.
  return { record, envelope: { ...envelope, turnRecords: [...envelope.turnRecords, record] }, status: 'REJECTED' };
}
