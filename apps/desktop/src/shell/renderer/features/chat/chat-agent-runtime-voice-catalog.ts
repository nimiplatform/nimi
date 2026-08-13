import type { NimiDesktopRuntimeAiExecutionClient } from '@nimiplatform/sdk/runtime';
import { VoiceAssetStatus, VoiceCreationSource } from '@nimiplatform/sdk/runtime/generated';
import type {
  AgentCenterVoiceCatalogOption,
  AgentCenterVoiceCatalogProjection,
} from '@nimiplatform/kit/features/agent-center';

const VOICE_CATALOG_TIMEOUT_MS = 10_000;

class VoiceCatalogContractError extends Error {}

export async function loadAgentRuntimeVoiceCatalog(input: {
  readonly ai: NimiDesktopRuntimeAiExecutionClient;
  readonly appId: string;
  readonly subjectUserId: string;
  readonly timeoutMs?: number;
}): Promise<AgentCenterVoiceCatalogProjection> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), input.timeoutMs ?? VOICE_CATALOG_TIMEOUT_MS);
  try {
    const [presetResult, assetResult] = await Promise.allSettled([
      input.ai.listPresetVoices({
        appId: input.appId,
        subjectUserId: input.subjectUserId,
      }, { signal: controller.signal }).then((response) => ({
        sourceLabel: response.modelResolved,
        options: response.voices.map((voice): AgentCenterVoiceCatalogOption => {
          const voiceId = exactText(voice.voiceId, 'preset voice id');
          return {
            reference: `preset_voice_id:${voiceId}`,
            kind: 'preset_voice_id',
            name: exactText(voice.name, 'preset voice name'),
            supportedLangs: voice.supportedLangs.map((lang) => exactText(lang, 'preset voice language')),
          };
        }),
      })),
      input.ai.listVoiceAssets({
        appId: input.appId,
        subjectUserId: input.subjectUserId,
        modelId: '',
        targetModelId: '',
        status: VoiceAssetStatus.ACTIVE,
        pageSize: 200,
        pageToken: '',
        connectorId: '',
        creationSource: VoiceCreationSource.UNSPECIFIED,
      }, { signal: controller.signal }).then((response) => response.assets.map((asset): AgentCenterVoiceCatalogOption => {
        const voiceAssetId = exactText(asset.voiceAssetId, 'voice asset id');
        if (asset.appId !== input.appId || asset.subjectUserId !== input.subjectUserId) {
          throw new VoiceCatalogContractError('Runtime returned a cross-owner voice asset.');
        }
        return {
          reference: `voice_asset_id:${voiceAssetId}`,
          kind: 'voice_asset_id',
          name: `Voice asset ${voiceAssetId}`,
          supportedLangs: [],
        };
      })),
    ]);
    if (presetResult.status === 'rejected' && presetResult.reason instanceof VoiceCatalogContractError) {
      throw presetResult.reason;
    }
    if (assetResult.status === 'rejected' && assetResult.reason instanceof VoiceCatalogContractError) {
      throw assetResult.reason;
    }
    if (presetResult.status === 'rejected' && assetResult.status === 'rejected') {
      throw presetResult.reason;
    }
    const options = dedupeVoiceOptions([
      ...(presetResult.status === 'fulfilled' ? presetResult.value.options : []),
      ...(assetResult.status === 'fulfilled' ? assetResult.value : []),
    ]);
    return {
      state: 'ready',
      sourceLabel: presetResult.status === 'fulfilled'
        ? presetResult.value.sourceLabel
        : 'Runtime voice assets',
      options,
      message: null,
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function exactText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new VoiceCatalogContractError(`Runtime voice catalog returned an invalid ${field}.`);
  }
  return value;
}

function dedupeVoiceOptions(
  options: readonly AgentCenterVoiceCatalogOption[],
): readonly AgentCenterVoiceCatalogOption[] {
  const byReference = new Map<string, AgentCenterVoiceCatalogOption>();
  for (const option of options) {
    if (byReference.has(option.reference)) {
      throw new VoiceCatalogContractError(`Runtime voice catalog returned duplicate reference ${option.reference}.`);
    }
    byReference.set(option.reference, option);
  }
  return [...byReference.values()];
}
