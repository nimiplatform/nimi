import chinaBmiFemale from './generated/lms-slices/china-bmi-female.json';
import chinaBmiMale from './generated/lms-slices/china-bmi-male.json';
import chinaHcFemale from './generated/lms-slices/china-hc-female.json';
import chinaHcMale from './generated/lms-slices/china-hc-male.json';
import chinaHeightFemale from './generated/lms-slices/china-height-female.json';
import chinaHeightMale from './generated/lms-slices/china-height-male.json';
import chinaWeightFemale from './generated/lms-slices/china-weight-female.json';
import chinaWeightMale from './generated/lms-slices/china-weight-male.json';
import whoBmiFemale from './generated/lms-slices/who-bmi-female.json';
import whoBmiMale from './generated/lms-slices/who-bmi-male.json';
import whoHeadCircumferenceFemale from './generated/lms-slices/who-head-circumference-female.json';
import whoHeadCircumferenceMale from './generated/lms-slices/who-head-circumference-male.json';
import whoHeightFemale from './generated/lms-slices/who-height-female.json';
import whoHeightMale from './generated/lms-slices/who-height-male.json';
import whoWeightFemale from './generated/lms-slices/who-weight-female.json';
import whoWeightMale from './generated/lms-slices/who-weight-male.json';

export type GrowthLmsTypeId = 'height' | 'weight' | 'head-circumference' | 'bmi';
export type GrowthLmsSex = 'male' | 'female';
export type GrowthLmsStandard = 'china' | 'who';

type ChinaDatasetKey = `height:${GrowthLmsSex}` | `weight:${GrowthLmsSex}` | `bmi:${GrowthLmsSex}` | `hc:${GrowthLmsSex}`;
type WhoDatasetKey = `${GrowthLmsTypeId}:${GrowthLmsSex}`;
type DatasetKey = ChinaDatasetKey | WhoDatasetKey;

export interface GrowthLmsDatasetAsset {
  typeId: GrowthLmsTypeId;
  gender: GrowthLmsSex;
  source: string;
  urls?: string[];
  coverage: {
    startAgeMonths: number;
    endAgeMonths: number;
  };
  points: number[][];
}

interface GrowthLmsDataSlice {
  generatedAt: string;
  percentiles: number[];
  standard: GrowthLmsStandard;
  datasetKey: DatasetKey;
  dataset: GrowthLmsDatasetAsset;
}

export const GROWTH_LMS_PERCENTILES = [3, 10, 25, 50, 75, 90, 97] as const;

const DATASETS: Record<GrowthLmsStandard, Partial<Record<DatasetKey, GrowthLmsDataSlice>>> = {
  china: {
    'height:male': chinaHeightMale as GrowthLmsDataSlice,
    'height:female': chinaHeightFemale as GrowthLmsDataSlice,
    'weight:male': chinaWeightMale as GrowthLmsDataSlice,
    'weight:female': chinaWeightFemale as GrowthLmsDataSlice,
    'bmi:male': chinaBmiMale as GrowthLmsDataSlice,
    'bmi:female': chinaBmiFemale as GrowthLmsDataSlice,
    'hc:male': chinaHcMale as GrowthLmsDataSlice,
    'hc:female': chinaHcFemale as GrowthLmsDataSlice,
  },
  who: {
    'height:male': whoHeightMale as GrowthLmsDataSlice,
    'height:female': whoHeightFemale as GrowthLmsDataSlice,
    'weight:male': whoWeightMale as GrowthLmsDataSlice,
    'weight:female': whoWeightFemale as GrowthLmsDataSlice,
    'head-circumference:male': whoHeadCircumferenceMale as GrowthLmsDataSlice,
    'head-circumference:female': whoHeadCircumferenceFemale as GrowthLmsDataSlice,
    'bmi:male': whoBmiMale as GrowthLmsDataSlice,
    'bmi:female': whoBmiFemale as GrowthLmsDataSlice,
  },
};

function datasetKey(
  typeId: GrowthLmsTypeId,
  sex: GrowthLmsSex,
  standard: GrowthLmsStandard,
): DatasetKey {
  if (standard === 'china' && typeId === 'head-circumference') {
    return `hc:${sex}`;
  }
  return `${typeId}:${sex}`;
}

export function getGrowthLmsDataset(
  typeId: GrowthLmsTypeId,
  sex: GrowthLmsSex,
  standard: GrowthLmsStandard,
): GrowthLmsDatasetAsset | null {
  return DATASETS[standard][datasetKey(typeId, sex, standard)]?.dataset ?? null;
}
