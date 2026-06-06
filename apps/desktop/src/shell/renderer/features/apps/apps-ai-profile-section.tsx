import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiAIConfig, NimiAIProfile } from '@nimiplatform/sdk/ai';
import {
  ProfileConfigSection,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
} from '@nimiplatform/kit/features/model-config';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';
import {
  getCachedAccountProfileLibraryProfiles,
  loadAccountProfileLibrary,
} from '@renderer/features/runtime-config/runtime-config-profile-library.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import {
  appAIConfigRequirementDeclarations,
} from './apps-open-ai-config-gate.js';

export interface AppsAIProfileSectionProps {
  readonly entry: DesktopAppsEntry;
  readonly actionError: string | null;
}

export function AppsAIProfileSection({ entry, actionError }: AppsAIProfileSectionProps): ReactElement {
  const { t } = useTranslation();
  const service = useMemo(() => getDesktopAIConfigService(), []);
  const scopeRef = useMemo(() => ({ kind: 'app' as const, ownerId: entry.app.appId }), [entry.app.appId]);
  const requirementDeclaration = useMemo(
    () => appAIConfigRequirementDeclarations(entry.app)[0]!,
    [entry.app],
  );
  const [currentConfig, setCurrentConfig] = useState<NimiAIConfig>(() => service.aiConfig.get(scopeRef));
  const [recommendedProfile, setRecommendedProfile] = useState<NimiAIProfile | null>(null);
  const [accountDefaultProfile, setAccountDefaultProfile] = useState<NimiAIProfile | null>(null);
  const profileReloadRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    setCurrentConfig(service.aiConfig.get(scopeRef));
    return service.aiConfig.subscribe(scopeRef, setCurrentConfig);
  }, [scopeRef, service]);

  useEffect(() => {
    let cancelled = false;
    void service.aiProfile.get(entry.app.aiProfileSelectionRef)
      .then((profile) => {
        if (!cancelled) {
          setRecommendedProfile(profile);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecommendedProfile(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry.app.aiProfileSelectionRef, service]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadAccountProfileLibrary().catch(() => null),
      getAccountDefaultProfileForScopeInit().catch(() => null),
    ]).then(([, defaultProfile]) => {
      if (!cancelled) {
        setAccountDefaultProfile(defaultProfile);
        profileReloadRef.current?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const userProfilesSource = useMemo(
    () => ({
      list: () => [
        ...(accountDefaultProfile ? [accountDefaultProfile] : []),
        ...getCachedAccountProfileLibraryProfiles(),
      ],
    }),
    [accountDefaultProfile],
  );

  const currentOrigin = useMemo(
    () => (currentConfig.profileOrigin
      ? {
        profileId: currentConfig.profileOrigin.profileId,
        title: currentConfig.profileOrigin.title,
      }
      : null),
    [currentConfig.profileOrigin?.profileId, currentConfig.profileOrigin?.title],
  );

  const profileCopy = useMemo(() => ({
    ...defaultModelConfigProfileCopy(t),
    summaryLabel: t('Apps.aiProfile.currentProfile', { defaultValue: 'AI Profile' }),
    emptySummaryLabel: t('Apps.aiProfile.notInitialized', { defaultValue: 'Not initialized for this app' }),
    importLabel: t('Apps.aiProfile.changeProfile', { defaultValue: 'Change App Profile' }),
    modalTitle: t('Apps.aiProfile.modalTitle', { defaultValue: 'Apply AI Profile to App' }),
    modalHint: t('Apps.aiProfile.modalHint', {
      defaultValue: 'Choose a profile and preview the app-scope AIConfig before applying it.',
    }),
  }), [t]);

  const profileController = useModelConfigProfileController({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration,
    copy: profileCopy,
    userProfilesSource,
    currentOrigin,
  });

  useEffect(() => {
    profileReloadRef.current = profileController.onReload;
  }, [profileController.onReload]);

  const recommendedLabel = recommendedProfile?.title || entry.app.aiProfileSelectionRef;
  const capabilityText = entry.app.capabilitySet.join(', ');

  return (
    <section data-testid="apps-detail-ai-profile" className="flex flex-col gap-3 rounded-md border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
          {t('Apps.aiProfile.sectionTitle', { defaultValue: 'AI Profile' })}
        </span>
        <div className="grid gap-1 text-xs text-[color:var(--nimi-text-secondary)]">
          <InlineFact
            label={t('Apps.aiProfile.currentProfile', { defaultValue: 'Current profile' })}
            value={currentOrigin?.title || currentOrigin?.profileId || t('Apps.aiProfile.notInitialized', { defaultValue: 'Not initialized for this app' })}
          />
          <InlineFact
            label={t('Apps.aiProfile.recommendedProfile', { defaultValue: 'Recommended profile' })}
            value={recommendedLabel}
          />
          <InlineFact
            label={t('Apps.aiProfile.requiredCapabilities', { defaultValue: 'Required capabilities' })}
            value={capabilityText}
          />
        </div>
      </div>

      {actionError ? (
        <p data-testid="apps-detail-ai-profile-setup-required" className="rounded-md bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-2 py-1.5 text-xs text-[var(--nimi-status-warning)]">
          {actionError}
        </p>
      ) : null}

      <ProfileConfigSection controller={profileController} variant="import-button" />
    </section>
  );
}

function InlineFact({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <span className="shrink-0 text-[color:var(--nimi-text-muted)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[color:var(--nimi-text-primary)]">{value}</span>
    </div>
  );
}
