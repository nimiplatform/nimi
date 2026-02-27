import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { RuntimeFieldMap, StatusBanner } from '@renderer/app-shell/providers/app-store';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  loadRuntimeConfigStateV11,
  RUNTIME_CONFIG_STORAGE_KEY_V11,
} from '@renderer/features/runtime-config/state/v11/storage';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';
import { TauriCredentialVault, createCredential } from '@runtime/llm-adapter/credential-vault.js';
import {
  markRuntimeConfigV11ResetLogged,
  wasRuntimeConfigV11ResetLogged,
} from '../runtime-config-meta-v11';

type HydrationEffectInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  runtimeFields: RuntimeFieldMap;
  setStatusBanner: (banner: StatusBanner | null) => void;
};

async function migrateConnectorTokensToVault(
  loaded: RuntimeConfigStateV11,
  setStatusBanner: (banner: StatusBanner | null) => void,
): Promise<void> {
  const vault = new TauriCredentialVault();
  for (const connector of loaded.connectors) {
    const legacyToken = String((connector as Record<string, unknown>).tokenApiKey || '').trim();
    if (!legacyToken) continue;
    try {
      await createCredential(vault, {
        provider: 'OPENAI_COMPATIBLE',
        refId: connector.id,
        label: `connector:${connector.id}`,
        secret: legacyToken,
      });
    } catch {
      setStatusBanner({
        kind: 'warning',
        message: `凭证迁移失败（${connector.label}），请手动重新输入 API Key。`,
      });
      continue;
    }
    delete (connector as Record<string, unknown>).tokenApiKey;
  }
}

export function useRuntimeConfigHydrationEffect(input: HydrationEffectInput) {
  useEffect(() => {
    if (!input.bootstrapReady || input.hydrated) return;

    let hadV11 = false;
    try {
      hadV11 = Boolean(localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY_V11));
    } catch {
      hadV11 = false;
    }

    const loaded = loadRuntimeConfigStateV11({
      provider: input.runtimeFields.provider,
      runtimeModelType: input.runtimeFields.runtimeModelType,
      localProviderEndpoint: input.runtimeFields.localProviderEndpoint,
      localProviderModel: input.runtimeFields.localProviderModel,
      localOpenAiEndpoint: input.runtimeFields.localOpenAiEndpoint,
      credentialRefId: input.runtimeFields.credentialRefId,
    });

    void migrateConnectorTokensToVault(loaded, input.setStatusBanner).then(() => {
      input.setState(loaded);
      input.setHydrated(true);

      const shouldEmitResetLog = !wasRuntimeConfigV11ResetLogged();
      if (shouldEmitResetLog) {
        const flowId = createRendererFlowId('runtime-config');
        logRendererEvent({
          area: 'renderer-bootstrap',
          message: 'runtime-config:v11-storage-initialized',
          flowId,
          details: {
            storageKey: RUNTIME_CONFIG_STORAGE_KEY_V11,
            hadV11,
          },
        });
        markRuntimeConfigV11ResetLogged();
      }

      if (!hadV11 && shouldEmitResetLog) {
        input.setStatusBanner({ kind: 'info', message: '配置结构已升级，请重新确认模型绑定。' });
      }
    });
  }, [
    input.bootstrapReady,
    input.hydrated,
    input.runtimeFields.credentialRefId,
    input.runtimeFields.localOpenAiEndpoint,
    input.runtimeFields.localProviderEndpoint,
    input.runtimeFields.localProviderModel,
    input.runtimeFields.provider,
    input.runtimeFields.runtimeModelType,
    input.setHydrated,
    input.setState,
    input.setStatusBanner,
  ]);
}
