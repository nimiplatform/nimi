// Foundation domain objects: the creator-visible product checkpoints that sit in
// the truth package's `truth.storybook` / `truth.agents` sections. These are
// app-owned structured records, not prompts or lorebooks. Each carries a truth
// ref so evidence bindings and projections can point back to it.

import { type TruthRef } from './ids.js';
import { type ValidationFinding } from './failure.js';

export type Role = {
  id: string;
  name: string;
  summary: string;
};

export type ScenarioFrame = {
  ref: TruthRef;
  background: string;
  roles: Role[];
  /** Worldview / play rules expressed as plain rule lines. */
  rules: string[];
  playerPosition: string;
  contentBoundaries: string[];
};

export type AgentSheet = {
  id: string;
  ref: TruthRef;
  name: string;
  voice: string;
  /** Facts the player may learn freely. */
  publicFacts: string[];
  /** Facts the agent withholds; must never leak through projection by default. */
  privateFacts: string[];
  goals: string[];
  allowedActions: string[];
  appearance?: string;
  /** Forge-aligned provenance for the agent rule layer. */
  provenance: 'creator' | 'world-inherited' | 'narrative-emerged' | 'system';
};

export type AgentCast = {
  ref: TruthRef;
  agents: AgentSheet[];
};

export type StorybookBible = {
  ref: TruthRef;
  premise: string;
  /** prose / dialogue / viewpoint constraints. */
  styleFingerprint: string;
  /** pacing / interaction density. */
  rhythmProfile: string;
  worldSummary: string;
  themes: string[];
  /** Foundation review gate: chapter generation is blocked until approved. */
  approved: boolean;
};

export type Route = {
  fromChapterId: string;
  toChapterId: string;
  /** Optional condition expressed against state-matrix variables/flags. */
  condition?: string;
};

export type BranchTopology = {
  ref: TruthRef;
  startChapterId: string;
  chapterIds: string[];
  routes: Route[];
  switchPoints: string[];
};

export type StateVariable = { id: string; label: string; initial: number };
export type StateFlag = { id: string; label: string; initial: boolean };
export type Ending = { id: string; label: string; reachableFromChapterId: string };
export type Achievement = { id: string; label: string };

export type StateEndingMatrix = {
  ref: TruthRef;
  variables: StateVariable[];
  flags: StateFlag[];
  endings: Ending[];
  achievements: Achievement[];
};

// --- validators (fail-closed; return findings, empty = valid) ---

export function validateScenarioFrame(frame: ScenarioFrame): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!frame.background.trim()) {
    findings.push({ code: 'scenario_frame_incomplete', message: 'Scenario frame background is empty.', pointers: ['background'] });
  }
  if (frame.roles.length === 0) {
    findings.push({ code: 'scenario_frame_incomplete', message: 'Scenario frame has no roles.', pointers: ['roles'] });
  }
  if (!frame.playerPosition.trim()) {
    findings.push({ code: 'scenario_frame_incomplete', message: 'Scenario frame has no player position.', pointers: ['playerPosition'] });
  }
  if (frame.contentBoundaries.length === 0) {
    findings.push({ code: 'scenario_frame_incomplete', message: 'Scenario frame declares no content boundaries.', pointers: ['contentBoundaries'] });
  }
  return findings;
}

export function validateAgentCast(cast: AgentCast): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  cast.agents.forEach((agent, index) => {
    if (!agent.name.trim()) {
      findings.push({ code: 'agent_cast_visibility_invalid', message: `Agent ${index} has no name.`, pointers: [`agents[${index}].name`] });
    }
    const publicSet = new Set(agent.publicFacts.map((f) => f.trim().toLowerCase()).filter(Boolean));
    for (const priv of agent.privateFacts) {
      if (publicSet.has(priv.trim().toLowerCase())) {
        findings.push({
          code: 'agent_cast_visibility_invalid',
          message: `Agent "${agent.name}" leaks a private fact into public facts: "${priv}".`,
          pointers: [`agents[${index}].privateFacts`],
        });
      }
    }
  });
  return findings;
}

export function validateBranchTopology(topology: BranchTopology): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const ids = new Set(topology.chapterIds);
  if (!ids.has(topology.startChapterId)) {
    findings.push({ code: 'branch_topology_invalid', message: 'Start chapter is not in the chapter set.', pointers: ['startChapterId'] });
  }
  for (const route of topology.routes) {
    if (!ids.has(route.fromChapterId) || !ids.has(route.toChapterId)) {
      findings.push({
        code: 'branch_topology_invalid',
        message: `Route ${route.fromChapterId} -> ${route.toChapterId} references an unknown chapter.`,
        pointers: ['routes'],
      });
    }
  }
  // reachability from start
  const reachable = new Set<string>([topology.startChapterId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const route of topology.routes) {
      if (reachable.has(route.fromChapterId) && !reachable.has(route.toChapterId)) {
        reachable.add(route.toChapterId);
        grew = true;
      }
    }
  }
  for (const id of topology.chapterIds) {
    if (!reachable.has(id)) {
      findings.push({ code: 'chapter_graph_unreachable', message: `Chapter "${id}" is unreachable from the start.`, pointers: ['routes'] });
    }
  }
  return findings;
}

export function validateStateEndingMatrix(matrix: StateEndingMatrix, topology: BranchTopology): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (matrix.endings.length === 0) {
    findings.push({ code: 'state_ending_matrix_invalid', message: 'No endings declared.', pointers: ['endings'] });
  }
  const chapterIds = new Set(topology.chapterIds);
  for (const ending of matrix.endings) {
    if (!chapterIds.has(ending.reachableFromChapterId)) {
      findings.push({
        code: 'ending_unreachable',
        message: `Ending "${ending.label}" is anchored to an unknown chapter "${ending.reachableFromChapterId}".`,
        pointers: ['endings'],
      });
    }
  }
  return findings;
}
