import { getPlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime/types-media.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosImageTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';

const PRIMARY_FDI = new Set([
  '51', '52', '53', '54', '55',
  '61', '62', '63', '64', '65',
  '71', '72', '73', '74', '75',
  '81', '82', '83', '84', '85',
]);

const PERMANENT_FDI = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '31', '32', '33', '34', '35', '36', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48',
]);

export type DentalToothType = 'primary' | 'permanent';

export interface DentalEruptionCandidate {
  toothId: string;
  type: DentalToothType;
  confidence: number;
}

export interface DentalEruptionExtraction {
  candidates: DentalEruptionCandidate[];
  warnings: string[];
}

const DENTAL_SCAN_INVALID_JSON_MESSAGE = 'AI 识别返回的结果格式不完整，请重试或换一张更清晰的照片。';
const DENTAL_SCAN_IMAGE_INPUT_UNSUPPORTED_MESSAGE = '当前 AI 对话模型不支持图片识别，请在 AI 设置中切换到支持视觉输入的模型后重试。';
const DENTAL_SCAN_FAILED_MESSAGE = 'AI 识别失败，请重试。';

function isValidToothId(value: string): value is string {
  return PRIMARY_FDI.has(value) || PERMANENT_FDI.has(value);
}

function typeMatchesToothId(toothId: string, type: DentalToothType): boolean {
  return type === 'primary' ? PRIMARY_FDI.has(toothId) : PERMANENT_FDI.has(toothId);
}

function parseExtractionPayload(payload: { teeth?: unknown; warnings?: unknown }): DentalEruptionExtraction {
  if (!Array.isArray(payload.teeth)) {
    throw new Error('dental scan response is missing a teeth array');
  }

  const seen = new Set<string>();
  const candidates: DentalEruptionCandidate[] = [];

  for (let index = 0; index < payload.teeth.length; index++) {
    const item = payload.teeth[index];
    if (!item || typeof item !== 'object') {
      throw new Error(`dental scan tooth ${index + 1} is not an object`);
    }
    const raw = item as { toothId?: unknown; type?: unknown; status?: unknown; confidence?: unknown };
    const status = String(raw.status ?? '').trim().toLowerCase();
    if (status !== 'erupted') {
      continue;
    }
    const toothId = String(raw.toothId ?? '').trim();
    if (!isValidToothId(toothId)) {
      continue;
    }
    const type = String(raw.type ?? '').trim().toLowerCase();
    if (type !== 'primary' && type !== 'permanent') {
      continue;
    }
    if (!typeMatchesToothId(toothId, type)) {
      continue;
    }
    if (seen.has(toothId)) {
      continue;
    }
    seen.add(toothId);
    const confidenceRaw = Number(raw.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.min(Math.max(confidenceRaw, 0), 1)
      : 0.5;
    candidates.push({ toothId, type, confidence });
  }

  const warnings: string[] = [];
  if (Array.isArray(payload.warnings)) {
    for (const entry of payload.warnings) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        warnings.push(entry.trim());
      }
    }
  }

  return { candidates, warnings };
}

function extractJsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  for (const match of trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/gi)) {
    push(match[1] ?? '');
  }
  push(trimmed);

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return out;
}

function parseDentalEruptionExtraction(raw: string): DentalEruptionExtraction {
  const candidates = extractJsonCandidates(raw);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate) as { teeth?: unknown; warnings?: unknown };
      return parseExtractionPayload(payload);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) throw lastError;
  throw new Error(DENTAL_SCAN_INVALID_JSON_MESSAGE);
}

function buildScanPrompt(context: { ageMonths: number }): string {
  const ageLabel = context.ageMonths < 24
    ? `${context.ageMonths} months`
    : `${Math.floor(context.ageMonths / 12)} years ${context.ageMonths % 12} months`;
  return [
    'You are a pediatric dentist assisting a parent-facing app.',
    `The image shows a child's teeth. The child is ${ageLabel} old.`,
    'The image may be: a panoramic dental X-ray, an intraoral photo, a smile photo, or an occlusal photo.',
    'Task: list ONLY teeth that are clearly visible and fully or partially erupted in the oral cavity.',
    '- Do NOT list teeth that are still inside the jaw bone (unerupted).',
    '- Do NOT list teeth that are completely missing.',
    '- Do NOT diagnose caries, fillings, alignment, or any medical condition.',
    'Use FDI tooth numbering (ISO 3950). Primary teeth use 51-55, 61-65, 71-75, 81-85. Permanent teeth use 11-18, 21-28, 31-38, 41-48.',
    'Quadrant reminder: from the viewer\'s perspective looking at the patient, upper-right quadrant uses 1x (primary 5x), upper-left uses 2x (primary 6x), lower-left uses 3x (primary 7x), lower-right uses 4x (primary 8x). Do not mirror the quadrants.',
    'For each erupted tooth return an object with: toothId (string, FDI), type ("primary" or "permanent"), status (always "erupted" for the items you list), confidence (0.0-1.0).',
    'If you are uncertain whether a crown belongs to a primary or permanent tooth, make your best determination from crown size, morphology, and the child\'s age; lower the confidence accordingly.',
    'Return JSON only with no markdown, no prose, and no code fences. Use this exact schema:',
    '{"teeth":[{"toothId":"11","type":"permanent","status":"erupted","confidence":0.9}],"warnings":["optional short note to the parent, e.g. image unclear or tilted"]}',
    'If no erupted teeth can be confirmed, return {"teeth":[],"warnings":["..."]}.',
  ].join('\n');
}

function buildScanInput(imageUrl: string, context: { ageMonths: number }): TextMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: buildScanPrompt(context) },
        { type: 'image_url', imageUrl, detail: 'high' },
      ],
    },
  ];
}

function buildRepairPrompt(raw: string): string {
  return [
    'Normalize the following dental scan extraction into strict JSON with no markdown.',
    'Schema:',
    '{"teeth":[{"toothId":"11","type":"primary|permanent","status":"erupted","confidence":0.0-1.0}],"warnings":["string"]}',
    'Rules:',
    '- Drop any tooth that is not clearly erupted.',
    '- Drop any tooth whose toothId is not a valid FDI code.',
    '- Do not invent teeth that are absent from the original output.',
    '- If nothing can be reconstructed return {"teeth":[],"warnings":[]}.',
    '',
    'Raw output:',
    raw.trim(),
  ].join('\n');
}

async function repairDentalEruptionExtraction(input: {
  client: ReturnType<typeof getPlatformClient>;
  aiParams: {
    model: string;
    route?: 'local' | 'cloud';
    connectorId?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
  raw: string;
}): Promise<DentalEruptionExtraction> {
  const repaired = await input.client.runtime.ai.text.generate({
    ...input.aiParams,
    temperature: 0,
    maxTokens: Math.max(input.aiParams.maxTokens ?? 1200, 1200),
    input: [{ role: 'user', content: buildRepairPrompt(input.raw) }],
    metadata: buildParentosRuntimeMetadata('parentos.profile.dental-eruption-scan'),
  });
  return parseDentalEruptionExtraction(repaired.text);
}

function isImageInputUnsupportedError(error: unknown): boolean {
  const candidate = error as {
    message?: unknown;
    code?: unknown;
    reasonCode?: unknown;
    details?: { reasonCode?: unknown } | null;
  };
  const texts = [
    candidate?.message,
    candidate?.code,
    candidate?.reasonCode,
    candidate?.details?.reasonCode,
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  return texts.some((text) => text.includes('AI_MODALITY_NOT_SUPPORTED'));
}

function isStructuredParseError(error: Error): boolean {
  return error.message === DENTAL_SCAN_INVALID_JSON_MESSAGE
    || error.message.startsWith('dental scan');
}

export function normalizeDentalScanError(error: unknown): Error {
  if (isImageInputUnsupportedError(error)) {
    return new Error(DENTAL_SCAN_IMAGE_INPUT_UNSUPPORTED_MESSAGE);
  }
  if (error instanceof Error) {
    if (isStructuredParseError(error)) {
      return new Error(DENTAL_SCAN_INVALID_JSON_MESSAGE);
    }
    return error;
  }
  return new Error(DENTAL_SCAN_FAILED_MESSAGE);
}

export function getDentalScanDisplayMessage(error: unknown): string {
  return normalizeDentalScanError(error).message;
}

export async function hasDentalScanRuntime() {
  try {
    const client = getPlatformClient();
    return Boolean(client.runtime?.appId && client.runtime?.ai?.text?.generate);
  } catch {
    return false;
  }
}

export async function analyzeDentalEruptionImage(input: {
  imageUrl: string;
  ageMonths: number;
}): Promise<DentalEruptionExtraction> {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) {
    throw new Error('dental scan requires an imageUrl');
  }

  const client = getPlatformClient();
  if (!client.runtime?.ai?.text?.generate) {
    throw new Error('ParentOS dental scan runtime is unavailable');
  }

  try {
    const aiParams = await resolveParentosImageTextRuntimeConfig(
      'parentos.profile.dental-eruption-scan',
      { temperature: 0, maxTokens: 1200 },
    );
    await ensureParentosLocalRuntimeReady({
      route: aiParams.route,
      localModelId: aiParams.localModelId,
      timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
    });
    const output = await client.runtime.ai.text.generate({
      ...aiParams,
      input: buildScanInput(imageUrl, { ageMonths: input.ageMonths }),
      metadata: buildParentosRuntimeMetadata('parentos.profile.dental-eruption-scan'),
    });

    try {
      return parseDentalEruptionExtraction(output.text);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== DENTAL_SCAN_INVALID_JSON_MESSAGE) {
        throw error;
      }
      return await repairDentalEruptionExtraction({
        client,
        aiParams: {
          model: aiParams.model,
          route: aiParams.route,
          connectorId: aiParams.connectorId,
          temperature: aiParams.temperature,
          topP: aiParams.topP,
          maxTokens: aiParams.maxTokens,
          timeoutMs: aiParams.timeoutMs,
        },
        raw: output.text,
      });
    }
  } catch (error) {
    throw normalizeDentalScanError(error);
  }
}

const QUADRANT_FLIP: Record<string, string> = {};
for (let unit = 1; unit <= 8; unit++) {
  const u = String(unit);
  QUADRANT_FLIP[`1${u}`] = `2${u}`;
  QUADRANT_FLIP[`2${u}`] = `1${u}`;
  QUADRANT_FLIP[`3${u}`] = `4${u}`;
  QUADRANT_FLIP[`4${u}`] = `3${u}`;
  if (unit <= 5) {
    QUADRANT_FLIP[`5${u}`] = `6${u}`;
    QUADRANT_FLIP[`6${u}`] = `5${u}`;
    QUADRANT_FLIP[`7${u}`] = `8${u}`;
    QUADRANT_FLIP[`8${u}`] = `7${u}`;
  }
}

export function flipCandidatesHorizontally(candidates: DentalEruptionCandidate[]): DentalEruptionCandidate[] {
  return candidates.map((candidate) => {
    const mirrored = QUADRANT_FLIP[candidate.toothId];
    if (!mirrored) return candidate;
    return { ...candidate, toothId: mirrored };
  });
}
