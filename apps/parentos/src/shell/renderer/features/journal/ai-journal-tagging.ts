import { getPlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime/types-media.js';
import type { ObservationDimension } from '../../knowledge-base/index.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';

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

function extractJson(raw: string): string {
  let text = raw.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1]!.trim();
  // Extract the first JSON object if surrounded by prose
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    text = text.slice(braceStart, braceEnd + 1);
  }
  return text;
}

export function parseJournalTagSuggestion(
  raw: string,
  candidateDimensions: readonly ObservationDimension[],
): JournalTagSuggestion {
  let payload: { dimensionId?: unknown; tags?: unknown };
  try {
    payload = JSON.parse(extractJson(raw)) as typeof payload;
  } catch (err) {
    console.warn('[journal] AI tagging JSON parse failed. Raw output:', raw.slice(0, 300), err instanceof Error ? err.message : '');
    return { dimensionId: null, tags: [] };
  }

  const candidateDimensionMap = new Map(
    candidateDimensions.map((dimension) => [dimension.dimensionId, dimension]),
  );

  const rawDimensionId = payload.dimensionId;
  const dimensionId = rawDimensionId == null ? null : String(rawDimensionId).trim();

  if (dimensionId !== null && !candidateDimensionMap.has(dimensionId)) {
    return { dimensionId: null, tags: [] };
  }

  if (!Array.isArray(payload.tags)) {
    return { dimensionId: null, tags: [] };
  }

  const uniqueTags = [...new Set(payload.tags.map((tag) => String(tag).trim()).filter(Boolean))];
  if (dimensionId === null) {
    return { dimensionId: null, tags: [] };
  }

  const allowedTags = new Set(candidateDimensionMap.get(dimensionId)?.quickTags ?? []);
  const validTags = uniqueTags.filter((tag) => allowedTags.has(tag));

  return {
    dimensionId,
    tags: validTags,
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

  const aiParams = await resolveParentosTextRuntimeConfig('parentos.journal.ai-tagging', { temperature: 0, maxTokens: 1024 });
  await ensureParentosLocalRuntimeReady({
    route: aiParams.route,
    localModelId: aiParams.localModelId,
    timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  });
  const output = await client.runtime.ai.text.generate({
    ...aiParams,
    input: buildInput(draftText, candidateDimensions),
    metadata: buildParentosRuntimeMetadata('parentos.journal.ai-tagging'),
  });

  if (typeof output.text === 'string' && output.text.trim()) {
    console.debug('[journal] AI tagging raw response:', output.text.slice(0, 500));
  }

  return parseJournalTagSuggestion(output.text, input.candidateDimensions);
}
