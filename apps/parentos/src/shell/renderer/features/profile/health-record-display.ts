import type { TFunction } from 'i18next';
import type { HealthMetricDefinition } from '../../knowledge-base/index.js';
import type { HealthMetricSnapshot, HealthRecordValue } from '../../engine/health-record-domain.js';

export const GROUP_LABEL_KEYS: Record<string, string> = {
  growth: 'Profile.groups.growth',
  vision: 'Profile.groups.vision',
  fitness: 'Profile.groups.fitness',
  sleep: 'Profile.groups.sleep',
  outdoor: 'Profile.groups.outdoor',
  vaccine: 'Profile.groups.vaccine',
  dental: 'Profile.groups.dental',
  medical: 'Profile.groups.medical',
  development: 'Profile.groups.development',
};

export const METRIC_LABEL_KEYS: Record<string, string> = {
  'growth.height': 'Profile.metrics.growth.height',
  'growth.weight': 'Profile.metrics.growth.weight',
  'growth.head_circumference': 'Profile.metrics.growth.headCircumference',
  'growth.bmi': 'Profile.metrics.growth.bmi',
  'vision.left_visual_acuity': 'Profile.metrics.vision.leftVisualAcuity',
  'vision.right_visual_acuity': 'Profile.metrics.vision.rightVisualAcuity',
  'vision.left_axial_length': 'Profile.metrics.vision.leftAxialLength',
  'vision.right_axial_length': 'Profile.metrics.vision.rightAxialLength',
  'vision.left_iop': 'Profile.metrics.vision.leftIop',
  'vision.right_iop': 'Profile.metrics.vision.rightIop',
  'fitness.run_50m': 'Profile.metrics.fitness.run50m',
  'fitness.vital_capacity': 'Profile.metrics.fitness.vitalCapacity',
  'fitness.run_800m': 'Profile.metrics.fitness.run800m',
  'fitness.run_1000m': 'Profile.metrics.fitness.run1000m',
  'fitness.run_50x8': 'Profile.metrics.fitness.run50x8',
  'fitness.sit_and_reach': 'Profile.metrics.fitness.sitAndReach',
  'fitness.standing_long_jump': 'Profile.metrics.fitness.standingLongJump',
  'fitness.sit_ups': 'Profile.metrics.fitness.sitUps',
  'fitness.pull_ups': 'Profile.metrics.fitness.pullUps',
  'fitness.rope_skipping': 'Profile.metrics.fitness.ropeSkipping',
  'fitness.run_10m_shuttle': 'Profile.metrics.fitness.run10mShuttle',
  'fitness.tennis_ball_throw': 'Profile.metrics.fitness.tennisBallThrow',
  'fitness.double_foot_jump': 'Profile.metrics.fitness.doubleFootJump',
  'fitness.balance_beam': 'Profile.metrics.fitness.balanceBeam',
  'fitness.foot_arch_status': 'Profile.metrics.fitness.footArchStatus',
  'development.tanner_breast_stage': 'Profile.metrics.development.tannerBreastStage',
  'development.tanner_genital_stage': 'Profile.metrics.development.tannerGenitalStage',
  'development.tanner_pubic_hair_stage': 'Profile.metrics.development.tannerPubicHairStage',
  'development.bone_age_years': 'Profile.metrics.development.boneAgeYears',
  'development.body_fat_percentage': 'Profile.metrics.development.bodyFatPercentage',
  'sleep.duration_minutes': 'Profile.metrics.sleep.durationMinutes',
  'outdoor.weekly_goal_minutes': 'Profile.metrics.outdoor.weeklyGoalMinutes',
  'outdoor.activity_minutes': 'Profile.metrics.outdoor.activityMinutes',
  'vaccine.administration': 'Profile.metrics.vaccine.administration',
  'dental.event': 'Profile.metrics.dental.event',
  'medical.event': 'Profile.metrics.medical.event',
  'development.milestone': 'Profile.metrics.development.milestone',
};

export const PROTOCOL_LABEL_KEYS: Record<string, string> = {
  'growth-infant-monthly': 'Profile.protocols.growthInfantMonthly',
  'growth-child-quarterly': 'Profile.protocols.growthChildQuarterly',
  'growth-school-biannual': 'Profile.protocols.growthSchoolBiannual',
  'vision-basic': 'Profile.protocols.visionBasic',
  'vision-full-exam': 'Profile.protocols.visionFullExam',
  'fitness-school-assessment': 'Profile.protocols.fitnessSchoolAssessment',
  'tanner-female-self-assessment': 'Profile.protocols.tannerFemaleSelfAssessment',
  'tanner-male-self-assessment': 'Profile.protocols.tannerMaleSelfAssessment',
  'development-auxiliary-measurement': 'Profile.protocols.developmentAuxiliaryMeasurement',
  'outdoor-goal': 'Profile.protocols.outdoorGoal',
  'outdoor-activity': 'Profile.protocols.outdoorActivity',
  'sleep-night': 'Profile.protocols.sleepNight',
  'vaccine-administration': 'Profile.protocols.vaccineAdministration',
  'dental-event': 'Profile.protocols.dentalEvent',
  'medical-event': 'Profile.protocols.medicalEvent',
  'milestone-achievement': 'Profile.protocols.milestoneAchievement',
};

export const STATUS_LABEL_KEYS: Record<string, string> = {
  on_track: 'Profile.status.onTrack',
  watch: 'Profile.status.watch',
  professional_review_prompt: 'Profile.status.professionalReviewPrompt',
  unrated: 'Profile.status.unrated',
  missing: 'Profile.status.missing',
  error: 'Profile.status.error',
};

export const FRESHNESS_LABEL_KEYS: Record<HealthMetricSnapshot['freshness'], string> = {
  missing: 'Profile.freshness.missing',
  fresh: 'Profile.freshness.fresh',
  stale: 'Profile.freshness.stale',
  unscheduled: 'Profile.freshness.unscheduled',
};

export function formatAgeText(ageMonths: number, t: TFunction) {
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  if (years === 0) return t('Profile.age.months', { count: months, defaultValue: '{{count}} months' });
  return months > 0
    ? t('Profile.age.yearsMonths', { years, months, defaultValue: '{{years}} years {{months}} months' })
    : t('Profile.age.years', { count: years, defaultValue: '{{count}} years' });
}

export function formatDate(value: string | null | undefined, t: TFunction) {
  if (!value) return t('Profile.empty.noDate', { defaultValue: 'None' });
  return value.slice(0, 10);
}

export function metricLabel(metric: HealthMetricDefinition, t: TFunction) {
  return t(METRIC_LABEL_KEYS[metric.metricId] ?? metric.displayName, { defaultValue: metric.displayName });
}

export function groupLabel(groupId: string, fallback: string, t: TFunction) {
  return t(GROUP_LABEL_KEYS[groupId] ?? fallback, { defaultValue: fallback });
}

export function protocolLabel(protocolId: string, fallback: string, t: TFunction) {
  return t(PROTOCOL_LABEL_KEYS[protocolId] ?? fallback, { defaultValue: fallback });
}

export function formatHealthValue(
  value: HealthRecordValue | null | undefined,
  metric: HealthMetricDefinition,
  t: TFunction,
) {
  if (!value) return t('Profile.empty.noData', { defaultValue: 'No data' });
  if (typeof value.valueNumber === 'number') {
    const precision = metric.precision ?? 0;
    const numberText = Number.isInteger(value.valueNumber)
      ? String(value.valueNumber)
      : value.valueNumber.toFixed(precision);
    return `${numberText}${metric.unit ? ` ${metric.unit}` : ''}`;
  }
  if (value.valueText) return value.valueText;
  if (value.valueJson) return t('Profile.empty.recorded', { defaultValue: 'Recorded' });
  return t('Profile.empty.recorded', { defaultValue: 'Recorded' });
}

export function formatMetricSnapshotValue(snapshot: HealthMetricSnapshot, t: TFunction) {
  return formatHealthValue(snapshot.latestValue, snapshot.metric, t);
}

export function formatHealthValueParts(
  value: HealthRecordValue | null | undefined,
  metric: HealthMetricDefinition,
  t: TFunction,
): { valueText: string; unitText: string } {
  if (!value) return { valueText: t('Profile.empty.noData', { defaultValue: 'No data' }), unitText: '' };
  if (typeof value.valueNumber === 'number') {
    const precision = metric.precision ?? 0;
    const numberText = Number.isInteger(value.valueNumber)
      ? String(value.valueNumber)
      : value.valueNumber.toFixed(precision);
    return { valueText: numberText, unitText: metric.unit ?? '' };
  }
  if (value.valueText) return { valueText: value.valueText, unitText: '' };
  if (value.valueJson) return { valueText: t('Profile.empty.recorded', { defaultValue: 'Recorded' }), unitText: '' };
  return { valueText: t('Profile.empty.recorded', { defaultValue: 'Recorded' }), unitText: '' };
}

export function formatMetricSnapshotValueParts(snapshot: HealthMetricSnapshot, t: TFunction) {
  return formatHealthValueParts(snapshot.latestValue, snapshot.metric, t);
}
