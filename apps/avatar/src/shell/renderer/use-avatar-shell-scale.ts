import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AvatarAppState } from './app-shell/app-store.js';
import type { AvatarLaunchContext } from './bridge/launch-context.js';
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

  useEffect(() => {
    const restoredScale = readAvatarInstanceScale(avatarScaleKey);
    setAvatarScale(restoredScale);
  }, [avatarScaleKey]);

  const updateAvatarScale = useCallback(
    (nextScaleInput: number, source: 'wheel' | 'reset'): void => {
      setAvatarScale((current) => {
        const nextScale = clampAvatarScale(nextScaleInput);
        if (nextScale === current) return current;
        if (source === 'reset') {
          resetAvatarInstanceScale(avatarScaleKey);
        } else {
          writeAvatarInstanceScale(avatarScaleKey, nextScale);
        }
        return nextScale;
      });
    },
    [avatarScaleKey],
  );

  const adjustAvatarScale = useCallback(
    (delta: number): void => {
      setAvatarScale((current) => {
        const nextScale = clampAvatarScale(current + delta);
        if (nextScale === current) return current;
        writeAvatarInstanceScale(avatarScaleKey, nextScale);
        return nextScale;
      });
    },
    [avatarScaleKey],
  );

  const handleAvatarWheel = useCallback(
    (wheel: { deltaY: number }): void => {
      const direction = wheel.deltaY < 0 ? 1 : -1;
      adjustAvatarScale(direction * AVATAR_SCALE_WHEEL_STEP);
    },
    [adjustAvatarScale],
  );

  return {
    avatarScale,
    updateAvatarScale,
    handleAvatarWheel,
  };
}
