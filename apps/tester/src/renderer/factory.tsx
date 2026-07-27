import { useLayoutEffect, useRef } from 'react';
import { AmbientBackground, TooltipProvider } from '@nimiplatform/kit/ui';

import { ProductArea } from '../shell/routes/product-area.js';
import { TesterRendererProvider } from './context.js';
import type { TesterCanonicalRendererBindings } from './contract.js';

function TesterMainSurface(props: { readonly bindings: TesterCanonicalRendererBindings }) {
  const readyCandidateReportedRef = useRef(false);
  useLayoutEffect(() => {
    if (readyCandidateReportedRef.current) return;
    readyCandidateReportedRef.current = true;
    props.bindings.surfaceLifecycle.reportReadyCandidate();
  }, [props.bindings]);
  return (
    <TesterRendererProvider bindings={props.bindings}>
      <TooltipProvider>
        <div
          className="nimi-ui-module--tester"
          data-nimi-semantic-id="tester-main-root"
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
    </TesterRendererProvider>
  );
}

export const testerCanonicalRendererFactory = Object.freeze({
  factoryId: 'tester/canonical-renderer',
  createInstance(bindings: TesterCanonicalRendererBindings) {
    let disposed = false;
    const main = Object.freeze({
      id: 'main' as const,
      render() {
        if (disposed) throw new Error('TESTER_CANONICAL_INSTANCE_DISPOSED');
        return <TesterMainSurface bindings={bindings} />;
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
