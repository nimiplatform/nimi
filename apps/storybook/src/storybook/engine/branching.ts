// Playable run / branch completeness (wave-10). The baseline run.ts covers
// single-chapter traversal (applyChoice), branch snapshots, and transcript. This
// module adds the rest of the Play run product layer:
//
//   - route conditions over run variables/flags (a tiny, safe, no-eval comparison)
//   - cross-chapter switching gated by branch topology + route conditions
//   - achievement awarding (validated against the state/ending matrix)
//   - checkpoint restore from a branch snapshot
//   - ending-closure validation
//
// Everything is fail-closed: an invalid condition, an unauthorized switch, an
// unknown achievement, or a missing ending closure is a typed failure.

import { type Result, ok, fail, type ValidationFinding } from './failure.js';
import { type BranchTopology, type Route, type StateEndingMatrix } from './foundation.js';
import { type StoryRun, type BranchSnapshot, type PlayableChapter, findNode } from './run.js';

// --- route conditions ---

type Comparator = '>=' | '<=' | '==' | '!=' | '>' | '<';
const CONDITION_RE = /^\s*([A-Za-z_][\w-]*)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s*$/;

/**
 * Evaluate a route condition against run state. An empty/absent condition is
 * unconditional (true). The grammar is a single comparison `<ident> <op> <value>`
 * over a numeric variable or a boolean flag — no code evaluation. Malformed
 * conditions fail closed (`route_condition_invalid`) rather than silently passing.
 */
export function evaluateRouteCondition(run: StoryRun, condition?: string): Result<boolean> {
  if (!condition || !condition.trim()) return ok(true);
  const match = CONDITION_RE.exec(condition);
  if (!match) return fail('route_condition_invalid', `Route condition "${condition}" is not a single comparison.`);
  const [, ident, op, rawValue] = match as unknown as [string, string, Comparator, string];

  if (rawValue === 'true' || rawValue === 'false') {
    const lhs = run.flags[ident];
    if (lhs === undefined) return fail('route_condition_invalid', `Condition references unknown flag "${ident}".`);
    const rhs = rawValue === 'true';
    if (op === '==') return ok(lhs === rhs);
    if (op === '!=') return ok(lhs !== rhs);
    return fail('route_condition_invalid', `Operator "${op}" is not valid for a boolean flag.`);
  }

  const rhsNum = Number.parseFloat(rawValue);
  if (Number.isNaN(rhsNum)) return fail('route_condition_invalid', `Condition right-hand side "${rawValue}" is not a number or boolean.`);
  const lhsNum = run.variables[ident];
  if (lhsNum === undefined) return fail('route_condition_invalid', `Condition references unknown variable "${ident}".`);
  switch (op) {
    case '>=': return ok(lhsNum >= rhsNum);
    case '<=': return ok(lhsNum <= rhsNum);
    case '>': return ok(lhsNum > rhsNum);
    case '<': return ok(lhsNum < rhsNum);
    case '==': return ok(lhsNum === rhsNum);
    case '!=': return ok(lhsNum !== rhsNum);
    default: return fail('route_condition_invalid', `Unsupported operator "${op}".`);
  }
}

/** Routes leaving the run's current chapter whose conditions currently hold. */
export function availableChapterSwitches(topology: BranchTopology, run: StoryRun): Route[] {
  return topology.routes.filter((route) => {
    if (route.fromChapterId !== run.chapterId) return false;
    const evaluated = evaluateRouteCondition(run, route.condition);
    return evaluated.ok && evaluated.value;
  });
}

/**
 * Switch the run to another chapter along an admitted route. Fails closed when no
 * route exists, the route condition does not hold, or the target chapter/start node
 * is missing.
 */
export function switchChapter(input: { run: StoryRun; topology: BranchTopology; targetChapter: PlayableChapter; now: string }): Result<StoryRun> {
  const { run, topology, targetChapter, now } = input;
  if (run.status !== 'active') {
    return fail('run_state_conflict', 'Cannot switch chapters on a run that has ended.');
  }
  const route = topology.routes.find((r) => r.fromChapterId === run.chapterId && r.toChapterId === targetChapter.id);
  if (!route) {
    return fail('branch_switch_invalid', `No route from chapter "${run.chapterId}" to "${targetChapter.id}".`);
  }
  const condition = evaluateRouteCondition(run, route.condition);
  if (!condition.ok) return condition;
  if (!condition.value) {
    return fail('branch_switch_invalid', `Route to "${targetChapter.id}" is gated by condition "${route.condition}", which is not satisfied.`);
  }
  if (!findNode(targetChapter, targetChapter.startNodeId)) {
    return fail('node_ref_missing', `Target chapter "${targetChapter.id}" start node "${targetChapter.startNodeId}" is missing.`);
  }
  return ok({ ...run, chapterId: targetChapter.id, currentNodeId: targetChapter.startNodeId, updatedAt: now });
}

// --- achievements ---

/** Award an achievement. Validated against the matrix; idempotent. */
export function awardAchievement(run: StoryRun, achievementId: string, matrix: StateEndingMatrix, now: string): Result<StoryRun> {
  if (!matrix.achievements.some((a) => a.id === achievementId)) {
    return fail('run_state_conflict', `Achievement "${achievementId}" is not declared in the state/ending matrix.`);
  }
  if (run.achievements.includes(achievementId)) return ok(run);
  return ok({ ...run, achievements: [...run.achievements, achievementId], updatedAt: now });
}

// --- checkpoint restore ---

/**
 * Restore a run to a previously captured branch snapshot (replay-from-checkpoint).
 * The snapshot must belong to this run. Restoring reactivates the run at the
 * snapshot node and variable/flag state.
 */
export function restoreCheckpoint(run: StoryRun, snapshot: BranchSnapshot, chapter: PlayableChapter, now: string): Result<StoryRun> {
  if (snapshot.runId !== run.id) {
    return fail('checkpoint_invalid', `Snapshot ${snapshot.id} belongs to run ${snapshot.runId}, not ${run.id}.`);
  }
  if (!findNode(chapter, snapshot.atNodeId)) {
    return fail('node_ref_missing', `Snapshot node "${snapshot.atNodeId}" is not in chapter "${chapter.id}".`);
  }
  return ok({
    ...run,
    currentNodeId: snapshot.atNodeId,
    variables: { ...snapshot.variables },
    flags: { ...snapshot.flags },
    status: 'active',
    endingId: undefined,
    updatedAt: now,
  });
}

// --- ending closure validation ---

/**
 * Every declared ending must have a closure node — a node flagged `isEnding` with a
 * matching `endingId` — somewhere in the chapter graph. A declared ending with no
 * closure node is `ending_closure_missing`.
 */
export function validateEndingClosure(matrix: StateEndingMatrix, chapters: PlayableChapter[]): ValidationFinding[] {
  const closureIds = new Set<string>();
  for (const chapter of chapters) {
    for (const node of chapter.nodes) {
      if (node.isEnding && node.endingId) closureIds.add(node.endingId);
    }
  }
  const findings: ValidationFinding[] = [];
  for (const ending of matrix.endings) {
    if (!closureIds.has(ending.id)) {
      findings.push({
        code: 'ending_closure_missing',
        message: `Ending "${ending.label}" (${ending.id}) has no closure node (isEnding node with matching endingId).`,
        pointers: [`ending:${ending.id}`],
      });
    }
  }
  return findings;
}
