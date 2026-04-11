import { getPlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime/types-media.js';
import type { ObservationDimension } from '../../knowledge-base/index.js';
import { resolveParentosTextGenerateConfig } from '../settings/parentos-ai-runtime.js';

export interface JournalTagSuggestion {
  dimensionId: string | null;
  tags: string[];
}

function normalizeDraftText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('journal AI tagging requires draft text');
  }
  return normalized;
}

function normalizeCandidateDimensions(dimensions: readonly ObservationDimension[]) {
  if (dimensions.length === 0) {
    throw new Error('journal AI tagging requires at least one candidate dimension');
  }
  return dimensions.map((dimension) => ({
    dimensionId: dimension.dimensionId,
    displayName: dimension.displayName,
    description: dimension.description,
    guidedQuestions: dimension.guidedQuestions,
    quickTags: dimension.quickTags,
  }));
}

function buildPrompt(
  draftText: string,
  candidateDimensions: ReturnType<typeof normalizeCandidateDimensions>,
) {
  return [
    'You are classifying a ParentOS observation journal draft into a closed observation vocabulary.',
    'Return JSON only with no markdown, no prose, and no code fences.',
    'Use this exact schema:',
    '{"dimensionId":"allowed-id-or-null","tags":["allowed-tag-1","allowed-tag-2"]}',
    'Rules:',
    '- Choose at most one dimensionId from the allowed dimensions below.',
    '- Choose only tags from that dimension\'s quickTags.',
    '- If there is not enough evidence, return {"dimensionId":null,"tags":[]}.',
    '- Do not output diagnosis, theory explanation, treatment, parenting advice, or open-vocabulary labels.',
    '- Use only evidence explicitly present in the draft text.',
    '',
    `Draft text: ${draftText}`,
    '',
    `Allowed dimensions: ${JSON.stringify(candidateDimensions)}`,
  ].join('\n');
}

function buildInput(
  draftText: string,
  candidateDimensions: ReturnType<typeof normalizeCandidateDimensions>,
): TextMessage[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildPrompt(draftText, candidateDimensions),
        },
      ],
    },
  ];
}

export function parseJournalTagSuggestion(
  raw: string,
  candidateDimensions: readonly ObservationDimension[],
): JournalTagSuggestion {
  const payload = JSON.parse(raw.trim()) as {
    dimensionId?: unknown;
    tags?: unknown;
  };

  const candidateDimensionMap = new Map(
    candidateDimensions.map((dimension) => [dimension.dimensionId, dimension]),
  );

  const rawDimensionId = payload.dimensionId;
  const dimensionId = rawDimensionId == null ? null : String(rawDimensionId).trim();

  if (dimensionId !== null && !candidateDimensionMap.has(dimensionId)) {
    throw new Error(`journal AI tagging returned unknown dimensionId "${dimensionId}"`);
  }

  if (!Array.isArray(payload.tags)) {
    throw new Error('journal AI tagging response is missing tags');
  }

  const uniqueTags = [...new Set(payload.tags.map((tag) => String(tag).trim()).filter(Boolean))];
  if (dimensionId === null) {
    if (uniqueTags.length > 0) {
      throw new Error('journal AI tagging returned tags without a dimensionId');
    }
    return { dimensionId: null, tags: [] };
  }

  const allowedTags = new Set(candidateDimensionMap.get(dimensionId)?.quickTags ?? []);
  for (const tag of uniqueTags) {
    if (!allowedTags.has(tag)) {
      throw new Error(`journal AI tagging returned unsupported tag "${tag}"`);
    }
  }

  return {
    dimensionId,
    tags: uniqueTags,
  };
}

export async function hasJournalTaggingRuntime() {
  try {
    const client = getPlatformClient();
    return Boolean(client.runtime?.appId && client.runtime?.ai?.text?.generate);
  } catch {
    return false;
  }
}

export async function suggestJournalTags(input: {
  draftText: string;
  candidateDimensions: readonly ObservationDimension[];
}): Promise<JournalTagSuggestion> {
  const draftText = normalizeDraftText(input.draftText);
  const candidateDimensions = normalizeCandidateDimensions(input.candidateDimensions);

  const client = getPlatformClient();
  if (!client.runtime?.ai?.text?.generate) {
    throw new Error('ParentOS journal AI tagging runtime is unavailable');
  }

  const aiParams = resolveParentosTextGenerateConfig({ temperature: 0, maxTokens: 500 });
  const output = await client.runtime.ai.text.generate({
    ...aiParams,
    route: aiParams.route ?? 'local',
    input: buildInput(draftText, candidateDimensions),
    metadata: {
      callerKind: 'third-party-app',
      callerId: 'app.nimi.parentos',
      surfaceId: 'parentos.journal.ai-tagging',
    },
  });

  return parseJournalTagSuggestion(output.text, input.candidateDimensions);
}
