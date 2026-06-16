import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AvatarAppState } from './app-shell/app-store.js';
import type { AvatarLaunchContext } from './bridge/launch-context.js';
import { recordAvatarEvidenceEventually } from './app-shell/avatar-evidence.js';
import { normalizeText } from './avatar-shell-utils.js';
import {
  AVATAR_SCALE_DEFAULT,
  AVATAR_SCALE_WHEEL_STEP,
  clampAvatarScale,
  readAvatarInstanceScale,
  resetAvatarInstanceScale,
  scaleStorageKeyForAvatarInstance,
  writeAvatarInstanceScale,
} from './avatar-scale-state.js';

export type AvatarScaleChangeSource = 'wheel' | 'reset' | 'restore';

export function useAvatarShellScale(input: {
  consume: AvatarAppState['consume'];
  launchContext: AvatarLaunchContext | null;
}) {
  const { consume, launchContext } = input;
  const [avatarScale, setAvatarScale] = useState(AVATAR_SCALE_DEFAULT);

  const avatarScaleKey = useMemo(
    () =>
      scaleStorageKeyForAvatarInstance({
        avatarInstanceId: normalizeText(consume.avatarInstanceId)
          ?? normalizeText(launchContext?.avatarInstanceId),
        fixtureId: consume.fixtureId,
      }),
    [consume.avatarInstanceId, consume.fixtureId, launchContext?.avatarInstanceId],
  );

  const avatarScaleIdentity = useMemo(
    () =>
      normalizeText(consume.avatarInstanceId)
      ?? normalizeText(launchContext?.avatarInstanceId)
      ?? avatarScaleKey,
    [avatarScaleKey, consume.avatarInstanceId, launchContext?.avatarInstanceId],
  );

  const recordScaleChanged = useCallback(
    (change: { previousScale: number; nextScale: number; source: AvatarScaleChangeSource }): void => {
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.scale.changed',
        detail: {
          avatar_instance_id: avatarScaleIdentity,
          scale_storage_key: avatarScaleKey,
          previous_scale: change.previousScale,
          next_scale: change.nextScale,
          source: change.source,
          changed_at: new Date().toISOString(),
        },
      });
    },
    [avatarScaleIdentity, avatarScaleKey],
  );

  useEffect(() => {
    const restoredScale = readAvatarInstanceScale(avatarScaleKey);
    setAvatarScale((current) => {
      if (current === restoredScale) return current;
      recordScaleChanged({
        previousScale: current,
        nextScale: restoredScale,
        source: 'restore',
      });
      return restoredScale;
    });
  }, [avatarScaleKey, recordScaleChanged]);

  const updateAvatarScale = useCallback(
    (nextScaleInput: number, source: 'wheel' | 'reset'): void => {
      setAvatarScale((current) => {
        const nextScale = clampAvatarScale(nextScaleInput);
        if (nextScale === current) return current;
        if (source === 'reset') {
          resetAvatarInstanceScale(avatarScaleKey);
          recordAvatarEvidenceEventually({
            kind: 'avatar.shell.scale.reset',
            detail: {
              avatar_instance_id: avatarScaleIdentity,
              scale_storage_key: avatarScaleKey,
              previous_scale: current,
              next_scale: AVATAR_SCALE_DEFAULT,
              reset_at: new Date().toISOString(),
            },
          });
        } else {
          writeAvatarInstanceScale(avatarScaleKey, nextScale);
        }
        recordScaleChanged({
          previousScale: current,
          nextScale,
          source,
        });
        return nextScale;
      });
    },
    [avatarScaleIdentity, avatarScaleKey, recordScaleChanged],
  );

  const adjustAvatarScale = useCallback(
    (delta: number, source: 'wheel'): void => {
      setAvatarScale((current) => {
        const nextScale = clampAvatarScale(current + delta);
        if (nextScale === current) return current;
        writeAvatarInstanceScale(avatarScaleKey, nextScale);
        recordScaleChanged({
          previousScale: current,
          nextScale,
          source,
        });
        return nextScale;
      });
    },
    [avatarScaleKey, recordScaleChanged],
  );

  const handleAvatarWheel = useCallback(
    (wheel: { deltaY: number }): void => {
      const direction = wheel.deltaY < 0 ? 1 : -1;
      adjustAvatarScale(direction * AVATAR_SCALE_WHEEL_STEP, 'wheel');
    },
    [adjustAvatarScale],
  );

  return {
    avatarScale,
    updateAvatarScale,
    handleAvatarWheel,
  };
}
