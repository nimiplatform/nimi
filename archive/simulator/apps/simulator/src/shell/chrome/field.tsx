import { useState, type ReactNode } from 'react';
import { useUi } from './ui-context.tsx';
import { SkyCanvas } from './sky-canvas.tsx';

/**
 * The Field — fixed lunar-surface scene container. Phase rides on this
 * element. Renders the unified WebGL light model when available and a
 * physically coherent static lunar plate otherwise.
 *
 * Fallback is capability-driven: SkyCanvas rejects unavailable WebGL2 and
 * software rasterizers itself. Browser automation is not a rendering
 * capability signal, so controlled headed development keeps the living sky.
 */
export function Field({ phase, children }: { phase: string; children?: ReactNode }) {
  const { sceneTime, autoSceneTime, intensity, motion } = useUi();
  const [glFailed, setGlFailed] = useState(false);
  const useCssSky = glFailed;

  return (
    <div className={useCssSky ? 'field' : 'field field--gl'} data-phase={phase}>
      {useCssSky ? (
        null
      ) : (
        <SkyCanvas
          sceneTime={sceneTime}
          autoTime={autoSceneTime}
          intensity={intensity}
          motion={motion}
          onFallback={() => setGlFailed(true)}
        />
      )}
      {children}
    </div>
  );
}
