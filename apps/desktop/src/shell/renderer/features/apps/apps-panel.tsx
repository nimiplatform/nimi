import { useEffect, type ReactElement } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useAppsPanelController } from './apps-panel-controller.js';
import { AppsPanelView } from './apps-panel-view.js';

export function AppsPanel(): ReactElement {
  const settings = useDesktopRendererCommands().settings;
  const requestedDetailAppId = useAppStore((state) => state.appsDetailAppId);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const controller = useAppsPanelController();
  const {
    projection,
    detailAppId,
    actionError,
    activeAction,
    runCardAction,
    retryProjection,
    closeDetail,
  } = controller;

  useEffect(() => {
    if (requestedDetailAppId) {
      runCardAction(requestedDetailAppId, 'details');
    }
  }, [requestedDetailAppId, runCardAction]);

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <AppsPanelView
        projection={projection}
        selectedAppId={detailAppId}
        onCardAction={runCardAction}
        onBack={() => {
          setAppsDetailAppId(null);
          closeDetail();
        }}
        onOpenDeveloperMode={() => {
          settings.openSection('developer');
          setActiveTab('settings');
        }}
        onRetry={retryProjection}
        actionError={actionError}
        activeAction={activeAction}
      />
    </div>
  );
}
