import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAvailableEncounterScripts, type EncounterScript } from './data/encounter-scripts.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { sqliteUpdateLearnerProfile } from '@renderer/bridge/sqlite-bridge.js';

type EncounterState =
  | { phase: 'active'; scriptIndex: number }
  | { phase: 'done' };

export function CharacterEncounter({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeProfile = useAppStore((state) => state.activeProfile);
  const updateProfileEncounterCompleted = useAppStore((state) => state.updateProfileEncounterCompleted);
  const availableScripts = getAvailableEncounterScripts();

  const [state, setState] = useState<EncounterState>({ phase: 'active', scriptIndex: 0 });
  const [actionError, setActionError] = useState<string | null>(null);

  const currentScript: EncounterScript | null =
    state.phase === 'active' && state.scriptIndex < availableScripts.length
      ? (availableScripts[state.scriptIndex] ?? null)
      : null;

  const persistEncounterCompleted = useCallback(async () => {
    if (!activeProfile) {
      return;
    }

    const now = new Date().toISOString();
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
  }, [activeProfile, updateProfileEncounterCompleted]);

  const handleAccept = useCallback(async () => {
    if (!currentScript) {
      return;
    }
    try {
      setActionError(null);
      await persistEncounterCompleted();
      navigate(`/explore/${currentScript.worldId}/agent/${currentScript.agentId}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [currentScript, navigate, persistEncounterCompleted]);

  const handleNext = useCallback(async () => {
    if (state.phase !== 'active') {
      return;
    }

    const nextIndex = state.scriptIndex + 1;
    try {
      setActionError(null);
      if (nextIndex >= availableScripts.length) {
        await persistEncounterCompleted();
        setState({ phase: 'done' });
      } else {
        setState({ phase: 'active', scriptIndex: nextIndex });
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [availableScripts.length, persistEncounterCompleted, state]);

  const handleDismiss = useCallback(async () => {
    try {
      setActionError(null);
      await persistEncounterCompleted();
      onDismiss();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [onDismiss, persistEncounterCompleted]);

  if (availableScripts.length === 0) {
    return null;
  }

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
      <div className="w-full max-w-lg mb-12 mx-4">
        <div className="bg-amber-50 rounded-3xl overflow-hidden shadow-2xl">
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

          <div className="px-6 pt-3 pb-1">
            <span className="text-sm text-amber-600 font-medium">{currentScript.characterName}</span>
          </div>

          <div className="px-6 pb-6">
            <p className="text-neutral-800 text-lg leading-relaxed font-medium">
              &ldquo;{currentScript.openingLine}&rdquo;
            </p>
            {actionError ? (
              <p className="mt-3 text-sm text-red-700">{actionError}</p>
            ) : null}
          </div>

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

export function useEncounterShouldShow(): boolean {
  const activeProfile = useAppStore((state) => state.activeProfile);
  const profilesLoaded = useAppStore((state) => state.profilesLoaded);

  if (!profilesLoaded || getAvailableEncounterScripts().length === 0) {
    return false;
  }

  if (!activeProfile) {
    return true;
  }

  return activeProfile.encounterCompletedAt === null;
}
