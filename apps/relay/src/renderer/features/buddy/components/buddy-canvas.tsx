// RL-FEAT-005 — Live2D canvas component
// Supports tap interaction for motion group playback

import { useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLive2d } from '../hooks/use-live2d.js';

export function BuddyCanvas() {
  const { t } = useTranslation();
  const { canvasRef, modelState, handleTap } = useLive2d();

  // RL-FEAT-005: Click canvas → tap Live2D model at cursor position
  const onClick = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    handleTap(x, y);
  }, [handleTap]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-pointer"
        style={{ minHeight: 300 }}
        onClick={onClick}
      />
      {modelState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
          <span className="text-sm text-gray-400">{t('live2d.loadingModel')}</span>
        </div>
      )}
      {modelState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
          <span className="text-sm text-red-400">{t('live2d.failedToLoad')}</span>
        </div>
      )}
    </div>
  );
}
