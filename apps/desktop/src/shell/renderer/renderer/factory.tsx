import { useEffect, useState } from 'react';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';

import { AppProviders } from '../app-shell/providers/app-providers.js';
import { AppErrorBoundary } from '../infra/error-boundary/app-error-boundary.js';
import { AppearanceEffects } from '../features/settings/appearance-effects.js';
import type { DesktopCanonicalRendererBindings } from './contract.js';
import { DesktopRendererContent } from './content.js';
import { createDesktopRendererResources } from './resources.js';
import { DesktopRendererBindingProvider } from './binding-context.js';

function DesktopMainSurface(props: {
  readonly bindings: DesktopCanonicalRendererBindings;
  readonly resources: ReturnType<typeof createDesktopRendererResources>;
}) {
  const [localizationReady, setLocalizationReady] = useState(false);

  useEffect(() => {
    let active = true;
    void props.resources.i18n.init().then(() => {
      if (active) setLocalizationReady(true);
    });
    return () => {
      active = false;
    };
  }, [props.resources]);

  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light" defaultDensity="compact">
      <div
        className="nimi-ui-module--desktop"
        data-nimi-semantic-id="desktop-main-root"
        id={props.bindings.scope.domId('main-root')}
        role="region"
        aria-label="Nimi"
      >
        {localizationReady ? (
          <DesktopRendererBindingProvider bindings={props.bindings}>
            <AppearanceEffects />
            <AppProviders
            accountProfileLibrary={props.resources.accountProfileLibrary}
            agentVisibleProjections={props.resources.agentVisibleProjections}
            anchorBindings={props.resources.anchorBindings}
            attention={props.resources.attention}
            chatUploadPlaceholders={props.resources.chatUploadPlaceholders}
            i18n={props.resources.i18n}
            localModelCenterProgress={props.resources.localModelCenterProgress}
            queryClient={props.resources.queryClient}
            realmGroupChatData={props.resources.realmGroupChatData}
            realmHumanChatData={props.resources.realmHumanChatData}
            realmSocialData={props.resources.realmSocialData}
            runtimeConnectorSdk={props.resources.runtimeConnectorSdk}
            Router={props.resources.Router}
            scenarioJobController={props.resources.scenarioJobController}
            store={props.resources.store}
            streamController={props.resources.streamController}
            worldFollowStore={props.resources.worldFollowStore}
          >
            <AppErrorBoundary>
              <div
                data-nimi-semantic-id="desktop-main-content"
                className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                <DesktopRendererContent />
              </div>
            </AppErrorBoundary>
            </AppProviders>
          </DesktopRendererBindingProvider>
        ) : null}
      </div>
    </NimiThemeProvider>
  );
}

export const desktopCanonicalRendererFactory = Object.freeze({
  factoryId: 'desktop/canonical-renderer',
  createInstance(bindings: DesktopCanonicalRendererBindings) {
    let disposed = false;
    let readyCandidateReported = false;
    const instanceBindings: DesktopCanonicalRendererBindings = Object.freeze({
      ...bindings,
      surfaceLifecycle: Object.freeze({
        ...bindings.surfaceLifecycle,
        reportReadyCandidate() {
          if (readyCandidateReported) return;
          readyCandidateReported = true;
          bindings.surfaceLifecycle.reportReadyCandidate();
        },
      }),
    });
    const resources = createDesktopRendererResources(instanceBindings);
    const main = Object.freeze({
      id: 'main' as const,
      render() {
        if (disposed) throw new Error('DESKTOP_CANONICAL_INSTANCE_DISPOSED');
        return <DesktopMainSurface bindings={instanceBindings} resources={resources} />;
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
