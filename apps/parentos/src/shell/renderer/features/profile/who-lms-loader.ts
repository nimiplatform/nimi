import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import whoLmsData from './who-lms-data.json';

export interface WHOPercentilePoint {
  ageMonths: number;
  value: number;
}

export interface WHOPercentileLine {
  percentile: number;
  points: WHOPercentilePoint[];
}

export const WHO_PERCENTILES = [3, 10, 25, 50, 75, 90, 97] as const;

type WHOGender = 'male' | 'female';
type WHOLMSTypeId = Extract<GrowthTypeId, 'height' | 'weight' | 'head-circumference' | 'bmi'>;
type DatasetKey = `${WHOLMSTypeId}:${WHOGender}`;

interface WHOLMSDatasetAsset {
  typeId: WHOLMSTypeId;
  gender: WHOGender;
  source: string;
  urls: string[];
  coverage: {
    startAgeMonths: number;
    endAgeMonths: number;
  };
  points: number[][];
}

interface WHOLMSDataFile {
  generatedAt: string;
  percentiles: number[];
  datasets: Record<string, WHOLMSDatasetAsset>;
}

export interface WHOLMSDataset extends WHOLMSDatasetAsset {
  lines: WHOPercentileLine[];
}

export const PERCENTILE_COLORS: Record<number, string> = {
  3: '#d1d5db',
  10: '#d1d5db',
  25: '#9ca3af',
  50: '#6b7280',
  75: '#9ca3af',
  90: '#d1d5db',
  97: '#d1d5db',
};

const WHO_LMS_DATA = whoLmsData as unknown as WHOLMSDataFile;
const SUPPORTED_TYPES = new Set<WHOLMSTypeId>(['height', 'weight', 'head-circumference', 'bmi']);
const LINE_INDEX_BY_PERCENTILE = new Map<number, number>([
  [3, 1],
  [10, 2],
  [25, 3],
  [50, 4],
  [75, 5],
  [90, 6],
  [97, 7],
]);

function isWHOLMSType(typeId: GrowthTypeId): typeId is WHOLMSTypeId {
  return SUPPORTED_TYPES.has(typeId as WHOLMSTypeId);
}

function toLines(points: number[][]): WHOPercentileLine[] {
  return WHO_PERCENTILES.map((percentile) => {
    const pointIndex = LINE_INDEX_BY_PERCENTILE.get(percentile) ?? 4;
    return {
      percentile,
      points: points
        .filter((point) => point.length >= 8)
        .map((point) => ({
          ageMonths: point[0]!,
          value: point[pointIndex] ?? point[4] ?? 0,
        })),
    };
  });
}

export function canRenderWHOLMS(dataset: WHOLMSDataset | null, ageMonths: number) {
  if (!dataset) {
    return false;
  }

  return ageMonths >= dataset.coverage.startAgeMonths && ageMonths <= dataset.coverage.endAgeMonths;
}

export async function loadWHOLMS(
  typeId: GrowthTypeId,
  gender: WHOGender,
): Promise<WHOLMSDataset> {
  if (!isWHOLMSType(typeId)) {
    throw new Error(`WHO LMS dataset is not defined for growth type "${typeId}"`);
  }

  const datasetKey = `${typeId}:${gender}` as DatasetKey;
  const dataset = WHO_LMS_DATA.datasets[datasetKey];
  if (!dataset) {
    throw new Error(`WHO LMS dataset is missing for "${datasetKey}"`);
  }

  return {
    ...dataset,
    lines: toLines(dataset.points),
  };
}
