import { useState, type ReactNode } from 'react';
import { useUi } from './ui-context.tsx';
import { SkyCanvas } from './sky-canvas.tsx';

/**
 * The Field — luminous sky container. Phase rides on this element.
 * Renders the WebGL living sky when available; CSS phase background otherwise.
 */
export function Field({ phase, children }: { phase: string; children?: ReactNode }) {
  const { dayTime, intensity, motion } = useUi();
  const [glFailed, setGlFailed] = useState(false);
  const useCssSky = glFailed;

  return (
    <div className={useCssSky ? 'field' : 'field field--gl'} data-phase={phase}>
      {useCssSky ? (
        <>
          <span className="wisp a" aria-hidden />
          <span className="wisp b" aria-hidden />
        </>
      ) : (
        <SkyCanvas
          dayTime={dayTime}
          intensity={intensity}
          motion={motion}
          onFallback={() => setGlFailed(true)}
        />
      )}
      {children}
    </div>
  );
}
