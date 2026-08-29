import { useLayoutEffect, useRef } from 'react';
import { AmbientBackground, NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';

import { ProductArea } from '../shell/routes/product-area.js';
import { LabRendererProvider } from './context.js';
import type { LabCanonicalRendererBindings } from './contract.js';

function LabMainSurface(props: { readonly bindings: LabCanonicalRendererBindings }) {
  const readyCandidateReportedRef = useRef(false);
  useLayoutEffect(() => {
    if (readyCandidateReportedRef.current) return;
    readyCandidateReportedRef.current = true;
    props.bindings.surfaceLifecycle.reportReadyCandidate();
  }, [props.bindings]);
  return (
    <LabRendererProvider bindings={props.bindings}>
      <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
        <TooltipProvider>
          <div
            className="lab-main-surface nimi-workbench-host"
            data-nimi-semantic-id="lab-main-root"
          >
            <AmbientBackground
              variant="mesh"
              className="app-shell"
              data-testid="nimi-app-shell"
            >
              <ProductArea />
            </AmbientBackground>
          </div>
        </TooltipProvider>
      </NimiThemeProvider>
    </LabRendererProvider>
  );
}

export const labCanonicalRendererFactory = Object.freeze({
  factoryId: 'lab/canonical-renderer',
  createInstance(bindings: LabCanonicalRendererBindings) {
    let disposed = false;
    const main = Object.freeze({
      id: 'main' as const,
      render() {
        if (disposed) throw new Error('LAB_CANONICAL_INSTANCE_DISPOSED');
        return <LabMainSurface bindings={bindings} />;
      },
    });
    return {
      surfaces: Object.freeze({ main }),
      dispose() {
        disposed = true;
      },
    };
  },
});
