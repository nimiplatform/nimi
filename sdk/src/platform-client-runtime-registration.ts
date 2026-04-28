import { createNimiError } from './runtime/errors.js';
import { AppMode, WorldRelation } from './runtime/generated/runtime/v1/auth.js';
import type { Runtime } from './runtime/runtime.js';
import { ReasonCode } from './types/index.js';

type RuntimeResolver = () => Runtime;

type RuntimeFullAppRegistrationInput = {
  appId: string;
  appInstanceId: string;
  deviceId: string;
  rejectionLabel: string;
};

export function createRuntimeFullAppRegistration(
  resolveRuntime: RuntimeResolver,
  input: RuntimeFullAppRegistrationInput,
): () => Promise<void> {
  let inflight: Promise<void> | null = null;
  return async () => {
    if (inflight) {
      return inflight;
    }
    inflight = (async () => {
      const response = await resolveRuntime().auth.registerApp({
        appId: input.appId,
        appInstanceId: input.appInstanceId,
        deviceId: input.deviceId,
        appVersion: '1',
        capabilities: [],
        modeManifest: {
          appMode: AppMode.FULL,
          runtimeRequired: true,
          realmRequired: true,
          worldRelation: WorldRelation.NONE,
        },
      });
      if (!response.accepted) {
        throw createNimiError({
          message: `${input.rejectionLabel}: ${String(response.reasonCode || 'unknown')}`,
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'register_runtime_app_first',
          source: 'runtime',
        });
      }
    })();
    try {
      await inflight;
    } catch (error) {
      inflight = null;
      throw error;
    }
  };
}
