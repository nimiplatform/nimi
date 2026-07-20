import { useState } from 'react';
import { useUi } from './UiContext';
import { SkyCanvas } from './sky/SkyCanvas';

/**
 * The Field — luminous sky container. Phase rides on this element.
 * Renders the WebGL living sky when available; CSS phase background otherwise.
 */
export function Field({ phase, children }: { phase: string; children?: React.ReactNode }) {
  const { dayTime, intensity, motion } = useUi();
  const [glFailed, setGlFailed] = useState(false);

  return (
    <div className={glFailed ? 'field' : 'field field--gl'} data-phase={phase}>
      {glFailed ? (
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
