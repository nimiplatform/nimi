import {
  ReasonCode,
  VoiceAssetStatus,
  VoiceWorkflowType,
  asNimiError,
  createNimiError,
  type ListVoiceAssetsRequest,
  type ListVoiceAssetsResponse,
  type NimiError,
  type RuntimeTypedCallOptions,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  describeRuntimeGenerationError,
  runtimeUnavailableReasonFromError,
} from './runtime-diagnostics.js';

export type RuntimeVoiceCatalogUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeVoiceCatalogReference = {
  readonly kind: 'voice_asset_id';
  readonly voiceAssetId: string;
  readonly workflowType: VoiceWorkflowType;
  readonly status: VoiceAssetStatus;
};

export type RuntimeVoiceCatalogOutput = {
  readonly kind: 'voice-reference-catalog';
  readonly voiceCount: number;
  readonly voiceReferences: readonly RuntimeVoiceCatalogReference[];
  readonly nextPageToken?: string;
};

export type RuntimeVoiceCatalogSuccess = {
  readonly ok: true;
  readonly capabilityId: 'speech.bundle';
  readonly message: string;
  readonly output: RuntimeVoiceCatalogOutput;
};

export type RuntimeVoiceCatalogUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'speech.bundle';
  readonly reason: RuntimeVoiceCatalogUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeVoiceCatalogResult = RuntimeVoiceCatalogSuccess | RuntimeVoiceCatalogUnavailable;

export type RuntimeVoiceCatalogRuntime = {
  readonly ai: {
    readonly listVoiceAssets?: (
      request: ListVoiceAssetsRequest,
      options?: RuntimeTypedCallOptions,
    ) => Promise<ListVoiceAssetsResponse>;
  };
};

export type RuntimeVoiceCatalogInput = {
  readonly runtime: RuntimeVoiceCatalogRuntime;
  readonly appId: string;
  readonly subjectUserId: string;
  readonly workflowType?: VoiceWorkflowType;
  readonly status?: VoiceAssetStatus;
  readonly pageSize?: number;
  readonly pageToken?: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
};

/**
 * Lists owner-scoped voice asset references only. Legacy execution filters are
 * omitted so Runtime receives identity and catalog criteria only.
 */
export async function runRuntimeVoiceCatalog(
  input: RuntimeVoiceCatalogInput,
): Promise<RuntimeVoiceCatalogResult> {
  const appId = exactText(input.appId);
  const subjectUserId = exactText(input.subjectUserId);
  if (!appId || !subjectUserId) {
    return unavailable('principal-unauthorized', createNimiError({
      message: 'Voice reference catalog requires exact App and subject owner identity.',
      code: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'provide_voice_catalog_owner_identity',
      source: 'sdk',
    }));
  }

  const pageSize = input.pageSize ?? 100;
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > 200) {
    return unavailable('input-invalid', createNimiError({
      message: 'Voice reference catalog pageSize must be an integer from 1 through 200.',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'provide_voice_catalog_page_size',
      source: 'sdk',
    }));
  }

  const listVoiceAssets = input.runtime.ai.listVoiceAssets;
  if (typeof listVoiceAssets !== 'function') {
    return unavailable('sdk-method-unavailable', createNimiError({
      message: 'Runtime listVoiceAssets SDK surface is unavailable.',
      code: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      actionHint: 'upgrade_runtime_sdk',
      source: 'sdk',
    }));
  }

  try {
    const response = await listVoiceAssets.call(input.runtime.ai, {
      appId,
      subjectUserId,
      workflowType: input.workflowType ?? VoiceWorkflowType.UNSPECIFIED,
      status: input.status ?? VoiceAssetStatus.UNSPECIFIED,
      pageSize,
      pageToken: input.pageToken ?? '',
    } as ListVoiceAssetsRequest, {
      ...(input.callOptions ?? {}),
      signal: input.signal ?? input.callOptions?.signal,
    });

    const voiceReferences = response.assets.map((asset): RuntimeVoiceCatalogReference => {
      const voiceAssetId = exactText(asset.voiceAssetId);
      if (!voiceAssetId || asset.appId !== appId || asset.subjectUserId !== subjectUserId) {
        throw createNimiError({
          message: 'Runtime voice catalog returned a malformed or cross-owner voice asset.',
          code: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_voice_asset_projection',
          source: 'sdk',
        });
      }
      return {
        kind: 'voice_asset_id',
        voiceAssetId,
        workflowType: asset.workflowType,
        status: asset.status,
      };
    });

    return {
      ok: true,
      capabilityId: 'speech.bundle',
      message: `Runtime returned ${voiceReferences.length} owner-scoped voice reference(s).`,
      output: {
        kind: 'voice-reference-catalog',
        voiceCount: voiceReferences.length,
        voiceReferences,
        ...(response.nextPageToken ? { nextPageToken: response.nextPageToken } : {}),
      },
    };
  } catch (error) {
    const nimiError = asNimiError(error, {
      message: 'Runtime voice reference catalog lookup failed.',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_catalog_lookup',
      source: 'runtime',
    });
    return unavailable(runtimeUnavailableReasonFromError(nimiError), nimiError);
  }
}

function unavailable(
  reason: RuntimeVoiceCatalogUnavailableReason,
  error: NimiError,
): RuntimeVoiceCatalogUnavailable {
  return {
    ok: false,
    capabilityId: 'speech.bundle',
    reason,
    message: describeRuntimeGenerationError(error, 'Runtime voice reference catalog lookup failed.'),
    error,
  };
}

function exactText(value: unknown): string {
  return typeof value === 'string' && value.trim() === value ? value : '';
}
