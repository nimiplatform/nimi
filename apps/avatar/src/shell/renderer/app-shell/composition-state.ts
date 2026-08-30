// App-local prerequisite composition. These branches decide which shell view
// is mounted; they are not a public Avatar presentation state machine.
// The Avatar shell renders exactly one product or development surface at any time:
//   - ready:            live product embodiment-stage
//   - fixture_not_verified: renderable development preview, never product-ready
//   - loading:          pre-bootstrap-complete; degraded-surface variant=loading
//   - degraded:*:       typed runtime / account / launch failures
//   - error:*:          untyped bootstrap failures

import { ReasonCode } from '@nimiplatform/sdk/types';
import type { AvatarAppState } from './app-store.js';

export type CompositionState =
  | 'ready'
  | 'fixture_not_verified'
  | 'loading'
  | 'degraded_reauth_required'
  | 'degraded_cloud_offline'
  | 'degraded_runtime_unavailable'
  | 'degraded_launch_context_invalid'
  | 'error_bootstrap_fatal';

export type CompositionVariant = 'live' | 'fixture' | 'loading' | 'degraded' | 'error';

export type CompositionDerivation = {
  state: CompositionState;
  variant: CompositionVariant;
  reason: string | null;
  reasonCode: string | null;
  accountReasonCode: string | null;
  actionHint: string | null;
  stage: string | null;
  source: string | null;
  retryable: boolean | null;
  modelDiagnostics: CompositionModelDiagnostics | null;
  // Product readiness. Fixture execution must never set this true.
  ready: boolean;
  // True when a validated backend surface may mount. This includes the
  // explicitly labeled fixture development preview without granting product readiness.
  renderable: boolean;
  developmentPreview: boolean;
};

export type CompositionModelDiagnostics = {
  loadState: AvatarAppState['model']['loadState'];
  modelId: string | null;
  modelPath: string | null;
  error: string | null;
};

export type CompositionInput = {
  bootstrapError: string | null;
  bootstrapComplete: boolean;
  shellReady: boolean;
  model: AvatarAppState['model'];
  consume: AvatarAppState['consume'];
  runtimeBinding: AvatarAppState['runtime']['binding'];
  driver: AvatarAppState['driver'];
  launchContext: AvatarAppState['launch']['context'];
};

const READY_DRIVER_STATUSES = new Set<string>(['running', 'starting']);

function isExplicitRealmTransportUnavailable(binding: AvatarAppState['runtime']['binding']): boolean {
  return binding.stage === 'realm_connectivity'
    && binding.source === 'realm'
    && binding.reasonCode === ReasonCode.REALM_UNAVAILABLE;
}

function readNormalizedString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function classifyDegradedReason(reason: string | null): CompositionState {
  if (!reason) return 'degraded_runtime_unavailable';
  const lowered = reason.toLowerCase();
  if (
    lowered.includes('account_session')
    || lowered.includes('account_access_token')
    || lowered.includes('reauth')
    || lowered.includes('principal_unauthorized')
  ) {
    return 'degraded_reauth_required';
  }
  if (lowered.includes('launch context') || lowered.includes('launch_context_invalid')) {
    return 'degraded_launch_context_invalid';
  }
  return 'degraded_runtime_unavailable';
}

function classifyBootstrapError(error: string): {
  state: CompositionState;
  variant: CompositionVariant;
} {
  const lowered = error.toLowerCase();
  if (lowered.includes('launch context')) {
    return { state: 'degraded_launch_context_invalid', variant: 'degraded' };
  }
  if (
    lowered.includes('principal_unauthorized')
    || lowered.includes('check_request_and_app_auth')
    || lowered.includes('local_app_')
    || lowered.includes('protected_local')
    || lowered.includes('protected_origin_role_mismatch')
    || lowered.includes('account_session')
    || lowered.includes('account_access_token')
  ) {
    return { state: 'degraded_reauth_required', variant: 'degraded' };
  }
  if (
    lowered.includes('daemon')
    || lowered.includes('runtime')
    || lowered.includes('driver_start')
    || lowered.includes('binding')
  ) {
    return { state: 'degraded_runtime_unavailable', variant: 'degraded' };
  }
  return { state: 'error_bootstrap_fatal', variant: 'error' };
}

function deriveModelDiagnostics(model: AvatarAppState['model']): CompositionModelDiagnostics | null {
  const modelId = readNormalizedString(model.modelId);
  const modelPath = readNormalizedString(model.modelPath);
  const error = readNormalizedString(model.error);
  if (model.loadState === 'idle' && !modelId && !modelPath && !error) return null;
  return {
    loadState: model.loadState,
    modelId,
    modelPath,
    error,
  };
}

export function deriveCompositionState(input: CompositionInput): CompositionDerivation {
  const modelDiagnostics = deriveModelDiagnostics(input.model);
  if (input.bootstrapError) {
    const classification = classifyBootstrapError(input.bootstrapError);
    return {
      state: classification.state,
      variant: classification.variant,
      reason: input.bootstrapError,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
      modelDiagnostics,
      ready: false,
      renderable: false,
      developmentPreview: false,
    };
  }

  if (!input.bootstrapComplete) {
    return {
      state: 'loading',
      variant: 'loading',
      reason: input.shellReady ? 'preparing_runtime' : 'preparing_shell',
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
      modelDiagnostics,
      ready: false,
      renderable: false,
      developmentPreview: false,
    };
  }

  // Explicit fixture mode has no Runtime binding by design. It may mount the
  // real renderer/backend surface for local development, while App.tsx keeps
  // its externally observable status distinct from product readiness.
  if (input.consume.authority !== 'fixture' && input.runtimeBinding.status !== 'active') {
    const reason = readNormalizedString(input.runtimeBinding.reason);
    return {
      state: isExplicitRealmTransportUnavailable(input.runtimeBinding)
        ? 'degraded_cloud_offline'
        : classifyDegradedReason(reason),
      variant: 'degraded',
      reason,
      reasonCode: input.runtimeBinding.reasonCode,
      accountReasonCode: input.runtimeBinding.accountReasonCode,
      actionHint: input.runtimeBinding.actionHint,
      stage: input.runtimeBinding.stage,
      source: input.runtimeBinding.source,
      retryable: input.runtimeBinding.retryable,
      modelDiagnostics,
      ready: false,
      renderable: false,
      developmentPreview: false,
    };
  }

  if (!READY_DRIVER_STATUSES.has(input.driver.status)) {
    const driverError = readNormalizedString(input.driver.error);
    return {
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: driverError ? `driver_${input.driver.status}: ${driverError}` : `driver_${input.driver.status}`,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
      modelDiagnostics,
      ready: false,
      renderable: false,
      developmentPreview: false,
    };
  }

  if (input.model.loadState === 'error') {
    return {
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: modelDiagnostics?.error ?? 'avatar model load failed',
      reasonCode: 'AVATAR_MODEL_LOAD_FAILED',
      accountReasonCode: null,
      actionHint: 'inspect_or_reimport_avatar_asset',
      stage: 'model_load',
      source: 'avatar_visual_carrier',
      retryable: false,
      modelDiagnostics,
      ready: false,
      renderable: false,
      developmentPreview: false,
    };
  }

  if (input.consume.authority === 'fixture') {
    return {
      state: 'fixture_not_verified',
      variant: 'fixture',
      reason: 'fixture_not_verified',
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: 'development_preview',
      source: 'fixture',
      retryable: null,
      modelDiagnostics,
      ready: false,
      renderable: true,
      developmentPreview: true,
    };
  }

  return {
    state: 'ready',
    variant: 'live',
    reason: null,
    reasonCode: null,
    accountReasonCode: null,
    actionHint: null,
    stage: null,
    source: null,
    retryable: null,
    modelDiagnostics,
    ready: true,
    renderable: true,
    developmentPreview: false,
  };
}
