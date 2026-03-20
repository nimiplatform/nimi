export type RelayTtsInspectSettings = {
  voiceName?: string;
  ttsConnectorId?: string;
  ttsModel?: string;
};

export type RelayTtsSynthesizeRequestInput = {
  model?: string;
  voiceId?: string;
};

export type ResolvedRelayTtsConfig = {
  connectorId: string;
  model: string;
  voiceId: string;
  requestedModel: string;
  requestedVoice: string;
  settingsModel: string;
  settingsVoice: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveRelayTtsConfig(
  inspect: RelayTtsInspectSettings,
  input: RelayTtsSynthesizeRequestInput,
): ResolvedRelayTtsConfig {
  const requestedModel = normalizeText(input.model);
  const requestedVoice = normalizeText(input.voiceId);
  const settingsModel = normalizeText(inspect.ttsModel);
  const settingsVoice = normalizeText(inspect.voiceName);

  return {
    connectorId: normalizeText(inspect.ttsConnectorId),
    model: requestedModel || settingsModel,
    voiceId: requestedVoice || settingsVoice,
    requestedModel,
    requestedVoice,
    settingsModel,
    settingsVoice,
  };
}
