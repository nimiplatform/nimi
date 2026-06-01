// Official example prepared package. Hand-authored, genre-neutral interactive
// mystery (not galgame/adult/anime/one-shot VN) that exercises the full
// rule-of-truth -> projection -> prepared-package path so Play has a valid,
// zero-configuration entry out of the box.

import { makeTruthRef } from './ids.js';
import { type Result } from './failure.js';
import { type StorybookTruthPackage } from './truth.js';
import { type PlayableChapter } from './run.js';
import { attachPrebuiltArtifact, attachFallbackArtifact, createAssetSpec } from './assets.js';
import { buildPreparedPackage, type PreparedStorybookPackage } from './prepared-package.js';

const PROJECT_ID = 'example-foggy-harbor';

export function buildExampleTruthPackage(now: string): StorybookTruthPackage {
  const sceneRef = makeTruthRef(PROJECT_ID, 'scenario-frame', 'frame');
  const castRef = makeTruthRef(PROJECT_ID, 'agent-cast', 'cast');
  const bibleRef = makeTruthRef(PROJECT_ID, 'storybook-bible', 'bible');
  const topoRef = makeTruthRef(PROJECT_ID, 'branch-topology', 'topo');
  const matrixRef = makeTruthRef(PROJECT_ID, 'state-ending-matrix', 'matrix');
  const chapterRef = makeTruthRef(PROJECT_ID, 'chapter', 'ch1');
  const inspectorRef = makeTruthRef(PROJECT_ID, 'agent-rule', 'inspector');
  const keeperRef = makeTruthRef(PROJECT_ID, 'agent-rule', 'keeper');
  const bgAssetRef = makeTruthRef(PROJECT_ID, 'asset-spec', 'bg-harbor');
  const portraitAssetRef = makeTruthRef(PROJECT_ID, 'asset-spec', 'portrait-keeper');
  const briefRef = makeTruthRef(PROJECT_ID, 'adaptation-brief', 'brief');
  const styleGuideRef = makeTruthRef(PROJECT_ID, 'visual-style-guide', 'style');

  const chapter: PlayableChapter = {
    ref: chapterRef,
    id: 'ch1',
    title: '第一章：雾港的灯',
    startNodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        chapterId: 'ch1',
        text: '浓雾笼罩着港口。灯塔守夜人失踪了，只留下一盏还亮着的灯。你是被请来调查的人。',
        choices: [
          { id: 'c1', label: '先检查灯塔内部', targetNodeId: 'n2', source: 'authored' },
          { id: 'c2', label: '先向码头的老板娘打听', targetNodeId: 'n3', source: 'authored' },
        ],
      },
      {
        id: 'n2',
        chapterId: 'ch1',
        text: '灯塔内潮湿而安静。值班记录的最后一页被人撕掉了，桌上有未冷的茶。',
        choices: [
          { id: 'c3', label: '收起茶杯作为线索，下楼离开', targetNodeId: 'nEnd', effects: [{ op: 'add-var', target: 'clues', value: 1 }, { op: 'award-achievement', target: 'first-clue' }], source: 'authored' },
        ],
      },
      {
        id: 'n3',
        chapterId: 'ch1',
        text: '老板娘压低声音：「昨晚我看见有第二个人上了灯塔。」',
        choices: [
          { id: 'c4', label: '记下证词，前往灯塔', targetNodeId: 'nEnd', effects: [{ op: 'add-var', target: 'clues', value: 1 }, { op: 'award-achievement', target: 'first-clue' }], source: 'authored' },
        ],
      },
      {
        id: 'nEnd',
        chapterId: 'ch1',
        text: '你拼起了第一块拼图。雾还没散，但线索已经握在手里。（第一章结束）',
        choices: [],
        isEnding: true,
        endingId: 'end-chapter-one',
      },
    ],
  };

  return {
    id: 'example-truthpkg',
    projectId: PROJECT_ID,
    version: 1,
    governance: { lifecycle: 'play-ready', reviewState: 'reviewed', owner: 'storybook-official', buildScope: 'app-local', createdAt: now, updatedAt: now },
    rules: [
      {
        ref: makeTruthRef(PROJECT_ID, 'world-rule', 'no-supernatural'),
        family: 'world-rule',
        domain: 'world',
        category: 'genre',
        hardness: 'hard',
        scope: 'project',
        title: '本作为写实推理，无超自然元素。',
        payload: { genre: 'mystery' },
        provenance: 'creator',
        evidenceRefs: [],
      },
    ],
    scenarioFrame: {
      ref: sceneRef,
      background: '一个被浓雾包围的旧港口，灯塔守夜人离奇失踪。',
      roles: [
        { id: 'role-detective', name: '调查者（玩家）', summary: '被请来调查失踪案的人。' },
        { id: 'role-keeper', name: '灯塔守夜人', summary: '失踪者。' },
      ],
      rules: ['以选择推进调查', '尊重写实推理基调'],
      playerPosition: '第一人称调查者',
      contentBoundaries: ['适合一般读者', '不含露骨或仇恨内容'],
    },
    agentCast: {
      ref: castRef,
      agents: [
        {
          id: 'inspector',
          ref: inspectorRef,
          name: '老探长',
          voice: '沉稳、简短',
          publicFacts: ['在本地警局工作多年'],
          privateFacts: ['私下怀疑这是一桩内部掩盖'],
          goals: ['查清守夜人下落'],
          allowedActions: ['对话', '提供线索'],
          provenance: 'creator',
        },
        {
          id: 'keeper-wife',
          ref: keeperRef,
          name: '码头老板娘',
          voice: '热心、爱八卦',
          publicFacts: ['经营码头边的小馆子'],
          privateFacts: ['欠了守夜人一笔人情'],
          goals: ['不希望卷入麻烦'],
          allowedActions: ['对话', '提供证词'],
          provenance: 'creator',
        },
      ],
    },
    bible: {
      ref: bibleRef,
      premise: '在雾港调查灯塔守夜人失踪案的互动推理。',
      styleFingerprint: '克制的写实推理散文，第二人称叙述。',
      rhythmProfile: '以短场景与选择推进，偶有对话。',
      worldSummary: '雾港是一个封闭的小型海港，人人都藏着一点秘密。',
      themes: ['真相', '信任'],
      approved: true,
    },
    adaptationBrief: {
      ref: briefRef,
      title: '雾港疑案 · 改编方向',
      premiseSummary: '在封闭海港调查灯塔守夜人失踪案的互动推理。',
      playerPerspective: '第一人称调查者',
      coreTension: '人人都藏着秘密，真相与信任彼此拉扯。',
      targetMilestone: '完成第一章：收集第一条线索。',
      stylePlan: '克制的写实推理散文。',
      pacingPlan: '以短场景与选择推进，偶有对话。',
      endingDirection: '朝着揭开失踪真相的方向推进（具体条件不在此剧透）。',
      approval: 'approved',
    },
    visualStyleGuide: {
      ref: styleGuideRef,
      artDirection: '低饱和、雾气弥漫的写实海港夜景；冷色调为主。',
      palette: ['雾灰', '深蓝', '灯塔暖黄'],
      consistencyAnchors: ['统一的雾气厚度', '灯塔暖黄作为唯一暖色锚点'],
    },
    divergences: [],
    branchTopology: { ref: topoRef, startChapterId: 'ch1', chapterIds: ['ch1'], routes: [], switchPoints: [] },
    stateEndingMatrix: {
      ref: matrixRef,
      variables: [{ id: 'clues', label: '线索数', initial: 0 }],
      flags: [],
      endings: [{ id: 'end-chapter-one', label: '第一章完成', reachableFromChapterId: 'ch1' }],
      achievements: [{ id: 'first-clue', label: '握住第一条线索' }],
    },
    chapters: [chapter],
    assets: [
      // prebuilt usable asset (no generation required) ...
      attachPrebuiltArtifact(
        createAssetSpec({ ref: bgAssetRef, kind: 'background', description: '雾港码头夜景', requiredness: 'optional', now }),
        'asset://example/bg-harbor.png',
        'image/png',
        now,
      ),
      // ... and a fallback-state asset to demonstrate explicit fallback provenance.
      attachFallbackArtifact(
        createAssetSpec({ ref: portraitAssetRef, kind: 'character-portrait', description: '码头老板娘立绘', requiredness: 'optional', now }),
        'asset://example/portrait-keeper-fallback.png',
        'image/png',
        now,
      ),
    ],
    evidence: [
      { id: 'evid-bible', truthRef: bibleRef, kind: 'edit', sourceRef: 'official-author', note: '官方示例 Bible 由作者直接撰写。' },
      { id: 'evid-scene', truthRef: sceneRef, kind: 'edit', sourceRef: 'official-author', note: '官方示例场景框架。' },
    ],
    derivations: [
      { id: 'deriv-bible', kind: 'adaptation', fromRefs: [sceneRef], toRef: bibleRef, note: '由场景框架派生 Bible。' },
    ],
    projectionInputs: [
      { id: 'proj-play', projectionType: 'play', governingTruthRefs: [bibleRef, sceneRef, castRef, topoRef], validationStatus: 'valid' },
    ],
    feedback: [],
    compat: [],
    realmImports: [],
  };
}

export function buildExamplePreparedPackage(now: string): Result<PreparedStorybookPackage> {
  return buildPreparedPackage({ pkg: buildExampleTruthPackage(now), producer: 'storybook-official', now });
}
