import type { WorldCharacter, WorldDetailData, WorldHistoryBundle } from './world-detail-types.js';

export type WorldRelationshipEvidenceKind =
  | 'association'
  | 'kinship'
  | 'office'
  | 'text'
  | 'entry'
  | 'address'
  | 'status'
  | 'topic';

export type WorldRelationshipEvidenceSourceField = 'source.tags';

export type WorldRelationshipEvidenceRecord = {
  readonly id: string;
  readonly sourceCharacterId: string;
  readonly sourceName: string;
  readonly targetCharacterId: string | null;
  readonly targetName: string | null;
  readonly targetIsWorldCharacter: boolean;
  readonly kind: WorldRelationshipEvidenceKind;
  readonly evidenceText: string;
  readonly sourceField: WorldRelationshipEvidenceSourceField;
  readonly sourceIndex: number;
};

export type WorldRelationshipEvidenceEdge = {
  readonly id: string;
  readonly sourceCharacterId: string;
  readonly sourceName: string;
  readonly targetCharacterId: string;
  readonly targetName: string;
  readonly targetIsWorldCharacter: boolean;
  readonly targetRole: string | null;
  readonly targetFaction: string | null;
  readonly kind: WorldRelationshipEvidenceKind;
  readonly evidenceTexts: readonly string[];
  readonly sourceFields: readonly string[];
  readonly weight: number;
};

export type WorldRelationshipEvidenceNode = {
  readonly character: WorldCharacter;
  readonly edgeCount: number;
  readonly primaryKind: WorldRelationshipEvidenceKind;
};

export type WorldRelationshipEvidenceCharacterStatus = 'linked' | 'clueOnly' | 'empty';

export type WorldRelationshipEvidenceCharacterBucket = {
  readonly character: WorldCharacter;
  readonly status: WorldRelationshipEvidenceCharacterStatus;
  readonly linkedEvidenceCount: number;
  readonly unlinkedEvidenceCount: number;
  readonly primaryKind: WorldRelationshipEvidenceKind | null;
};

export type WorldRelationshipEvidenceDensity = {
  readonly linked: readonly WorldRelationshipEvidenceCharacterBucket[];
  readonly clueOnly: readonly WorldRelationshipEvidenceCharacterBucket[];
  readonly empty: readonly WorldRelationshipEvidenceCharacterBucket[];
};

export type WorldRelationshipEvidenceGraph = {
  readonly center: WorldCharacter | null;
  readonly nodes: readonly WorldRelationshipEvidenceNode[];
  readonly edges: readonly WorldRelationshipEvidenceEdge[];
  readonly unlinkedEvidence: readonly WorldRelationshipEvidenceRecord[];
  readonly evidenceCharacters: readonly WorldCharacter[];
  readonly density: WorldRelationshipEvidenceDensity;
  readonly kindCounts: Readonly<Record<WorldRelationshipEvidenceKind, number>>;
  readonly summary: {
    readonly worldCharacterCount: number;
    readonly relationshipCount: number;
    readonly timelineEventCount: number;
    readonly evidenceCharacterCount: number;
    readonly linkedCharacterCount: number;
    readonly clueCharacterCount: number;
    readonly emptyCharacterCount: number;
    readonly linkedEvidenceCount: number;
    readonly unlinkedEvidenceCount: number;
  };
};

const KIND_PRIORITY: Record<WorldRelationshipEvidenceKind, number> = {
  association: 80,
  kinship: 76,
  office: 68,
  text: 62,
  entry: 58,
  address: 48,
  status: 42,
  topic: 24,
};

const EMPTY_KIND_COUNTS: Record<WorldRelationshipEvidenceKind, number> = {
  association: 0,
  kinship: 0,
  office: 0,
  text: 0,
  entry: 0,
  address: 0,
  status: 0,
  topic: 0,
};

const HAN_PERSON_NAME_PATTERN = '[\\u3400-\\u9fff·]{2,8}';
const KINSHIP_TERMS = [
  '外祖父',
  '外祖母',
  '曾祖父',
  '曾祖母',
  '祖父',
  '祖母',
  '伯父',
  '叔父',
  '父亲',
  '母亲',
  '兄长',
  '弟弟',
  '长子',
  '次子',
  '三子',
  '四子',
  '五子',
  '幼子',
  '长女',
  '次女',
  '侄子',
  '侄女',
  '族兄',
  '族弟',
  '父',
  '母',
  '兄',
  '弟',
  '子',
  '女',
  '夫',
  '妻',
] as const;

const KINSHIP_TARGET_STOP_WORDS = [
  '亲属',
  '亲族',
  '族人',
  '家族',
  '宗族',
  '渊源',
  '传承',
] as const;

const KINSHIP_ROLE_PREFIX_TERMS = KINSHIP_TERMS.filter((term) => term.length > 1);

const EVIDENCE_KIND_PREFIX = /^(?:kinship|association|office|text|entry|address|status|topic)\s*[:：]\s*/i;

function normalizeEvidenceText(value: string): string {
  return value.replace(EVIDENCE_KIND_PREFIX, '').replace(/\s+/g, ' ').trim();
}

function relationshipEvidenceTexts(character: WorldCharacter): string[] {
  return (character.tags ?? [])
    .map(normalizeEvidenceText)
    .filter((text) => text.length > 0);
}

function textIncludesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKinshipTargetName(value: string, source: WorldCharacter): string | null {
  const withoutPrefix = value
    .replace(/^(?:其|其之|他的|她的|为|是)+/, '')
    .trim();
  const genericBoundary = ['家族', '宗族', '渊源', '传承']
    .map((token) => withoutPrefix.indexOf(token))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0];
  const candidate = (genericBoundary ? withoutPrefix.slice(0, genericBoundary) : withoutPrefix).trim();
  if (candidate.length < 2 || candidate.length > 8) {
    return null;
  }
  if (/[是为其的他她]/.test(candidate)) {
    return null;
  }
  // Narrative verbs never appear in person names; a candidate containing one is
  // a sentence fragment ("早年丧父", "娶王茂元之女"), not an extracted name.
  if (/[丧娶嫁逝卒亡病殁早]/.test(candidate)) {
    return null;
  }
  if (KINSHIP_ROLE_PREFIX_TERMS.some((term) => candidate.startsWith(term))) {
    return null;
  }
  // A candidate that still contains the source's own name is a narrative
  // fragment about the source, not a kinship target.
  if (candidate.includes(source.name) || KINSHIP_TARGET_STOP_WORDS.includes(candidate as (typeof KINSHIP_TARGET_STOP_WORDS)[number])) {
    return null;
  }
  return candidate;
}

// One alternation ordered longest-first so "父亲李嗣" resolves the term as
// 父亲 → 李嗣 instead of also matching 父 → 亲李嗣.
const KINSHIP_TERM_ALTERNATION = [...KINSHIP_TERMS]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join('|');

function extractKinshipTargetNames(text: string, source: WorldCharacter): string[] {
  const names = new Set<string>();
  const relationBeforeName = new RegExp(
    `(?:^|[\\s:：，。；、（(]|其|其之|他的|她的)(?:${KINSHIP_TERM_ALTERNATION})(?:为|是)?(${HAN_PERSON_NAME_PATTERN})`,
    'g',
  );
  for (const match of text.matchAll(relationBeforeName)) {
    const name = normalizeKinshipTargetName(match[1] ?? '', source);
    if (name) {
      names.add(name);
    }
  }

  const nameBeforeRelation = new RegExp(
    `(${HAN_PERSON_NAME_PATTERN})(?:是|为)?(?:其|其之|他的|她的)?(?:${KINSHIP_TERM_ALTERNATION})`,
    'g',
  );
  for (const match of text.matchAll(nameBeforeRelation)) {
    const name = normalizeKinshipTargetName(match[1] ?? '', source);
    if (name) {
      names.add(name);
    }
  }
  return [...names];
}

function inferredKinshipTargetId(source: WorldCharacter, targetName: string): string {
  return `${source.id}:kinship:${encodeURIComponent(targetName)}`;
}

export function classifyRelationshipEvidence(text: string): WorldRelationshipEvidenceKind {
  if (textIncludesAny(text, ['伯', '叔', '父', '母', '子', '女', '兄', '弟', '侄', '族', '亲', '夫', '妻'])) {
    return 'kinship';
  }
  if (textIncludesAny(text, ['交往', '交游', '交流', '往来', '同僚', '同门', '同年', '友', '师', '学术', '理学'])) {
    return 'association';
  }
  if (textIncludesAny(text, ['翰林', '官', '任', '仕', '职', '承旨', '朝廷', '迁', '除', '授'])) {
    return 'office';
  }
  if (textIncludesAny(text, ['《', '》', '著', '文集', '诗', '书', '碑', '序', '记', '题'])) {
    return 'text';
  }
  if (textIncludesAny(text, ['征辟', '入仕', '科举', '进士', '荐', '举'])) {
    return 'entry';
  }
  if (textIncludesAny(text, ['籍', '路', '府', '州', '县', '书院', '地', '居'])) {
    return 'address';
  }
  if (textIncludesAny(text, ['身份', '地位', '声望', '评价'])) {
    return 'status';
  }
  return 'topic';
}

function isRelationLikeEvidence(text: string): boolean {
  if (textIncludesAny(text, ['未确认', '未见', '没有直接', '无直接', '未出现在', '不构成'])) {
    return false;
  }
  if (classifyRelationshipEvidence(text) !== 'topic') {
    return true;
  }
  return text.length >= 8 && /[，。；:：]/.test(text);
}

function characterNameCanMatch(name: string): boolean {
  return name.trim().length >= 2;
}

function mentionedTargets(
  text: string,
  source: WorldCharacter,
  characters: readonly WorldCharacter[],
): WorldCharacter[] {
  return characters
    .filter((candidate) => candidate.id !== source.id)
    .filter((candidate) => characterNameCanMatch(candidate.name))
    .filter((candidate) => text.includes(candidate.name));
}

function edgeSortKey(edge: WorldRelationshipEvidenceEdge): number {
  return edge.weight + KIND_PRIORITY[edge.kind];
}

function buildEvidenceRecords(
  source: WorldCharacter,
  characters: readonly WorldCharacter[],
): WorldRelationshipEvidenceRecord[] {
  const records: WorldRelationshipEvidenceRecord[] = [];
  relationshipEvidenceTexts(source).forEach((text, sourceIndex) => {
    if (!isRelationLikeEvidence(text)) {
      return;
    }
    const kind = classifyRelationshipEvidence(text);
    const targets = mentionedTargets(text, source, characters);
    let linkedRecordCount = 0;
    targets.forEach((target) => {
      records.push({
        id: `${source.id}:tag:${sourceIndex}:${target.id}`,
        sourceCharacterId: source.id,
        sourceName: source.name,
        targetCharacterId: target.id,
        targetName: target.name,
        targetIsWorldCharacter: true,
        kind,
        evidenceText: text,
        sourceField: 'source.tags' as const,
        sourceIndex,
      });
      linkedRecordCount += 1;
    });
    if (kind === 'kinship') {
      const existingTargetNames = new Set(targets.map((target) => target.name));
      for (const targetName of extractKinshipTargetNames(text, source)) {
        if (existingTargetNames.has(targetName)) {
          continue;
        }
        records.push({
          id: `${source.id}:tag:${sourceIndex}:${inferredKinshipTargetId(source, targetName)}`,
          sourceCharacterId: source.id,
          sourceName: source.name,
          targetCharacterId: inferredKinshipTargetId(source, targetName),
          targetName,
          targetIsWorldCharacter: false,
          kind,
          evidenceText: text,
          sourceField: 'source.tags' as const,
          sourceIndex,
        });
        linkedRecordCount += 1;
      }
    }
    if (linkedRecordCount === 0) {
      records.push({
        id: `${source.id}:tag:${sourceIndex}:unlinked`,
        sourceCharacterId: source.id,
        sourceName: source.name,
        targetCharacterId: null,
        targetName: null,
        targetIsWorldCharacter: false,
        kind,
        evidenceText: text,
        sourceField: 'source.tags' as const,
        sourceIndex,
      });
    }
  });
  return records;
}

function sortCharacterBuckets(
  left: WorldRelationshipEvidenceCharacterBucket,
  right: WorldRelationshipEvidenceCharacterBucket,
): number {
  const leftScore = left.linkedEvidenceCount * 10 + left.unlinkedEvidenceCount;
  const rightScore = right.linkedEvidenceCount * 10 + right.unlinkedEvidenceCount;
  return rightScore - leftScore || left.character.name.localeCompare(right.character.name);
}

function buildCharacterEvidenceBucket(
  character: WorldCharacter,
  characters: readonly WorldCharacter[],
): WorldRelationshipEvidenceCharacterBucket {
  const records = buildEvidenceRecords(character, characters);
  const linkedRecords = records.filter((record) => record.targetCharacterId);
  const unlinkedRecords = records.filter((record) => !record.targetCharacterId);
  const primaryKind = linkedRecords[0]?.kind ?? unlinkedRecords[0]?.kind ?? null;
  return {
    character,
    status: linkedRecords.length > 0
      ? 'linked'
      : unlinkedRecords.length > 0
        ? 'clueOnly'
        : 'empty',
    linkedEvidenceCount: linkedRecords.length,
    unlinkedEvidenceCount: unlinkedRecords.length,
    primaryKind,
  };
}

function buildRelationshipEvidenceDensity(characters: readonly WorldCharacter[]): WorldRelationshipEvidenceDensity {
  const buckets = characters.map((character) => buildCharacterEvidenceBucket(character, characters));
  return {
    linked: buckets.filter((bucket) => bucket.status === 'linked').sort(sortCharacterBuckets),
    clueOnly: buckets.filter((bucket) => bucket.status === 'clueOnly').sort(sortCharacterBuckets),
    empty: buckets.filter((bucket) => bucket.status === 'empty').sort(sortCharacterBuckets),
  };
}

function mergeRecordsIntoEdges(
  records: readonly WorldRelationshipEvidenceRecord[],
  characters: readonly WorldCharacter[],
): WorldRelationshipEvidenceEdge[] {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const grouped = new Map<string, WorldRelationshipEvidenceRecord[]>();
  for (const record of records) {
    if (!record.targetCharacterId || !record.targetName) {
      continue;
    }
    const key = `${record.sourceCharacterId}:${record.targetCharacterId}:${record.kind}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return Array.from(grouped.entries()).map(([id, group]) => {
    const first = group[0];
    const target = first?.targetCharacterId ? byId.get(first.targetCharacterId) ?? null : null;
    const evidenceTexts = [...new Set(group.map((record) => record.evidenceText))];
    const sourceFields = [...new Set(group.map((record) => `${record.sourceField}[${record.sourceIndex}]`))];
    return {
      id,
      sourceCharacterId: first?.sourceCharacterId ?? '',
      sourceName: first?.sourceName ?? '',
      targetCharacterId: first?.targetCharacterId ?? '',
      targetName: first?.targetName ?? '',
      targetIsWorldCharacter: first?.targetIsWorldCharacter ?? false,
      targetRole: target?.role ?? null,
      targetFaction: target?.faction ?? null,
      kind: first?.kind ?? 'topic',
      evidenceTexts,
      sourceFields,
      weight: evidenceTexts.length * 12,
    };
  }).sort((left, right) => edgeSortKey(right) - edgeSortKey(left) || left.targetName.localeCompare(right.targetName));
}

function chooseCenterCharacter(
  characters: readonly WorldCharacter[],
  density: WorldRelationshipEvidenceDensity,
  preferredCenterId?: string | null,
): WorldCharacter | null {
  if (characters.length === 0) {
    return null;
  }
  const preferred = preferredCenterId
    ? characters.find((character) => character.id === preferredCenterId) ?? null
    : null;
  if (preferred) {
    return preferred;
  }
  return density.linked.find((bucket) => bucket.character.importance === 'PRIMARY')?.character
    ?? density.linked[0]?.character
    ?? density.clueOnly.find((bucket) => bucket.character.importance === 'PRIMARY')?.character
    ?? density.clueOnly[0]?.character
    ?? characters.find((character) => character.importance === 'PRIMARY')
    ?? characters[0]
    ?? null;
}

function emptyGraph(
  world: WorldDetailData,
  history: WorldHistoryBundle,
  characters: readonly WorldCharacter[],
  density: WorldRelationshipEvidenceDensity,
  center: WorldCharacter | null,
): WorldRelationshipEvidenceGraph {
  const evidenceCharacterCount = density.linked.length + density.clueOnly.length;
  return {
    center,
    nodes: [],
    edges: [],
    unlinkedEvidence: [],
    evidenceCharacters: [...density.linked, ...density.clueOnly].map((bucket) => bucket.character),
    density,
    kindCounts: EMPTY_KIND_COUNTS,
    summary: {
      worldCharacterCount: characters.length,
      relationshipCount: world.relationshipCount ?? 0,
      timelineEventCount: history.summary?.totalCount ?? history.items.length,
      evidenceCharacterCount,
      linkedCharacterCount: density.linked.length,
      clueCharacterCount: density.clueOnly.length,
      emptyCharacterCount: density.empty.length,
      linkedEvidenceCount: 0,
      unlinkedEvidenceCount: 0,
    },
  };
}

export function buildWorldRelationshipEvidenceGraph({
  world,
  characters,
  history,
  preferredCenterId,
}: {
  readonly world: WorldDetailData;
  readonly characters: readonly WorldCharacter[];
  readonly history: WorldHistoryBundle;
  readonly preferredCenterId?: string | null;
}): WorldRelationshipEvidenceGraph {
  const density = buildRelationshipEvidenceDensity(characters);
  const center = chooseCenterCharacter(characters, density, preferredCenterId);
  if (!center) {
    return emptyGraph(world, history, characters, density, null);
  }
  const records = buildEvidenceRecords(center, characters);
  const edges = mergeRecordsIntoEdges(records, characters);
  const unlinkedEvidence = records.filter((record) => !record.targetCharacterId);
  const kindCounts = edges.reduce<Record<WorldRelationshipEvidenceKind, number>>((counts, edge) => ({
    ...counts,
    [edge.kind]: counts[edge.kind] + edge.evidenceTexts.length,
  }), { ...EMPTY_KIND_COUNTS });
  const nodes = edges.map((edge) => {
    const character = characters.find((candidate) => candidate.id === edge.targetCharacterId);
    return character ? {
      character,
      edgeCount: edge.evidenceTexts.length,
      primaryKind: edge.kind,
    } : null;
  }).filter((node): node is WorldRelationshipEvidenceNode => Boolean(node));
  const evidenceCharacterCount = density.linked.length + density.clueOnly.length;

  return {
    center,
    nodes,
    edges,
    unlinkedEvidence,
    evidenceCharacters: [...density.linked, ...density.clueOnly].map((bucket) => bucket.character),
    density,
    kindCounts,
    summary: {
      worldCharacterCount: characters.length,
      relationshipCount: world.relationshipCount ?? 0,
      timelineEventCount: history.summary?.totalCount ?? history.items.length,
      evidenceCharacterCount,
      linkedCharacterCount: density.linked.length,
      clueCharacterCount: density.clueOnly.length,
      emptyCharacterCount: density.empty.length,
      linkedEvidenceCount: edges.reduce((sum, edge) => sum + edge.evidenceTexts.length, 0),
      unlinkedEvidenceCount: unlinkedEvidence.length,
    },
  };
}
