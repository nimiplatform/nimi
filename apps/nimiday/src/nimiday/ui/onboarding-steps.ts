import type { CircleKind } from '../domain/types.js';

export type CircleDraft = { readonly key: string; readonly kind: CircleKind; readonly name: string };

type OnboardingActions = {
  readonly addCircle: (input: { kind: CircleKind; name: string }) => unknown;
  readonly updateProfile: (patch: { onboarded: true }) => void;
};

/**
 * What the first-run wizard's buttons do. People named along the way are
 * created once, when the wizard is finished, so going back and forward (or
 * leaving halfway) never leaves duplicates behind.
 */
export function onboardingSteps(actions: OnboardingActions) {
  return {
    /** Leaving the people step: nothing is saved yet, the drafts stay in the wizard. */
    continueFromCircles: (_drafts: readonly CircleDraft[]): number => 3,
    finish: (drafts: readonly CircleDraft[]): void => {
      for (const draft of drafts) {
        const name = draft.name.trim();
        if (name) actions.addCircle({ kind: draft.kind, name });
      }
      actions.updateProfile({ onboarded: true });
    },
  };
}
