import { useAppStore } from '@renderer/app-shell/app-store.js';

/**
 * useOnboardingGate — SJ-SHELL-008
 *
 * Returns gating state for the "Start Dialogue" button.
 * Explore surfaces are freely accessible without a profile.
 * Dialogue entry requires an active learner profile.
 */
export function useOnboardingGate(): {
  hasActiveProfile: boolean;
  shouldRedirectToProfileCreation: boolean;
} {
  const activeProfile = useAppStore((s) => s.activeProfile);
  const profilesLoaded = useAppStore((s) => s.profilesLoaded);

  const hasActiveProfile = activeProfile !== null && activeProfile.isActive;

  // If profiles haven't loaded yet, don't redirect (avoids false positive)
  const shouldRedirectToProfileCreation = profilesLoaded && !hasActiveProfile;

  return { hasActiveProfile, shouldRedirectToProfileCreation };
}
