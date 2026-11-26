import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const WHEEL_DELTA_SCALE_UNIT_PX = 100;
const WHEEL_MIN_SCALE_INCREMENT = 0.01;

export function useAvatarShellScale(input: {
  consume: AvatarAppState['consume'];
  launchContext: AvatarLaunchContext | null;
}) {
  const { consume, launchContext } = input;
  const [avatarScale, setAvatarScale] = useState(AVATAR_SCALE_DEFAULT);
  const wheelAccumulatorRef = useRef(0);

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
    wheelAccumulatorRef.current = 0;
    const restoredScale = readAvatarInstanceScale(avatarScaleKey);
    setAvatarScale(restoredScale);
  }, [avatarScaleKey]);

  const updateAvatarScale = useCallback(
    (nextScaleInput: number, source: 'wheel' | 'reset'): void => {
      if (source === 'reset') {
        wheelAccumulatorRef.current = 0;
      }
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
      if (!Number.isFinite(wheel.deltaY) || wheel.deltaY === 0) return;
      const proportionalDelta =
        Math.max(-1, Math.min(1, -wheel.deltaY / WHEEL_DELTA_SCALE_UNIT_PX)) * AVATAR_SCALE_WHEEL_STEP;
      if (
        wheelAccumulatorRef.current !== 0
        && Math.sign(proportionalDelta) !== Math.sign(wheelAccumulatorRef.current)
      ) {
        wheelAccumulatorRef.current = 0;
      }
      wheelAccumulatorRef.current += proportionalDelta;
      if (Math.abs(wheelAccumulatorRef.current) < WHEEL_MIN_SCALE_INCREMENT) return;
      const quantizedStep = Math.trunc(wheelAccumulatorRef.current * 100) / 100;
      if (quantizedStep === 0) return;
      wheelAccumulatorRef.current -= quantizedStep;
      adjustAvatarScale(quantizedStep);
    },
    [adjustAvatarScale],
  );

  return {
    avatarScale,
    updateAvatarScale,
    handleAvatarWheel,
  };
}
