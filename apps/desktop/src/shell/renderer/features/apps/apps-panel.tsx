import { useCallback, useEffect, type ReactElement } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { AppCardActionId } from './apps-card-actions.js';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsPanelView } from './apps-panel-view.js';

export function dispatchAppsPanelCardAction(input: {
  readonly appId: string;
  readonly action: AppCardActionId;
  readonly setAppsDetailAppId: (appId: string | null) => void;
  readonly runCardAction: (appId: string, action: AppCardActionId) => void;
}): void {
  if (input.action === 'details') {
    input.setAppsDetailAppId(input.appId);
  }
  input.runCardAction(input.appId, input.action);
}

export function AppsPanel(): ReactElement {
  const settings = useDesktopRendererCommands().settings;
  const sdk = useDesktopRendererSdk();
  const requestedDetailAppId = useAppStore((state) => state.appsDetailAppId);
  const requestedDetailSection = useAppStore((state) => state.appsDetailSection);
  const requestedDetailNavigationRevision = useAppStore((state) => state.appsDetailNavigationRevision);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const readAppAIConfig = useCallback(
    (appId: string, options: { readonly timeoutMs: number; readonly signal: AbortSignal }) => (
      sdk.accountProduct().appAIConfig(appId).get(options)
    ),
    [sdk],
  );
  const controller = useAppsPanelController({ readAppAIConfig });
  const {
    projection,
    detailAppId,
    actionError,
    activeAction,
    runCardAction,
    retryProjection,
    closeDetail,
    acknowledgeAIConfigMutation,
  } = controller;
  const handleCardAction = useCallback((appId: string, action: AppCardActionId): void => {
    dispatchAppsPanelCardAction({
      appId,
      action,
      setAppsDetailAppId,
      runCardAction,
    });
  }, [runCardAction, setAppsDetailAppId]);

  useEffect(() => {
    if (requestedDetailAppId) {
      runCardAction(requestedDetailAppId, 'details');
    }
  }, [requestedDetailAppId, requestedDetailNavigationRevision, runCardAction]);

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <AppsPanelView
        projection={projection}
        selectedAppId={detailAppId}
        requestedDetailSection={requestedDetailAppId === detailAppId ? requestedDetailSection : null}
        requestedDetailNavigationRevision={requestedDetailNavigationRevision}
        onCardAction={handleCardAction}
        onBack={() => {
          setAppsDetailAppId(null);
          closeDetail();
        }}
        onOpenDeveloperMode={() => {
          settings.openSection('developer');
          setActiveTab('settings');
        }}
        onRetry={retryProjection}
        onAIConfigChanged={acknowledgeAIConfigMutation}
        actionError={actionError}
        activeAction={activeAction}
      />
    </div>
  );
}
