import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';
import { Boxes, Cable, Compass } from 'lucide-react';

import { useAIStudioWorkspaceController } from '../ai-studio-core/index.js';
import { useLabRendererHost } from '../renderer/context.js';
import type { LabEcosystemReferenceProjection } from '../renderer/contract.js';
import { NimiLabAccountMenu } from '../shell/account/account-panel.js';
import { useTranslation } from '../shell/i18n/index.js';
import { WorkbenchCore, type WorkbenchNavigationGroup, type WorkbenchNavigationItem } from '../workbench-core/index.js';
import { AppAccessPanel } from './app-access/app-access-panel.js';
import { getLabCapability, labCapabilities, type LabCapabilityId } from './lab-capabilities.js';
import type { LabAIConfigSummary } from './lab-ai-config.js';
import {
  LabAIStudioWorkspace,
  useLabAIStudioHistoryRepository,
} from './lab-ai-studio-workspace.js';
import type { LabPreferences } from './lab-preferences.js';
import { labStudioComposition } from './lab-studio-composition.js';
import { labTestIds } from './lab-test-ids.js';
import {
  workbenchLibraryCapabilityId,
  workbenchNavGroups,
  type WorkbenchView,
} from './workbench/workbench-context.js';

const initialCapabilityId: LabCapabilityId = 'text.generate';

function restoredInitialCapabilityId(preferences: LabPreferences): LabCapabilityId {
  const saved = preferences.lastCapabilityId;
  if (!saved) return initialCapabilityId;
  return labCapabilities.some((item) => item.id === saved) ? saved as LabCapabilityId : initialCapabilityId;
}

const SettingsRoute = lazy(async () => ({
  default: (await import('../shell/routes/settings-route.js')).SettingsRoute,
}));
const KitComponentGallery = lazy(async () => ({
  default: (await import('./kit-component-gallery.js')).KitComponentGallery,
}));
const LabAiConfigSettingsPanel = lazy(async () => ({
  default: (await import('./workbench/lab-ai-config-settings-panel.js')).LabAiConfigSettingsPanel,
}));

type LabWorkbenchProps = { title: string };
type LabWorkbenchNavigationId = LabCapabilityId | 'app-access' | 'ui-recipes';

export function LabWorkbench(_props: LabWorkbenchProps) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const initialPreferences = rendererHost.app.projection.preferences();
  const [preferences, setPreferences] = useState<LabPreferences>(initialPreferences);
  const [view, setView] = useState<WorkbenchView>(() => ({
    kind: 'capability',
    capabilityId: restoredInitialCapabilityId(initialPreferences),
  }));
  const activeCapabilityId: LabCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<LabAIConfigSummary | null>(null);
  const [ecosystemReference, setEcosystemReference] = useState<LabEcosystemReferenceProjection | null>(
    () => rendererHost.app.projection.ecosystemReference(),
  );

  const updatePreferences = useCallback((patch: Partial<LabPreferences>) => {
    setPreferences(() => {
      const next = { ...rendererHost.app.projection.preferences(), ...patch };
      void rendererHost.app.commands.savePreferences(next).catch((error: unknown) => {
        void rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'lab-preferences',
          message: 'preferences-save-failed',
          details: { error: error instanceof Error ? error.message : String(error || 'Preferences save failed.') },
        });
      });
      return next;
    });
  }, [rendererHost]);

  const selectCapabilityView = useCallback((capabilityId: LabCapabilityId) => {
    setView({ kind: 'capability', capabilityId });
    updatePreferences({ lastCapabilityId: capabilityId });
  }, [updatePreferences]);

  const historyRepository = useLabAIStudioHistoryRepository();
  const studioController = useAIStudioWorkspaceController({
    historyRepository,
    registrations: labStudioComposition.capabilities,
    onSelectCapability: (capabilityId) => selectCapabilityView(capabilityId as LabCapabilityId),
    translate: t,
  });

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await rendererHost.app.projection.aiConfigSummary());
    } catch (error) {
      setSummary({
        runtime: {
          status: 'unavailable',
          mode: 'unknown',
          detail: error instanceof Error ? error.message : String(error || 'Runtime inspection failed.'),
        },
      });
    }
  }, [rendererHost]);

  useEffect(() => { void refreshSummary(); }, [refreshSummary]);
  useEffect(() => rendererHost.app.events.subscribe(
    'lab.ecosystem.reference-updated',
    (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const reference = payload as Partial<LabEcosystemReferenceProjection>;
      if (!Number.isSafeInteger(reference.ecosystemRevision)) return;
      setEcosystemReference(reference as LabEcosystemReferenceProjection);
    },
  ), [rendererHost]);

  const navigationGroups = useMemo<readonly WorkbenchNavigationGroup<LabWorkbenchNavigationId>[]>(() => [
    ...workbenchNavGroups.map((group) => ({
      id: group.label,
      items: group.capabilityIds.map((id) => ({
        id,
        label: t(getLabCapability(id).labelKey),
        icon: labStudioComposition.getCapability(id).icon,
        semanticId: id === 'text.generate' ? 'lab-primary-action' : undefined,
      })),
    })),
    {
      id: 'library',
      items: [{
        id: workbenchLibraryCapabilityId,
        label: t(getLabCapability(workbenchLibraryCapabilityId).labelKey),
        icon: Compass,
      }],
    },
  ], [t]);
  const bottomNavigationItems = useMemo<readonly WorkbenchNavigationItem<LabWorkbenchNavigationId>[]>(() => [
    { id: 'app-access', label: t('AppAccess.page.title'), icon: Cable },
    { id: 'ui-recipes', label: t('Workbench.uiRecipes'), icon: Boxes },
  ], [t]);

  const capabilityRegistration = useMemo(
    () => labStudioComposition.getCapability(activeCapabilityId),
    [activeCapabilityId],
  );
  const activeNavigationId: LabWorkbenchNavigationId | null = view.kind === 'capability'
    ? view.capabilityId
    : view.kind === 'app-access' || view.kind === 'ui-recipes' ? view.kind : null;
  const selectNavigationView = (id: LabWorkbenchNavigationId) => {
    if (id === 'app-access' || id === 'ui-recipes') {
      setView({ kind: id });
      return;
    }
    selectCapabilityView(id);
  };

  return (
    <WorkbenchCore
      activeViewId={activeNavigationId}
      navigationLabel={t('Workbench.sideNavAriaLabel')}
      navigationGroups={navigationGroups}
      bottomNavigationItems={bottomNavigationItems}
      onSelectView={selectNavigationView}
      accountSlot={<NimiLabAccountMenu onOpenSettings={() => setView({ kind: 'settings' })} />}
      rootTestId={labTestIds.root}
    >
      {view.kind === 'settings' ? (
        <Suspense fallback={<LoadingFallback />}><SettingsRoute /></Suspense>
      ) : view.kind === 'app-access' ? (
        <AppAccessPanel />
      ) : view.kind === 'ui-recipes' ? (
        <Suspense fallback={<LoadingFallback />}>
          <KitComponentGallery
            onOpenSection={(target) => {
              const capabilityId = labCapabilities.find((item) => item.id === target)?.id ?? initialCapabilityId;
              selectCapabilityView(capabilityId);
            }}
          />
        </Suspense>
      ) : (
        <LabAIStudioWorkspace
          controller={studioController}
          registration={capabilityRegistration}
          registrations={labStudioComposition.capabilities}
          runtime={summary?.runtime ?? null}
          verboseConsole={preferences.verboseConsole}
          draftPersistence={preferences.draftPersistence}
          rootTestId={labTestIds.sectionAI}
          renderAIConfigPanel={({ runtime, capabilityId }) => (
            <LabAiConfigSettingsPanel runtime={runtime} capabilityId={capabilityId} />
          )}
          headerActions={ecosystemReference ? (
            <StatusBadge
              tone="success"
              shape="dot"
              data-nimi-semantic-id="lab-ecosystem-reference"
              data-ecosystem-revision={ecosystemReference.ecosystemRevision}
            >
              {t('WorkbenchTop.ecosystemRevision', { revision: ecosystemReference.ecosystemRevision })}
            </StatusBadge>
          ) : null}
        />
      )}
    </WorkbenchCore>
  );
}

function LoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <LoadingSkeleton lines={4} className="w-full max-w-md" label={t('Common.loading')} />
    </div>
  );
}
