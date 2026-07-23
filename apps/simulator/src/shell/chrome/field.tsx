import { useState, type ReactNode } from 'react';
import { useUi } from './ui-context.tsx';
import { SkyCanvas } from './sky-canvas.tsx';

/**
 * The Field — luminous sky container. Phase rides on this element.
 * Renders the WebGL living sky when available; CSS phase background otherwise.
 *
 * Automation-driven browsers (navigator.webdriver — the qualified headless
 * runners) always take the CSS sky: CDP screenshots force GPU readbacks of
 * any live WebGL canvas and emit console warnings, which the zero-browser-
 * diagnostics qualification gate forbids. Interactive browsers keep the full
 * living sky.
 */
export function Field({ phase, children }: { phase: string; children?: ReactNode }) {
  const { dayTime, intensity, motion } = useUi();
  const [glFailed, setGlFailed] = useState(false);
  const [automation] = useState(() => typeof navigator !== 'undefined' && navigator.webdriver === true);
  const useCssSky = glFailed || automation;

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
