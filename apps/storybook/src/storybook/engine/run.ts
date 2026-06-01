// Playable run model + app-local narrative engine records. Play traversal is
// choice-primary: a story node always carries choices, and the engine can
// generate more (see choices.ts) so an ordinary user can progress without typing.
// Free-text input is an optional, bounded steer — never required.
//
// The narrative engine records here are app-owned. Runtime may execute model
// calls (see ai/**), but it never owns these turn records, the spine, or run
// state.

import { type TruthRef, mintId } from './ids.js';
import { type Result, ok, fail, type ValidationFinding } from './failure.js';

export type EffectOp = 'set-flag' | 'add-var' | 'award-achievement';
/** value is required for set-flag (boolean) / add-var (number); unused for award-achievement (target is the achievement id). */
export type Effect = { op: EffectOp; target: string; value?: number | boolean };

export type ChoiceSource = 'authored' | 'generated' | 'free-text';

export type Choice = {
  id: string;
  label: string;
  /** Target node within the chapter; omitted on terminal/ending choices. */
  targetNodeId?: string;
  effects?: Effect[];
  source: ChoiceSource;
};

export type StoryNode = {
  id: string;
  chapterId: string;
  text: string;
  /** Authored choices. The Play loop may augment these with generated choices. */
  choices: Choice[];
  effects?: Effect[];
  isEnding?: boolean;
  endingId?: string;
};

export type PlayableChapter = {
  ref: TruthRef;
  id: string;
  title: string;
  startNodeId: string;
  nodes: StoryNode[];
};

export type StoryRunStatus = 'active' | 'ended';

export type StoryRun = {
  id: string;
  projectId: string;
  packageId: string;
  chapterId: string;
  currentNodeId: string;
  variables: Record<string, number>;
  flags: Record<string, boolean>;
  /** Achievement ids awarded during this run (see branching.ts awardAchievement). */
  achievements: string[];
  status: StoryRunStatus;
  endingId?: string;
  startedAt: string;
  updatedAt: string;
};

export type BranchSnapshot = {
  id: string;
  runId: string;
  atNodeId: string;
  label: string;
  variables: Record<string, number>;
  flags: Record<string, boolean>;
  createdAt: string;
};

export type RunTranscriptEntryKind =
  | 'enter-node'
  | 'choice'
  | 'free-text'
  | 'agent-turn'
  | 'edit'
  | 'finding'
  | 'promotion'
  | 'feedback';

export type RunTranscriptEntry = {
  seq: number;
  at: string;
  kind: RunTranscriptEntryKind;
  detail: string;
  nodeId?: string;
  choiceId?: string;
  text?: string;
};

export type RunTranscript = {
  runId: string;
  entries: RunTranscriptEntry[];
};

// --- app-local narrative engine records ---

export type NarrativeContextScopes = {
  canon: string[];
  story: string[];
  subject: string[];
  relation: string[];
};

export type NarrativeContextProjection = {
  runId: string;
  turnRef: string;
  scopes: NarrativeContextScopes;
  governingTruthRefs: TruthRef[];
};

export type AgentTurnRequest = {
  id: string;
  runId: string;
  agentId: string;
  trigger: 'choice' | 'free-text' | 'system';
  userText?: string;
};

export type SpineEventKind = 'narration' | 'dialogue' | 'action' | 'state-note';
export type SpineEvent = { id: string; kind: SpineEventKind; text: string; agentId?: string };
export type StateChange = { op: 'set' | 'add'; target: string; value: number | boolean };

/** CoreOutput whitelist: ONLY spineEvents, stateChanges, metrics are allowed. */
export type NarrativeCoreOutput = {
  spineEvents: SpineEvent[];
  stateChanges: StateChange[];
  metrics: Record<string, number>;
};

export type GuardStatus = 'APPROVED' | 'ADJUSTED' | 'REJECTED';

export type EngineGuardResult = {
  status: GuardStatus;
  reasonCode?: string;
  actionHint?: string;
};

export type NarrativeTurnRecord = {
  id: string;
  request: AgentTurnRequest;
  context: NarrativeContextProjection;
  coreOutput: NarrativeCoreOutput | null;
  guard: EngineGuardResult;
  status: GuardStatus;
  reasonCode?: string;
  /** app-local provenance only (e.g. generation run id / trace id). */
  provenance: Record<string, string>;
};

const ALLOWED_CORE_OUTPUT_KEYS: ReadonlySet<string> = new Set(['spineEvents', 'stateChanges', 'metrics']);
const ALLOWED_SPINE_KINDS: ReadonlySet<SpineEventKind> = new Set<SpineEventKind>(['narration', 'dialogue', 'action', 'state-note']);

/** Fail-closed CoreOutput whitelist validation. */
export function validateNarrativeCoreOutput(output: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return [{ code: 'narrative_core_output_invalid', message: 'CoreOutput must be a non-null object.' }];
  }
  for (const key of Object.keys(output as Record<string, unknown>)) {
    if (!ALLOWED_CORE_OUTPUT_KEYS.has(key)) {
      findings.push({ code: 'narrative_core_output_invalid', message: `CoreOutput contains a non-whitelisted key "${key}".`, pointers: [key] });
    }
  }
  const candidate = output as Partial<NarrativeCoreOutput>;
  if (!Array.isArray(candidate.spineEvents)) {
    findings.push({ code: 'narrative_core_output_invalid', message: 'CoreOutput.spineEvents must be an array.', pointers: ['spineEvents'] });
  } else {
    candidate.spineEvents.forEach((event, index) => {
      if (!event || !ALLOWED_SPINE_KINDS.has(event.kind)) {
        findings.push({ code: 'narrative_core_output_invalid', message: `Spine event ${index} has an unsupported kind.`, pointers: [`spineEvents[${index}]`] });
      }
    });
  }
  if (!Array.isArray(candidate.stateChanges)) {
    findings.push({ code: 'narrative_core_output_invalid', message: 'CoreOutput.stateChanges must be an array.', pointers: ['stateChanges'] });
  }
  if (!candidate.metrics || typeof candidate.metrics !== 'object') {
    findings.push({ code: 'narrative_core_output_invalid', message: 'CoreOutput.metrics must be an object.', pointers: ['metrics'] });
  }
  return findings;
}

// --- pure run operations ---

export function findNode(chapter: PlayableChapter, nodeId: string): StoryNode | null {
  return chapter.nodes.find((node) => node.id === nodeId) ?? null;
}

export function startRun(input: { projectId: string; packageId: string; chapter: PlayableChapter; variables: Record<string, number>; flags: Record<string, boolean>; now: string }): StoryRun {
  return {
    id: mintId('run'),
    projectId: input.projectId,
    packageId: input.packageId,
    chapterId: input.chapter.id,
    currentNodeId: input.chapter.startNodeId,
    variables: { ...input.variables },
    flags: { ...input.flags },
    achievements: [],
    status: 'active',
    startedAt: input.now,
    updatedAt: input.now,
  };
}

function applyEffects(run: StoryRun, effects: Effect[] | undefined): StoryRun {
  if (!effects || effects.length === 0) return run;
  const variables = { ...run.variables };
  const flags = { ...run.flags };
  const achievements = [...run.achievements];
  for (const effect of effects) {
    if (effect.op === 'add-var' && typeof effect.value === 'number') {
      variables[effect.target] = (variables[effect.target] ?? 0) + effect.value;
    } else if (effect.op === 'set-flag' && typeof effect.value === 'boolean') {
      flags[effect.target] = effect.value;
    } else if (effect.op === 'award-achievement') {
      if (!achievements.includes(effect.target)) achievements.push(effect.target);
    }
  }
  return { ...run, variables, flags, achievements };
}

/** Advance a run by selecting a choice. Fails closed on unknown choice/target. */
export function applyChoice(run: StoryRun, chapter: PlayableChapter, choice: Choice, now: string): Result<StoryRun> {
  if (run.status !== 'active') {
    return fail('run_transcript_inconsistent', 'Cannot apply a choice to a run that has already ended.');
  }
  const current = findNode(chapter, run.currentNodeId);
  if (!current) {
    return fail('run_transcript_inconsistent', `Run points at unknown node "${run.currentNodeId}".`);
  }
  let next = applyEffects(run, current.effects);
  next = applyEffects(next, choice.effects);
  if (!choice.targetNodeId) {
    // terminal choice — ending closure handled by the caller via node.isEnding
    return ok({ ...next, updatedAt: now });
  }
  const targetNode = findNode(chapter, choice.targetNodeId);
  if (!targetNode) {
    return fail('chapter_dead_end', `Choice "${choice.label}" targets unknown node "${choice.targetNodeId}".`);
  }
  const advanced: StoryRun = {
    ...next,
    currentNodeId: targetNode.id,
    updatedAt: now,
    status: targetNode.isEnding ? 'ended' : 'active',
    endingId: targetNode.isEnding ? targetNode.endingId : next.endingId,
  };
  return ok(advanced);
}

export function snapshotBranch(run: StoryRun, label: string, now: string): BranchSnapshot {
  return {
    id: mintId('snapshot'),
    runId: run.id,
    atNodeId: run.currentNodeId,
    label,
    variables: { ...run.variables },
    flags: { ...run.flags },
    createdAt: now,
  };
}

export function createTranscript(runId: string): RunTranscript {
  return { runId, entries: [] };
}

export function appendTranscriptEntry(transcript: RunTranscript, entry: Omit<RunTranscriptEntry, 'seq'>): RunTranscript {
  const seq = transcript.entries.length;
  return { ...transcript, entries: [...transcript.entries, { ...entry, seq }] };
}
