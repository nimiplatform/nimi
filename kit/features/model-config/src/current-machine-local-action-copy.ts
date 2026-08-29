import type { ModelConfigCurrentMachineLocalActionCopy } from './types.js';

const ENGLISH_CURRENT_MACHINE_LOCAL_ACTION_COPY: ModelConfigCurrentMachineLocalActionCopy = Object.freeze({
  label: 'Use current on-device models',
  hint: 'Use each model currently selected on this machine for the capabilities shown here.',
  loadingLabel: 'Checking on-device models…',
  retryLabel: 'Retry',
  noSelectionLabel: 'No on-device model is selected for these capabilities.',
  savingLabel: 'Saving model settings…',
  committedLabel: 'Current on-device models are now used.',
  conflictLabel: 'Configuration changed elsewhere. Your draft was kept.',
  conflictCurrentLabel: 'Current revision {{revision}}: {{summary}}',
  currentConfigEmptyLabel: 'not configured',
  currentConfigLocalLabel: 'on-device',
  currentConfigCloudLabel: 'cloud',
  currentConfigUnsetLabel: 'not configured',
  failedLabel: 'Current on-device models could not be applied.',
  unavailableLabel: 'Current on-device models are unavailable for this configuration.',
  technicalDetailsLabel: 'Technical details',
});

const CHINESE_CURRENT_MACHINE_LOCAL_ACTION_COPY: ModelConfigCurrentMachineLocalActionCopy = Object.freeze({
  label: '使用本机当前模型',
  hint: '为此处显示的能力使用本机当前已选择的模型。',
  loadingLabel: '正在检查本机模型…',
  retryLabel: '重试',
  noSelectionLabel: '本机尚未为这些能力选择模型。',
  savingLabel: '正在保存模型设置…',
  committedLabel: '已改为使用本机当前模型。',
  conflictLabel: '配置已在其他位置变更，当前草稿已保留。',
  conflictCurrentLabel: '当前版本 {{revision}}：{{summary}}',
  currentConfigEmptyLabel: '未配置',
  currentConfigLocalLabel: '本机',
  currentConfigCloudLabel: '云端',
  currentConfigUnsetLabel: '未配置',
  failedLabel: '无法应用本机当前模型。',
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
