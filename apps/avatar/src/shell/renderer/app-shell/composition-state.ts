// Surface composition state derivation per app-shell-contract.md §6 (NAV-SHELL-COMPOSITION-001..005).
// The avatar shell renders exactly one of three surfaces at any time:
//   - ready:               embodiment-stage + companion-surface (mutually visible)
//   - fixture-active:      same as ready, but driven by VITE_AVATAR_DRIVER=mock fixture data
//   - loading:             pre-bootstrap-complete; degraded-surface variant=loading
//   - degraded:*:          typed runtime / account / launch failures
//   - error:bootstrap-fatal: untyped bootstrap throw; degraded-surface variant=error
//   - relaunch-pending:    desktop-pushed launch context update; ready surface unmounted

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
  // True iff embodiment-stage + companion-surface should mount.
  // False iff only degraded-surface should mount.
  ready: boolean;
};

export type CompositionInput = {
  bootstrapError: string | null;
  bootstrapComplete: boolean;
  shellReady: boolean;
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

export function deriveCompositionState(input: CompositionInput): CompositionDerivation {
  if (input.relaunchPending) {
    return {
      state: 'relaunch_pending',
      variant: 'relaunch',
      reason: 'launch_context_updated',
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
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
      ready: false,
    };
  }

  // Bootstrap completed in fixture mode → fixture_active. Mock authority is explicit.
  if (input.consume.authority === 'fixture' || input.consume.mode === 'mock') {
    return {
      state: 'fixture_active',
      variant: 'fixture',
      reason: null,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      ready: true,
    };
  }

  // Bootstrap completed but runtime binding is not active → degraded.
  if (input.runtimeBinding.status !== 'active') {
    const reason = readNormalizedString(input.runtimeBinding.reason);
    return {
      state: classifyDegradedReason(reason),
      variant: 'degraded',
      reason,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      ready: false,
    };
  }

  // Bootstrap completed, binding active, but driver not running → degraded.
  if (!READY_DRIVER_STATUSES.has(input.driver.status)) {
    return {
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: `driver_${input.driver.status}`,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      ready: false,
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
    ready: true,
  };
}
