export function agentConfigurationErrorMessage(reasonCode: string | undefined): string | null {
  switch (reasonCode?.trim().toUpperCase().replaceAll('-', '_')) {
    case 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED':
      return '这项任务还没有就绪的模型，请先到 Nimi 的「AI 能力」完成设置。';
    case 'AI_TEXT_BEHAVIOR_UNSUPPORTED':
      return '当前模型不支持这次任务需要的行为，请在 Nimi 的「AI 能力」选择支持该任务的配置。';
    default:
      return null;
  }
}
