import type { OrthoClinicalEventType, OrthodonticApplianceType, OrthodonticStage, WritableOrthodonticCaseType } from '../../bridge/sqlite-bridge.js';

export const CASE_TYPE_OPTIONS: { value: WritableOrthodonticCaseType; label: string }[] = [
  { value: 'early-intervention', label: '早期矫治' },
  { value: 'fixed-braces', label: '固定矫治' },
  { value: 'clear-aligners', label: '隐形矫治' },
];

export const STAGE_OPTIONS: { value: OrthodonticStage; label: string }[] = [
  { value: 'assessment', label: '初评' },
  { value: 'planning', label: '方案规划' },
  { value: 'active', label: '治疗中' },
  { value: 'retention', label: '保持期' },
  { value: 'completed', label: '已完成' },
];

export const CASE_CREATE_STAGE_OPTIONS = STAGE_OPTIONS.filter((option) => option.value !== 'completed');

export const ORTHO_CLINICAL_EVENT_OPTIONS: { value: OrthoClinicalEventType; label: string; desc: string }[] = [
  { value: 'ortho-review',     label: '复诊',  desc: '医生例行检查进度' },
  { value: 'ortho-adjustment', label: '调整',  desc: '弓丝/结扎/附件调整' },
  { value: 'ortho-issue',      label: '异常',  desc: '断裂、脱落、疼痛等' },
  { value: 'ortho-end',        label: '结束',  desc: '正畸结束或保持期开始' },
];

export function eventTypeAdvancesReview(t: OrthoClinicalEventType): boolean {
  return t === 'ortho-review' || t === 'ortho-adjustment';
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function applianceRequiresPrescribedHours(applianceType: OrthodonticApplianceType): boolean {
  return applianceType === 'clear-aligner'
    || applianceType === 'twin-block'
    || applianceType === 'activator'
    || applianceType === 'retainer-removable';
}

