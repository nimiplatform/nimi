import { useLayoutEffect, useRef } from 'react';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';

import { ZhiyuCanonicalApp } from '../shell/app/App.js';
import type { ZhiyuCanonicalRendererBindings } from './contract.js';

function ZhiyuMainSurface(props: { readonly bindings: ZhiyuCanonicalRendererBindings }) {
  const readyCandidateReportedRef = useRef(false);
  useLayoutEffect(() => {
    if (readyCandidateReportedRef.current) return;
    readyCandidateReportedRef.current = true;
    props.bindings.surfaceLifecycle.reportReadyCandidate({
      contractId: 'zhiyu.main.usable',
    });
  }, [props.bindings]);
  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <div
        className="nimi-ui-module--zhiyu"
        data-nimi-semantic-id="zhiyu-main-root"
      >
        <ZhiyuCanonicalApp bindings={props.bindings} />
      </div>
    </NimiThemeProvider>
  );
}

export const zhiyuCanonicalRendererFactory = Object.freeze({
  factoryId: 'zhiyu/canonical-renderer',
  createInstance(bindings: ZhiyuCanonicalRendererBindings) {
    let disposed = false;
    const main = Object.freeze({
      id: 'main' as const,
      render() {
        if (disposed) throw new Error('ZHIYU_CANONICAL_INSTANCE_DISPOSED');
        return <ZhiyuMainSurface bindings={bindings} />;
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
