// Surface composition state derivation per app-shell-contract.md section 6
// (K-NAV-SHELL-COMPOSITION-001..005).
// The avatar shell renders exactly one of three surfaces at any time:
//   - ready:            embodiment-stage + companion-surface
//   - fixture-active:   same as ready, but driven by VITE_AVATAR_DRIVER=mock fixture data
//   - loading:          pre-bootstrap-complete; degraded-surface variant=loading
//   - degraded:*:       typed runtime / account / launch failures
//   - error:*:          untyped bootstrap failures
//   - relaunch-pending: desktop-pushed launch context update; ready surface unmounted

import type { AvatarAppState } from './app-store.js';

export type CompositionState =
  | 'ready'
  | 'fixture_active'
  | 'loading'
  | 'degraded_reauth_required'
  | 'degraded_runtime_unavailable'
  | 'degraded_launch_context_invalid'
  | 'error_bootstrap_fatal'
  | 'relaunch_pending';

export type CompositionVariant = 'live' | 'fixture' | 'loading' | 'degraded' | 'error' | 'relaunch';

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
  // True iff embodiment-stage + companion-surface should mount.
  // False iff only degraded-surface should mount.
  ready: boolean;
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
  // Set when desktop pushes a launch-context update that requires a shell reload before the
  // next ready posture. App.tsx flips this on `avatar://launch-context-updated`.
  relaunchPending: boolean;
};

const READY_DRIVER_STATUSES = new Set<string>(['running', 'starting']);

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
    lowered.includes('app_grant_invalid')
    || lowered.includes('attach_active_scoped_runtime_binding')
    || lowered.includes('principal_unauthorized')
    || lowered.includes('check_request_and_app_auth')
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
  const fixtureMode = input.consume.authority === 'fixture' || input.consume.mode === 'mock';

  if (input.relaunchPending) {
    return {
      state: 'relaunch_pending',
      variant: 'relaunch',
      reason: 'launch_context_updated',
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
      modelDiagnostics,
      ready: false,
    };
  }

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
    };
  }

  if (!fixtureMode && input.runtimeBinding.status !== 'active') {
    const reason = readNormalizedString(input.runtimeBinding.reason);
    return {
      state: classifyDegradedReason(reason),
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
    };
  }

  if (fixtureMode) {
    return {
      state: 'fixture_active',
      variant: 'fixture',
      reason: null,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
      modelDiagnostics,
      ready: true,
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
  };
}
