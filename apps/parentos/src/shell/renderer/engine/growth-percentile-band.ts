import { getGrowthLmsDataset } from '../features/profile/growth-lms-datasets.js';

export type GrowthPercentileTypeId = 'height' | 'weight' | 'head-circumference' | 'bmi';
export type GrowthPercentileSex = 'male' | 'female';
export type GrowthPercentileStandard = 'china' | 'who';

export interface GrowthPercentileBand {
  p3: number;
  p97: number;
  ageMonths: number;
  standard: GrowthPercentileStandard;
}

interface PercentileDataset {
  coverage: { startAgeMonths: number; endAgeMonths: number };
  points: number[][];
}

const P3_INDEX = 1;
const P97_INDEX = 7;

function getDataset(
  typeId: GrowthPercentileTypeId,
  sex: GrowthPercentileSex,
  standard: GrowthPercentileStandard,
): PercentileDataset | null {
  return getGrowthLmsDataset(typeId, sex, standard);
}

function interpolate(low: number[], high: number[], ageMonths: number, index: number): number {
  const lowAge = low[0]!;
  const highAge = high[0]!;
  if (highAge === lowAge) return low[index]!;
  const ratio = (ageMonths - lowAge) / (highAge - lowAge);
  return low[index]! + (high[index]! - low[index]!) * ratio;
}

export function getGrowthPercentileBand(input: {
  typeId: GrowthPercentileTypeId;
  sex: GrowthPercentileSex;
  ageMonths: number;
  standard?: GrowthPercentileStandard;
}): GrowthPercentileBand | null {
  const standard = input.standard ?? 'china';
  const dataset = getDataset(input.typeId, input.sex, standard);
  if (!dataset) return null;
  const { startAgeMonths, endAgeMonths } = dataset.coverage;
  if (input.ageMonths < startAgeMonths || input.ageMonths > endAgeMonths) {
    return null;
  }
  const points = dataset.points;
  if (!points.length) return null;

  let lowIdx = 0;
  let highIdx = points.length - 1;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    if (point[0]! <= input.ageMonths) {
      lowIdx = i;
    }
    if (point[0]! >= input.ageMonths) {
      highIdx = i;
      break;
    }
  }
  const low = points[lowIdx]!;
  const high = points[highIdx]!;

  return {
    p3: interpolate(low, high, input.ageMonths, P3_INDEX),
    p97: interpolate(low, high, input.ageMonths, P97_INDEX),
    ageMonths: input.ageMonths,
    standard,
  };
}
