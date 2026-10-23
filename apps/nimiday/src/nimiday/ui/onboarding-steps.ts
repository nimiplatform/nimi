import type { CircleKind } from '../domain/types.js';
import type { SourceGroup } from '../domain/sources.js';

export type CircleDraft = { readonly key: string; readonly kind: CircleKind; readonly name: string; readonly sourceKey?: string };

type OnboardingActions = {
  readonly addCircle: (input: { kind: CircleKind; name: string }) => unknown;
  readonly addSourceChild: (group: SourceGroup) => unknown;
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
    finish: (drafts: readonly CircleDraft[], availableGroups: readonly SourceGroup[] = []): boolean => {
      if (drafts.some(draft => draft.sourceKey && !availableGroups.some(group =>
        group.key === draft.sourceKey && group.child && group.available))) return false;
      for (const draft of drafts) {
        if (draft.sourceKey) {
          actions.addSourceChild(availableGroups.find(group => group.key === draft.sourceKey)!);
          continue;
        }
        const name = draft.name.trim();
        if (name) actions.addCircle({ kind: draft.kind, name });
      }
      actions.updateProfile({ onboarded: true });
      return true;
    },
  };
}
