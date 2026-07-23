import { createEmptyNimiAIConfig, createNimiBuiltInChatAIScopeRef } from '@nimiplatform/sdk/ai';

import type { DesktopRendererAIConfigPort } from '../shell/renderer/renderer/ai-config-port.js';
import type { DesktopSimulatorJsonValue } from './protocol.js';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

export function createDesktopSimulatorAIConfigPort(
  getProjection: () => DesktopSimulatorJsonValue,
): DesktopRendererAIConfigPort {
  const scopeRef = createNimiBuiltInChatAIScopeRef('nimi');
  const config = createEmptyNimiAIConfig(scopeRef);
  const assertUnavailable = (): void => {
    const projection = getProjection() as JsonRecord;
    const aiConfig = projection.aiConfig as JsonRecord | undefined;
    if (aiConfig?.runtimeStatus !== 'unavailable') {
      throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_PROJECTION_INVALID');
    }
  };
  const unavailableProbe = async () => {
    assertUnavailable();
    return Object.freeze({ status: 'unavailable' as const, capabilityStatuses: Object.freeze({}) });
  };
  const unavailable = (): never => { throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_UNADMITTED'); };
  return Object.freeze({
    aiProfile: Object.freeze({
      list: async () => unavailable(),
      get: async () => unavailable(),
      validate: () => unavailable(),
      previewApply: async () => unavailable(),
      apply: async () => unavailable(),
    }),
    aiConfig: Object.freeze({
      get: () => config,
      update: () => unavailable(),
      listScopes: () => Object.freeze([scopeRef]),
      probe: unavailableProbe,
      probeFeasibility: unavailableProbe,
      probeSchedulingTarget: async () => {
        assertUnavailable();
        return null;
      },
      subscribe: () => () => undefined,
    }),
    aiSnapshot: Object.freeze({
      record: () => unavailable(),
      get: () => null,
      getLatest: () => null,
    }),
  });
}
