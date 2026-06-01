// Studio-side authoring mutations on the app-owned truth package. These are
// explicit, deterministic edit operations (no AI required) that move a project
// through the foundation-review gate and to a play-ready state. Every mutation
// bumps the package version and marks derived projections stale, so a projection
// is never silently treated as fresh.

import { makeTruthRef } from './ids.js';
import { type Result, ok, fail } from './failure.js';
import { type StorybookTruthPackage, bumpVersion } from './truth.js';
import { type PlayableChapter } from './run.js';
import { type BranchTopology, type StateEndingMatrix } from './foundation.js';

// Authority mutations bump the version and stale projections through the shared helper.
const bumpAndStale = bumpVersion;

/** Foundation review gate: approve the Bible. Chapter scaffolding is blocked until this. */
export function approveBible(pkg: StorybookTruthPackage, now: string): Result<StorybookTruthPackage> {
  if (!pkg.bible) return fail('truth_package_section_incomplete', '尚无 Storybook Bible 可供审批。', ['bible']);
  const next = bumpAndStale(
    {
      ...pkg,
      bible: { ...pkg.bible, approved: true },
      governance: { ...pkg.governance, lifecycle: pkg.governance.lifecycle === 'draft' ? 'foundation-approved' : pkg.governance.lifecycle, reviewState: 'reviewed' },
    },
    now,
  );
  return ok(next);
}

/** Apply an AI-drafted (or hand-edited) Bible body. The text is creator-reviewed content. */
export function applyBibleDraft(pkg: StorybookTruthPackage, draft: { worldSummary?: string; styleFingerprint?: string; rhythmProfile?: string }, now: string): Result<StorybookTruthPackage> {
  if (!pkg.bible) return fail('truth_package_section_incomplete', '尚无 Storybook Bible 可供编辑。', ['bible']);
  return ok(bumpAndStale({
    ...pkg,
    bible: {
      ...pkg.bible,
      worldSummary: draft.worldSummary ?? pkg.bible.worldSummary,
      styleFingerprint: draft.styleFingerprint ?? pkg.bible.styleFingerprint,
      rhythmProfile: draft.rhythmProfile ?? pkg.bible.rhythmProfile,
    },
  }, now));
}

/**
 * Scaffold a minimal play-ready chapter graph from the approved foundation. This is
 * a deterministic baseline (intro -> two branches -> ending) the creator can later
 * extend; it requires Bible approval (foundation gate) and never invents hard truth.
 */
export function scaffoldStarterChapter(pkg: StorybookTruthPackage, now: string): Result<StorybookTruthPackage> {
  if (!pkg.bible?.approved) {
    return fail('truth_package_section_incomplete', 'Storybook Bible 未审批，章节生成被基础审阅门拦截。', ['bible.approved']);
  }
  if (pkg.chapters.length > 0) {
    return fail('branch_topology_invalid', '项目已有章节；起始章节脚手架只用于空项目。', ['chapters']);
  }
  const intro = pkg.bible.premise || pkg.scenarioFrame?.background || '故事开始了。';
  const chapter: PlayableChapter = {
    ref: makeTruthRef(pkg.projectId, 'chapter', 'ch1'),
    id: 'ch1',
    title: '序章',
    startNodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        chapterId: 'ch1',
        text: intro,
        choices: [
          { id: 'c-a', label: '谨慎地观察四周', targetNodeId: 'n2', source: 'authored' },
          { id: 'c-b', label: '主动迈出第一步', targetNodeId: 'n3', source: 'authored' },
        ],
      },
      { id: 'n2', chapterId: 'ch1', text: '你选择先观察。线索在细节里浮现。', choices: [{ id: 'c-a2', label: '记下所见，继续', targetNodeId: 'nEnd', source: 'authored' }] },
      { id: 'n3', chapterId: 'ch1', text: '你选择主动行动。事态因此推进。', choices: [{ id: 'c-b2', label: '顺势推进，继续', targetNodeId: 'nEnd', source: 'authored' }] },
      { id: 'nEnd', chapterId: 'ch1', text: '序章在此告一段落。（可在 Studio 继续扩展后续章节）', choices: [], isEnding: true, endingId: 'end-prologue' },
    ],
  };
  const topology: BranchTopology = { ref: makeTruthRef(pkg.projectId, 'branch-topology', 'topo'), startChapterId: 'ch1', chapterIds: ['ch1'], routes: [], switchPoints: [] };
  const matrix: StateEndingMatrix = {
    ref: makeTruthRef(pkg.projectId, 'state-ending-matrix', 'matrix'),
    variables: [],
    flags: [],
    endings: [{ id: 'end-prologue', label: '序章结束', reachableFromChapterId: 'ch1' }],
    achievements: [],
  };
  return ok(bumpAndStale({
    ...pkg,
    chapters: [chapter],
    branchTopology: topology,
    stateEndingMatrix: matrix,
    governance: { ...pkg.governance, lifecycle: 'play-ready' },
  }, now));
}
