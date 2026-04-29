// Wave 1 NAV-SHELL-COMPOSITION-004 — composition state machine evidence emit.
//
// Emits the four `avatar.composition.*` events admitted by
// `avatar-event-contract.md` §2.5 / §4 whenever the avatar shell composition
// state machine transitions or surfaces mount / unmount. Surface components
// (embodiment-stage / companion-surface / degraded-surface) call
// `useSurfaceMountEvidence` from their root; the App-level
// `emitCompositionTransition` is driven from a derived-state observer in
// `App.tsx`.
//
// Detail schema source of truth: `apps/avatar/spec/kernel/avatar-event-contract.md`.

import { useEffect, useRef } from 'react';
import { recordAvatarEvidenceEventually, type AvatarCompositionSurface } from './avatar-evidence.js';
import type { CompositionDerivation } from './composition-state.js';

export function emitCompositionTransition(
  previous: CompositionDerivation | null,
  next: CompositionDerivation,
): void {
  if (previous && previous.state === next.state) {
    return;
  }
  recordAvatarEvidenceEventually({
    kind: 'avatar.composition.transition',
    detail: {
      from: previous ? previous.state : null,
      to: next.state,
      reason_code: next.reasonCode,
      account_reason_code: next.accountReasonCode,
      stage: next.stage,
      reason: next.reason,
      recorded_at: new Date().toISOString(),
    },
  });
}

export function emitCompositionRelaunchPending(input: {
  agentId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
}): void {
  recordAvatarEvidenceEventually({
    kind: 'avatar.composition.relaunch-pending',
    detail: {
      next_launch_context: {
        agent_id: input.agentId,
        avatar_instance_id: input.avatarInstanceId,
        launch_source: input.launchSource,
      },
      notified_at: new Date().toISOString(),
    },
  });
}

export function emitSurfaceMounted(
  surface: AvatarCompositionSurface,
  compositionState: string,
): void {
  recordAvatarEvidenceEventually({
    kind: 'avatar.composition.surface-mounted',
    detail: {
      surface,
      composition_state: compositionState,
      mounted_at: new Date().toISOString(),
    },
  });
}

export function emitSurfaceUnmounted(
  surface: AvatarCompositionSurface,
  compositionState: string,
): void {
  recordAvatarEvidenceEventually({
    kind: 'avatar.composition.surface-unmounted',
    detail: {
      surface,
      composition_state: compositionState,
      unmounted_at: new Date().toISOString(),
    },
  });
}

// React hook used by surface root components. Emits surface-mounted on first
// mount and surface-unmounted on unmount. The composition state is captured
// via ref so unmount records the state observed at unmount time, not the
// initial mount time. Re-emission on composition state change while still
// mounted is intentionally avoided — that would conflict with the spec
// semantics where mount/unmount frame the surface lifecycle, not its
// composition transitions (which are covered by `transition` events).
export function useSurfaceMountEvidence(
  surface: AvatarCompositionSurface,
  compositionState: string,
): void {
  const stateRef = useRef(compositionState);
  stateRef.current = compositionState;
  useEffect(() => {
    emitSurfaceMounted(surface, stateRef.current);
    return () => {
      emitSurfaceUnmounted(surface, stateRef.current);
    };
  }, [surface]);
}
