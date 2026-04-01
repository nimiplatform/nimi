import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ENCOUNTER_SCRIPTS, MAX_ENCOUNTER_COUNT, type EncounterScript } from './data/encounter-scripts.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { sqliteUpdateLearnerProfile } from '@renderer/bridge/sqlite-bridge.js';

type EncounterState =
  | { phase: 'active'; scriptIndex: number }
  | { phase: 'done' };

/**
 * CharacterEncounter — SJ-SHELL-009
 *
 * First-visit overlay: a historical character appears with a dilemma.
 * UI layer runs without SQLite.
 * Persistence (encounterCompletedAt) requires SQLite to be ready.
 */
export function CharacterEncounter({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const updateProfileEncounterCompleted = useAppStore((s) => s.updateProfileEncounterCompleted);

  const [state, setState] = useState<EncounterState>({ phase: 'active', scriptIndex: 0 });

  const currentScript: EncounterScript | null =
    state.phase === 'active' && state.scriptIndex < ENCOUNTER_SCRIPTS.length
      ? (ENCOUNTER_SCRIPTS[state.scriptIndex] ?? null)
      : null;

  const persistEncounterCompleted = useCallback(async () => {
    if (!activeProfile) {
      return; // No profile yet — will be written when profile is created (SJ-SHELL-009:8d)
    }
    const now = new Date().toISOString();
    try {
      // JSON-serialize array/object fields — SQLite bridge stores them as JSON strings
      await sqliteUpdateLearnerProfile({
        id: activeProfile.id,
        displayName: activeProfile.displayName,
        age: activeProfile.age,
        communicationStyle: activeProfile.communicationStyle,
        guardianGoals: activeProfile.guardianGoals,
        strengthTags: JSON.stringify(activeProfile.strengthTags),
        interestTags: JSON.stringify(activeProfile.interestTags),
        supportNotes: JSON.stringify(activeProfile.supportNotes),
        guardianGuidance: JSON.stringify(activeProfile.guardianGuidance),
        encounterCompletedAt: now,
        updatedAt: now,
      });
      updateProfileEncounterCompleted(activeProfile.id, now);
    } catch {
      // Best-effort — SQLite may not be ready yet (Phase 0 non-blocking)
    }
  }, [activeProfile, updateProfileEncounterCompleted]);

  const handleAccept = useCallback(async () => {
    if (!currentScript) {
      return;
    }
    await persistEncounterCompleted();
    navigate(`/explore/${currentScript.worldId}/agent/${currentScript.agentId}`);
  }, [currentScript, persistEncounterCompleted, navigate]);

  const handleNext = useCallback(async () => {
    if (state.phase !== 'active') {
      return;
    }
    const nextIndex = state.scriptIndex + 1;
    if (nextIndex >= MAX_ENCOUNTER_COUNT || nextIndex >= ENCOUNTER_SCRIPTS.length) {
      // Completed all encounters — SJ-SHELL-009:5
      await persistEncounterCompleted();
      setState({ phase: 'done' });
    } else {
      setState({ phase: 'active', scriptIndex: nextIndex });
    }
  }, [state, persistEncounterCompleted]);

  const handleDismiss = useCallback(async () => {
    await persistEncounterCompleted();
    onDismiss();
  }, [persistEncounterCompleted, onDismiss]);

  // "Done" state — transition to full timeline — SJ-SHELL-009:5
  if (state.phase === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-amber-950/70 backdrop-blur-sm">
        <div className="max-w-md mx-auto px-6 text-center space-y-6">
          <p className="text-amber-100 text-xl leading-relaxed font-medium">
            {t('encounter.moreWaiting')}
          </p>
          <button
            onClick={onDismiss}
            className="px-8 py-3 bg-amber-600 text-white rounded-2xl text-base font-medium hover:bg-amber-700 transition-colors"
          >
            {t('encounter.dismiss')}
          </button>
        </div>
      </div>
    );
  }

  if (!currentScript) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-amber-950/60 backdrop-blur-sm">
      {/* Encounter card — slides up from bottom */}
      <div className="w-full max-w-lg mb-12 mx-4">
        <div className="bg-amber-50 rounded-3xl overflow-hidden shadow-2xl">
          {/* Preview tags — SJ-SHELL-009:3 */}
          <div className="flex gap-2 px-6 pt-5">
            {currentScript.previewTags.map((tag) => (
              <span
                key={tag}
                className="text-xs text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full font-medium"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Character name */}
          <div className="px-6 pt-3 pb-1">
            <span className="text-sm text-amber-600 font-medium">{currentScript.characterName}</span>
          </div>

          {/* Opening line — dilemma, not introduction — SJ-SHELL-009:2 */}
          <div className="px-6 pb-6">
            <p className="text-neutral-800 text-lg leading-relaxed font-medium">
              &ldquo;{currentScript.openingLine}&rdquo;
            </p>
          </div>

          {/* Actions — zero learning cost, only two choices — SJ-SHELL-009:9 */}
          <div className="border-t border-amber-100 flex">
            <button
              onClick={() => void handleNext()}
              className="flex-1 py-4 text-amber-600 text-base font-medium hover:bg-amber-100 transition-colors border-r border-amber-100"
            >
              {t('encounter.next')}
            </button>
            <button
              onClick={() => void handleAccept()}
              className="flex-1 py-4 text-amber-700 text-base font-bold hover:bg-amber-200 transition-colors"
            >
              {t('encounter.accept')}
            </button>
          </div>
        </div>

        {/* Dismiss link — SJ-SHELL-009:6 */}
        <div className="text-center mt-4">
          <button
            onClick={() => void handleDismiss()}
            className="text-amber-200 text-sm hover:text-amber-100 transition-colors underline underline-offset-2"
          >
            {t('encounter.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * useEncounterShouldShow — SJ-SHELL-009:8
 *
 * Returns whether the first-visit encounter should be displayed.
 *
 * Trigger logic:
 * a) No active profile → always trigger (definitionally first-time visitor)
 * b) Active profile + encounterCompletedAt non-null → don't trigger
 * c) Active profile + encounterCompletedAt null → trigger
 */
export function useEncounterShouldShow(): boolean {
  const activeProfile = useAppStore((s) => s.activeProfile);
  const profilesLoaded = useAppStore((s) => s.profilesLoaded);

  // If profiles not loaded yet, don't show (avoids flicker)
  if (!profilesLoaded) {
    return false;
  }

  // No profile → always trigger (SJ-SHELL-009:8a)
  if (!activeProfile) {
    return true;
  }

  // Profile with null encounterCompletedAt → trigger (SJ-SHELL-009:8c)
  // Profile with non-null encounterCompletedAt → don't trigger (SJ-SHELL-009:8b)
  return activeProfile.encounterCompletedAt === null;
}
