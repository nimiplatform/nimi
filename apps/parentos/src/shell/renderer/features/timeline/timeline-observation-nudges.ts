import type { ObservationDimension } from '../../knowledge-base/gen/observation-framework.gen.js';
import { computeRecommendedPrompts, type GapAnalysisEntry } from '../journal/journal-recommended-prompts.js';

export interface ObservationNudge {
  dimensionId: string;
  displayName: string;
  nudgeText: string;
  parentQuestion: string;
}

/**
 * Per-dimension nudge copy — each dimension gets its own casual, varied phrasing.
 * Multiple options per dimension; one is picked based on a simple daily rotation.
 */
const NUDGE_COPY: Record<string, string[]> = {
  'PO-OBS-CONC-001': [
    '孩子最近沉浸在什么事情里？',
    '有没有发现孩子特别投入的瞬间？',
  ],
  'PO-OBS-REPT-001': [
    '孩子最近有没有反复做某件事？',
    '留意一下孩子重复做的那些"小仪式"',
  ],
  'PO-OBS-CHOI-001': [
    '今天让孩子自己做个小决定试试',
    '孩子面对选择时是果断还是犹豫？',
  ],
  'PO-OBS-INDP-001': [
    '有什么事孩子快要能自己搞定了？',
    '试着退后一步，看孩子自己怎么来',
  ],
  'PO-OBS-SOCL-001': [
    '孩子跟小伙伴在一起时是什么状态？',
    '留意一下孩子和其他孩子的互动方式',
  ],
  'PO-OBS-EMOT-001': [
    '孩子最近的情绪节奏是怎样的？',
    '今天孩子开心和不开心的时候各是什么样？',
  ],
  'PO-OBS-MOVE-001': [
    '孩子身体上有什么新动作或新尝试吗？',
    '观察一下孩子跑跑跳跳时的状态',
  ],
  'PO-OBS-LANG-001': [
    '孩子最近冒出什么新词或新表达了？',
    '留意一下孩子怎么表达自己想要的东西',
  ],
  'PO-OBS-ORDR-001': [
    '孩子对"东西放哪里"在意吗？',
    '有没有注意到孩子对顺序的小执念？',
  ],
  'PO-OBS-EXPL-001': [
    '孩子最近对什么东西特别好奇？',
    '看看孩子遇到新事物时的第一反应',
  ],
  'PO-OBS-EXEC-001': [
    '孩子自己安排事情时表现如何？',
    '留意一下孩子做计划和执行的过程',
  ],
  'PO-OBS-CASL-001': [
    '孩子在理解别人感受这件事上有什么变化？',
    '最近有什么场景体现了孩子的共情能力？',
  ],
  'PO-OBS-GROW-001': [
    '孩子遇到困难时第一反应是什么？',
    '看看孩子面对挫折时的态度变化',
  ],
  'PO-OBS-MINT-001': [
    '孩子最近痴迷什么？',
    '有没有发现孩子在某件事上特别有天赋？',
  ],
  'PO-OBS-INDU-001': [
    '孩子最近有什么"我做到了"的时刻吗？',
    '留意一下让孩子有成就感的事情',
  ],
  'PO-OBS-IDEN-001': [
    '孩子最近怎么形容自己？',
    '留意孩子对"我是谁"这个问题的探索',
  ],
  'PO-OBS-PYDC-001': [
    '孩子在哪些方面表现出了责任感？',
    '最近有什么事让你觉得孩子在成长？',
  ],
  'PO-OBS-META-001': [
    '孩子知道自己怎么学东西最快吗？',
    '孩子有没有开始反思自己的学习方式？',
  ],
  'PO-OBS-MORL-001': [
    '孩子最近遇到"对与错"的问题了吗？',
    '留意一下孩子在公平和规则方面的判断',
  ],
  'PO-OBS-ATTC-001': [
    '孩子在你离开和回来时是什么反应？',
    '今天找个安静的时刻，感受一下你们之间的连接',
  ],
  'PO-OBS-RELQ-001': [
    '你和孩子之间的沟通顺畅吗？',
    '今天试着跟孩子聊一个轻松的话题',
  ],
};

/**
 * Pick a nudge text for a given dimensionId.
 * Uses a day-based index so it rotates naturally without randomness.
 */
function pickNudgeText(dimensionId: string, displayName: string): string {
  const copies = NUDGE_COPY[dimensionId];
  if (!copies || copies.length === 0) return `${displayName}方面最近没有记录，找个机会观察一下？`;
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return copies[dayIndex % copies.length]!;
}

/**
 * Compute soft observation nudges for the timeline sidebar.
 *
 * Selects the least-observed dimensions (with 0 entries in the window)
 * and wraps them in warm, non-pressuring copy.
 */
export function computeObservationNudges(
  activeDimensions: readonly ObservationDimension[],
  journalEntries: readonly GapAnalysisEntry[],
  options?: { maxNudges?: number; windowDays?: number },
): ObservationNudge[] {
  const maxNudges = options?.maxNudges ?? 2;
  const windowDays = options?.windowDays ?? 14;

  const prompts = computeRecommendedPrompts(activeDimensions, journalEntries, {
    maxPrompts: maxNudges,
    windowDays,
  });

  // Only nudge dimensions with zero entries — keep it soft
  return prompts
    .filter((p) => p.entryCountLast14d === 0)
    .map((p) => ({
      dimensionId: p.dimensionId,
      displayName: p.displayName,
      nudgeText: pickNudgeText(p.dimensionId, p.displayName),
      parentQuestion: p.parentQuestion,
    }));
}
