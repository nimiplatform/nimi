import { useEffect, useLayoutEffect, useState } from 'react';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';

import { AppProviders } from '../app-shell/providers/app-providers.js';
import { AppErrorBoundary } from '../infra/error-boundary/app-error-boundary.js';
import type { DesktopCanonicalRendererBindings } from './contract.js';
import { DesktopRendererContent } from './content.js';
import { createDesktopRendererResources } from './resources.js';
import { DesktopRendererBindingProvider } from './binding-context.js';

function DesktopMainSurface(props: {
  readonly bindings: DesktopCanonicalRendererBindings;
  readonly resources: ReturnType<typeof createDesktopRendererResources>;
}) {
  const [localizationReady, setLocalizationReady] = useState(
    props.resources.i18n.instance.isInitialized,
  );

  useEffect(() => {
    let active = true;
    void props.resources.i18n.init().then(() => {
      if (active) setLocalizationReady(true);
    });
    return () => {
      active = false;
    };
  }, [props.resources]);

  useLayoutEffect(() => {
    if (!localizationReady) return;
    props.bindings.surfaceLifecycle.reportReadyCandidate({
      contractId: 'desktop.main.usable',
    });
  }, [localizationReady, props.bindings]);

  if (!localizationReady) return null;
  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light" defaultDensity="compact">
      <div
        className="nimi-ui-module--desktop"
        data-nimi-semantic-id="desktop-main-root"
        id={props.bindings.scope.domId('main-root')}
        role="region"
        aria-label="Nimi Desktop"
      >
        <DesktopRendererBindingProvider bindings={props.bindings}>
          <AppProviders
            attention={props.resources.attention}
            i18n={props.resources.i18n}
            queryClient={props.resources.queryClient}
            realmSocialData={props.resources.realmSocialData}
            Router={props.resources.Router}
            scenarioJobController={props.resources.scenarioJobController}
            store={props.resources.store}
            streamController={props.resources.streamController}
          >
            <AppErrorBoundary>
              <DesktopRendererContent />
            </AppErrorBoundary>
          </AppProviders>
        </DesktopRendererBindingProvider>
      </div>
    </NimiThemeProvider>
  );
}

export const desktopCanonicalRendererFactory = Object.freeze({
  factoryId: 'desktop/canonical-renderer',
  createInstance(bindings: DesktopCanonicalRendererBindings) {
    let disposed = false;
    const resources = createDesktopRendererResources(bindings);
    const main = Object.freeze({
      id: 'main' as const,
      render() {
        if (disposed) throw new Error('DESKTOP_CANONICAL_INSTANCE_DISPOSED');
        return <DesktopMainSurface bindings={bindings} resources={resources} />;
      },
    });
    return {
      surfaces: Object.freeze({ main }),
      dispose() {
        if (disposed) return;
        disposed = true;
        resources.dispose();
      },
    };
  },
});
