import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import { readTimeLabelFromText, readYearLabel } from './source-detail-model-readers.js';

export type SourceDetailBiographicalPrimaryNode = {
  kind: 'primary';
  milestone: SourceDetailWorldCharacterMilestone;
  attachedClues: SourceDetailWorldCharacterMilestone[];
};

export type SourceDetailBiographicalClueList = {
  kind: 'clueList';
  variant: 'all' | 'unmatched';
  clues: SourceDetailWorldCharacterMilestone[];
};

export type SourceDetailBiographicalTimelineSection =
  | SourceDetailBiographicalPrimaryNode
  | SourceDetailBiographicalClueList;

const KIND_ORDER: Record<SourceDetailWorldCharacterMilestone['kind'], number> = {
  biography: 0,
  entry: 1,
  office: 2,
  work: 3,
};

function cleanText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[《》「」『』（）()[\]\s,，。;；:：、·・\-_/]+/gu, '');
}

function milestoneTexts(milestone: SourceDetailWorldCharacterMilestone): string[] {
  return [milestone.title, milestone.summary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
}

function milestoneText(milestone: SourceDetailWorldCharacterMilestone): string {
  return milestoneTexts(milestone).join('\n').toLocaleLowerCase();
}

function parsedYearSortValue(milestone: SourceDetailWorldCharacterMilestone): number {
  const label = readYearLabel(milestone.timeLabel) ?? readTimeLabelFromText(milestone.timeLabel);
  if (label) {
    const parsed = Number(label.match(/\d{3,4}/u)?.[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  for (const text of milestoneTexts(milestone)) {
    const fromText = readTimeLabelFromText(text);
    if (!fromText) {
      continue;
    }
    const parsed = Number(fromText.match(/\d{3,4}/u)?.[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareMilestones(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): number {
  return parsedYearSortValue(left) - parsedYearSortValue(right)
    || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || left.title.localeCompare(right.title);
}

function hasTimelineTime(milestone: SourceDetailWorldCharacterMilestone): boolean {
  return parsedYearSortValue(milestone) !== Number.MAX_SAFE_INTEGER;
}

function readableMilestoneKind(
  milestone: SourceDetailWorldCharacterMilestone,
): SourceDetailWorldCharacterMilestone['kind'] {
  if (milestone.kind !== 'biography') {
    return milestone.kind;
  }
  const text = milestoneText(milestone);
  if (/任|官|职|職|仕宦|山长|山長|院长|院長|office|appointment|appointed/u.test(text)) {
    return 'office';
  }
  if (/入仕|仕进|仕進|辟|荐|薦|entry/u.test(text)) {
    return 'entry';
  }
  if (/著|撰|诗|詩|文|书|書|作品|著述|text|work|writing|author/u.test(text)) {
    return 'work';
  }
  return 'biography';
}

function textOverlaps(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): boolean {
  const leftTexts = milestoneTexts(left).map(cleanText).filter(Boolean);
  const rightTexts = milestoneTexts(right).map(cleanText).filter(Boolean);
  return leftTexts.some((leftText) => rightTexts.some((rightText) => (
    leftText.includes(rightText) || rightText.includes(leftText)
  )));
}

function findAttachmentIndex(
  clue: SourceDetailWorldCharacterMilestone,
  nodes: readonly SourceDetailBiographicalPrimaryNode[],
): number {
  const directMatch = nodes.findIndex((node) => textOverlaps(node.milestone, clue));
  if (directMatch >= 0) {
    return directMatch;
  }
  const clueKind = readableMilestoneKind(clue);
  if (clueKind === 'office') {
    return nodes.findIndex((node) => readableMilestoneKind(node.milestone) === 'office');
  }
  if (clueKind === 'entry') {
    const entryIndex = nodes.findIndex((node) => readableMilestoneKind(node.milestone) === 'entry');
    if (entryIndex >= 0) {
      return entryIndex;
    }
    return nodes.findIndex((node) => readableMilestoneKind(node.milestone) === 'office');
  }
  if (clueKind === 'work') {
    return nodes.findIndex((node) => readableMilestoneKind(node.milestone) === 'work');
  }
  return -1;
}

function clueListVariant(hasTimedPrimary: boolean): SourceDetailBiographicalClueList['variant'] {
  return hasTimedPrimary ? 'unmatched' : 'all';
}

export function buildSourceDetailBiographicalTimeline(
  milestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailBiographicalTimelineSection[] {
  const timed = milestones.filter(hasTimelineTime).sort(compareMilestones);
  const untimed = milestones.filter((milestone) => !hasTimelineTime(milestone)).sort(compareMilestones);
  if (timed.length === 0) {
    return untimed.length > 0
      ? [{ kind: 'clueList', variant: clueListVariant(false), clues: untimed }]
      : [];
  }

  const nodes = timed.map((milestone): SourceDetailBiographicalPrimaryNode => ({
    kind: 'primary',
    milestone,
    attachedClues: [],
  }));
  const unmatched: SourceDetailWorldCharacterMilestone[] = [];

  for (const clue of untimed) {
    const attachmentIndex = findAttachmentIndex(clue, nodes);
    if (attachmentIndex >= 0) {
      nodes[attachmentIndex]?.attachedClues.push(clue);
      continue;
    }
    unmatched.push(clue);
  }

  const sections: SourceDetailBiographicalTimelineSection[] = nodes.map((node) => ({
    ...node,
    attachedClues: [...node.attachedClues].sort(compareMilestones),
  }));
  if (unmatched.length > 0) {
    sections.push({
      kind: 'clueList',
      variant: clueListVariant(true),
      clues: unmatched.sort(compareMilestones),
    });
  }
  return sections;
}

export function biographicalTimelineMarker(milestone: SourceDetailWorldCharacterMilestone): string {
  const kind = readableMilestoneKind(milestone);
  if (kind === 'office') {
    return '官';
  }
  if (kind === 'entry') {
    return '仕';
  }
  if (kind === 'work') {
    return '文';
  }
  const text = milestoneText(milestone);
  if (/出生|生于|birth|born/u.test(text)) {
    return '生';
  }
  if (/去世|逝世|卒|death|died/u.test(text)) {
    return '卒';
  }
  return '事';
}
