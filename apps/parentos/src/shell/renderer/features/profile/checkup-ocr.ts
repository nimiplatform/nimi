import { getPlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime/types-media.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosImageTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';

const SUPPORTED_IMPORT_TYPES = [
  'height',
  'weight',
  'head-circumference',
  'bmi',
  'vision-left',
  'vision-right',
  'corrected-vision-left',
  'corrected-vision-right',
  'refraction-sph-left',
  'refraction-sph-right',
  'refraction-cyl-left',
  'refraction-cyl-right',
  'refraction-axis-left',
  'refraction-axis-right',
  'axial-length-left',
  'axial-length-right',
  'corneal-curvature-left',
  'corneal-curvature-right',
  'iop-left',
  'iop-right',
  'corneal-k1-left',
  'corneal-k1-right',
  'corneal-k2-left',
  'corneal-k2-right',
  'acd-left',
  'acd-right',
  'lt-left',
  'lt-right',
  'lab-vitamin-d',
  'lab-ferritin',
  'lab-hemoglobin',
  'lab-calcium',
  'lab-zinc',
] as const satisfies readonly GrowthTypeId[];

export type OCRImportTypeId = (typeof SUPPORTED_IMPORT_TYPES)[number];

export interface OCRMeasurementCandidate {
  typeId: OCRImportTypeId;
  value: number;
  measuredAt: string;
  notes: string | null;
}

export interface OCRMeasurementExtraction {
  measurements: OCRMeasurementCandidate[];
}

const SUPPORTED_IMPORT_TYPE_SET = new Set<OCRImportTypeId>(SUPPORTED_IMPORT_TYPES);
const CHECKUP_OCR_INVALID_JSON_MESSAGE = '\u667a\u80fd\u8bc6\u522b\u8fd4\u56de\u7684\u7ed3\u679c\u683c\u5f0f\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u8bd5\u6216\u6362\u4e00\u5f20\u66f4\u6e05\u6670\u7684\u62a5\u544a\u56fe\u3002';
const CHECKUP_OCR_IMAGE_INPUT_UNSUPPORTED_MESSAGE = '\u5f53\u524d AI \u5bf9\u8bdd\u6a21\u578b\u4e0d\u652f\u6301\u56fe\u7247\u8bc6\u522b\uff0c\u8bf7\u5728 AI \u8bbe\u7f6e\u4e2d\u5207\u6362\u5230\u652f\u6301\u89c6\u89c9\u8f93\u5165\u7684\u6a21\u578b\u540e\u91cd\u8bd5\u3002';
const CHECKUP_OCR_FAILED_MESSAGE = '\u667a\u80fd\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002';

function isOCRImportTypeId(value: string): value is OCRImportTypeId {
  return SUPPORTED_IMPORT_TYPE_SET.has(value as OCRImportTypeId);
}

function assertISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`OCR measurement date must use YYYY-MM-DD, got "${value}"`);
  }
  return value;
}

function parseOCRMeasurementPayload(payload: { measurements?: unknown }): OCRMeasurementExtraction {
  if (!Array.isArray(payload.measurements)) {
    throw new Error('OCR response is missing a measurements array');
  }

  const measurements = payload.measurements.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`OCR measurement ${index + 1} is not an object`);
    }

    const typeId = String((candidate as { typeId?: unknown }).typeId ?? '').trim();
    if (!isOCRImportTypeId(typeId)) {
      throw new Error(`OCR measurement ${index + 1} has unsupported typeId "${typeId}"`);
    }

    const value = Number((candidate as { value?: unknown }).value);
    if (!Number.isFinite(value)) {
      throw new Error(`OCR measurement ${index + 1} is missing a numeric value`);
    }

    const measuredAt = assertISODate(String((candidate as { measuredAt?: unknown }).measuredAt ?? '').trim());
    const notesRaw = (candidate as { notes?: unknown }).notes;
    const notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw.trim() : null;

    return {
      typeId,
      value,
      measuredAt,
      notes,
    };
  });

  return { measurements };
}

function extractOCRJsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value: string) => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  for (const match of trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/gi)) {
    pushCandidate(match[1] ?? '');
  }

  pushCandidate(trimmed);

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    pushCandidate(trimmed.slice(firstObject, lastObject + 1));
  }

  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    pushCandidate(`{"measurements":${trimmed.slice(firstArray, lastArray + 1)}}`);
  }

  const measurementsKeyIndex = trimmed.indexOf('"measurements"');
  if (measurementsKeyIndex >= 0) {
    const measurementSlice = trimmed.slice(measurementsKeyIndex);
    const arrayStart = measurementSlice.indexOf('[');
    const arrayEnd = measurementSlice.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      pushCandidate(`{${measurementSlice.slice(0, arrayEnd + 1)}}`);
    }
  }

  return candidates;
}

function parseOCRMeasurementExtraction(raw: string): OCRMeasurementExtraction {
  const candidates = extractOCRJsonCandidates(raw);
  let lastStructuredError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate) as { measurements?: unknown };
      return parseOCRMeasurementPayload(payload);
    } catch (error) {
      if (error instanceof SyntaxError) {
        continue;
      }
      lastStructuredError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastStructuredError) {
    throw lastStructuredError;
  }
  throw new Error(CHECKUP_OCR_INVALID_JSON_MESSAGE);
}

function buildOCRPrompt(): string {
  const supportedTypeIds = SUPPORTED_IMPORT_TYPES.join('|');
  return [
    'You are extracting structured pediatric growth measurements from a health-sheet image.',
    'Return JSON only with no markdown, no prose, and no code fences.',
    'Use this exact schema:',
    `{"measurements":[{"typeId":"${supportedTypeIds}","value":123.4,"measuredAt":"YYYY-MM-DD","notes":"optional short extraction note or null"}]}`,
    'Rules:',
    '- Extract only values explicitly visible in the image.',
    '- Do not infer missing measurements.',
    '- Map OD/right/R/\u53f3\u773c to *-right and OS/left/L/\u5de6\u773c to *-left.',
    '- Common eye-sheet aliases include SPH, CYL, AXIS, VA, corrected VA, AL/AXL, IOP, K1, K2, K avg/KM, ACD, and LT.',
    '- Do not output diagnosis, ranking, treatment, percentile, or advice.',
    '- If no supported measurement is visible, return {"measurements":[]}.',
  ].join('\n');
}

function buildOCRInput(imageUrl: string): TextMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: buildOCRPrompt() },
        { type: 'image_url', imageUrl, detail: 'high' },
      ],
    },
  ];
}

export function parseCheckupOCRResponse(raw: string) {
  return parseOCRMeasurementExtraction(raw.trim());
}

function buildOCRRepairPrompt(raw: string): string {
  const supportedTypeIds = SUPPORTED_IMPORT_TYPES.join('|');
  return [
    'Normalize this OCR extraction into strict JSON.',
    'Return JSON only with no markdown, no prose, and no code fences.',
    'Use this exact schema:',
    `{"measurements":[{"typeId":"${supportedTypeIds}","value":123.4,"measuredAt":"YYYY-MM-DD","notes":"optional short extraction note or null"}]}`,
    'Rules:',
    '- Use only values explicitly present in the OCR text below.',
    '- Drop any item if side, supported type, numeric value, or measuredAt cannot be determined explicitly.',
    '- Map OD/right/R/\u53f3\u773c to *-right and OS/left/L/\u5de6\u773c to *-left.',
    '- Common eye-sheet aliases include SPH, CYL, AXIS, VA, corrected VA, AL/AXL, IOP, K1, K2, K avg/KM, ACD, and LT.',
    '- If no supported measurement can be reconstructed, return {"measurements":[]}.',
    '',
    'Raw OCR output:',
    raw.trim(),
  ].join('\n');
}

async function repairOCRMeasurementExtraction(input: {
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
}): Promise<OCRMeasurementExtraction> {
  const repaired = await input.client.runtime.ai.text.generate({
    ...input.aiParams,
    temperature: 0,
    maxTokens: Math.max(input.aiParams.maxTokens ?? 800, 800),
    input: [{ role: 'user', content: buildOCRRepairPrompt(input.raw) }],
    metadata: buildParentosRuntimeMetadata('parentos.profile.checkup-ocr'),
  });

  return parseOCRMeasurementExtraction(repaired.text);
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

function isStructuredOCRParseError(error: Error): boolean {
  return error.message === CHECKUP_OCR_INVALID_JSON_MESSAGE
    || error.message.startsWith('OCR response')
    || error.message.startsWith('OCR measurement')
    || error.message.includes('YYYY-MM-DD');
}

export function normalizeCheckupOCRError(error: unknown): Error {
  if (isImageInputUnsupportedError(error)) {
    return new Error(CHECKUP_OCR_IMAGE_INPUT_UNSUPPORTED_MESSAGE);
  }
  if (error instanceof Error) {
    if (isStructuredOCRParseError(error)) {
      return new Error(CHECKUP_OCR_INVALID_JSON_MESSAGE);
    }
    return error;
  }
  return new Error(CHECKUP_OCR_FAILED_MESSAGE);
}

export function getCheckupOCRDisplayMessage(error: unknown): string {
  return normalizeCheckupOCRError(error).message;
}

export async function hasCheckupOCRRuntime() {
  try {
    const client = getPlatformClient();
    return Boolean(client.runtime?.appId && client.runtime?.ai?.text?.generate);
  } catch {
    return false;
  }
}

export async function analyzeCheckupSheetOCR(input: {
  imageUrl: string;
}): Promise<OCRMeasurementExtraction> {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) {
    throw new Error('checkup OCR requires an imageUrl');
  }

  const client = getPlatformClient();
  if (!client.runtime?.ai?.text?.generate) {
    throw new Error('ParentOS checkup OCR runtime is unavailable');
  }

  try {
    const aiParams = await resolveParentosImageTextRuntimeConfig('parentos.profile.checkup-ocr', { temperature: 0, maxTokens: 800 });
    await ensureParentosLocalRuntimeReady({
      route: aiParams.route,
      localModelId: aiParams.localModelId,
      timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
    });
    const output = await client.runtime.ai.text.generate({
      ...aiParams,
      input: buildOCRInput(imageUrl),
      metadata: buildParentosRuntimeMetadata('parentos.profile.checkup-ocr'),
    });

    try {
      return parseOCRMeasurementExtraction(output.text);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== CHECKUP_OCR_INVALID_JSON_MESSAGE) {
        throw error;
      }

      return await repairOCRMeasurementExtraction({
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
    throw normalizeCheckupOCRError(error);
  }
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('failed to read checkup image file'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || reader.result.trim().length === 0) {
        reject(new Error('checkup image file did not produce a data URL'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
