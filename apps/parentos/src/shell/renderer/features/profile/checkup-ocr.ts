import { getPlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime/types-media.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';

export type OCRImportTypeId = Extract<GrowthTypeId,
  | 'height' | 'weight' | 'head-circumference' | 'bmi'
  | 'vision-left' | 'vision-right'
  | 'corrected-vision-left' | 'corrected-vision-right'
  | 'refraction-sph-left' | 'refraction-sph-right'
  | 'refraction-cyl-left' | 'refraction-cyl-right'
  | 'axial-length-left' | 'axial-length-right'
  | 'lab-vitamin-d' | 'lab-ferritin' | 'lab-hemoglobin' | 'lab-calcium' | 'lab-zinc'
>;

export interface OCRMeasurementCandidate {
  typeId: OCRImportTypeId;
  value: number;
  measuredAt: string;
  notes: string | null;
}

export interface OCRMeasurementExtraction {
  measurements: OCRMeasurementCandidate[];
}

const SUPPORTED_IMPORT_TYPES = new Set<OCRImportTypeId>([
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
  'axial-length-left',
  'axial-length-right',
  'lab-vitamin-d',
  'lab-ferritin',
  'lab-hemoglobin',
  'lab-calcium',
  'lab-zinc',
]);

function isOCRImportTypeId(value: string): value is OCRImportTypeId {
  return SUPPORTED_IMPORT_TYPES.has(value as OCRImportTypeId);
}

function assertISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`OCR measurement date must use YYYY-MM-DD, got "${value}"`);
  }
  return value;
}

function parseOCRMeasurementExtraction(raw: string): OCRMeasurementExtraction {
  const payload = JSON.parse(raw) as { measurements?: unknown };
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

function buildOCRPrompt(): string {
  return [
    'You are extracting structured pediatric growth measurements from a health-sheet image.',
    'Return JSON only with no markdown, no prose, and no code fences.',
    'Use this exact schema:',
    '{"measurements":[{"typeId":"height|weight|head-circumference|bmi|vision-left|vision-right|corrected-vision-left|corrected-vision-right|refraction-sph-left|refraction-sph-right|refraction-cyl-left|refraction-cyl-right|axial-length-left|axial-length-right|lab-vitamin-d|lab-ferritin|lab-hemoglobin|lab-calcium|lab-zinc","value":123.4,"measuredAt":"YYYY-MM-DD","notes":"optional short extraction note or null"}]}',
    'Rules:',
    '- Extract only values explicitly visible in the image.',
    '- Do not infer missing measurements.',
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

  const aiParams = await resolveParentosTextRuntimeConfig('parentos.profile.checkup-ocr', { temperature: 0, maxTokens: 800 });
  await ensureParentosLocalRuntimeReady({
    route: aiParams.route,
    localModelId: aiParams.localModelId,
    timeoutMs: 60_000,
  });
  const output = await client.runtime.ai.text.generate({
    ...aiParams,
    input: buildOCRInput(imageUrl),
    metadata: buildParentosRuntimeMetadata('parentos.profile.checkup-ocr'),
  });

  return parseOCRMeasurementExtraction(output.text);
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
