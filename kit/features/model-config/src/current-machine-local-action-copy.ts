import type { ModelConfigCurrentMachineLocalActionCopy } from './types.js';

const ENGLISH_CURRENT_MACHINE_LOCAL_ACTION_COPY: ModelConfigCurrentMachineLocalActionCopy = Object.freeze({
  title: 'On-device quick setup',
  label: 'Use this device\'s models',
  hint: 'Applies the models already selected on this device to this app. Only capabilities with an on-device selection change.',
  loadingLabel: 'Checking on-device models…',
  retryLabel: 'Retry',
  noSelectionLabel: 'No on-device model is selected for these capabilities.',
  savingLabel: 'Saving model settings…',
  committedLabel: 'Selected on-device models are now in use.',
  conflictLabel: 'Configuration changed elsewhere. Your draft was kept.',
  conflictCurrentLabel: 'Current revision {{revision}}: {{summary}}',
  currentConfigEmptyLabel: 'not configured',
  currentConfigLocalLabel: 'on-device',
  currentConfigCloudLabel: 'cloud',
  currentConfigUnsetLabel: 'not configured',
  failedLabel: 'Selected on-device models could not be applied.',
  unavailableLabel: 'The selected on-device models are unavailable for this configuration.',
  technicalDetailsLabel: 'Technical details',
});

const CHINESE_CURRENT_MACHINE_LOCAL_ACTION_COPY: ModelConfigCurrentMachineLocalActionCopy = Object.freeze({
  title: '本机模型快速配置',
  label: '使用本机已选模型',
  hint: '把本机已选好的模型一键应用到此 App，仅影响已在本机选择模型的能力。',
  loadingLabel: '正在检查本机模型…',
  retryLabel: '重试',
  noSelectionLabel: '本机尚未为这些能力选择模型。',
  savingLabel: '正在保存模型设置…',
  committedLabel: '已改为使用本机已选模型。',
  conflictLabel: '配置已在其他位置变更，当前草稿已保留。',
  conflictCurrentLabel: '当前版本 {{revision}}：{{summary}}',
  currentConfigEmptyLabel: '未配置',
  currentConfigLocalLabel: '本机',
  currentConfigCloudLabel: '云端',
  currentConfigUnsetLabel: '未配置',
  failedLabel: '无法应用本机已选模型。',
  unavailableLabel: '当前配置无法使用本机模型。',
  technicalDetailsLabel: '技术详情',
});

export const MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY = Object.freeze({
  en: ENGLISH_CURRENT_MACHINE_LOCAL_ACTION_COPY,
  zh: CHINESE_CURRENT_MACHINE_LOCAL_ACTION_COPY,
});

export function resolveModelConfigCurrentMachineLocalActionCopy(
  language: string | null | undefined,
): ModelConfigCurrentMachineLocalActionCopy {
  return language?.trim().toLowerCase().startsWith('zh')
    ? CHINESE_CURRENT_MACHINE_LOCAL_ACTION_COPY
    : ENGLISH_CURRENT_MACHINE_LOCAL_ACTION_COPY;
}
