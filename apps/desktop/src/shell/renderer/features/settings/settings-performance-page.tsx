import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  runDesktopUpdateCheck,
  runDesktopUpdateInstall,
  runDesktopUpdateRestart,
} from '@renderer/infra/bootstrap/desktop-updates';
import {
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';
import {
  loadStoredPerformancePreferences,
  persistStoredPerformancePreferences,
  type PerformancePreferences,
} from './settings-storage.js';
import {
  AnimationIcon,
  AwardIcon,
  canUseDesktopUpdater,
  CodeIcon,
  collectDesktopUpdatePanelAlerts,
  CpuIcon,
  DownloadIcon,
  formatUpdateProgress,
  GpuIcon,
  InfoCard,
  performanceEqual,
  ServerIcon,
  SettingRow,
  TargetIcon,
} from './settings-preferences-panel-parts.js';

export function PerformancePage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const runtimeFields = useAppStore((s) => s.runtimeFields);
  const desktopReleaseInfo = useAppStore((s) => s.desktopReleaseInfo);
  const desktopReleaseError = useAppStore((s) => s.desktopReleaseError);
  const desktopUpdateState = useAppStore((s) => s.desktopUpdateState);
  const [preferences, setPreferences] = useState<PerformancePreferences>(() =>
    loadStoredPerformancePreferences());
  const [baseline, setBaseline] = useState<PerformancePreferences>(() =>
    loadStoredPerformancePreferences());
  const [saving, setSaving] = useState(false);
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const eligibilityQuery = useQuery({
    queryKey: ['settings-creator-eligibility'],
    queryFn: async () => dataSync.loadMyCreatorEligibility(),
  });

  const hasChanges = useMemo(() => !performanceEqual(preferences, baseline), [preferences, baseline]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setStatusBanner({
          kind: 'info',
          message: t('Performance.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      persistStoredPerformancePreferences(preferences);
      setBaseline(preferences);
      if (!silentSuccess) {
        setStatusBanner({
          kind: 'success',
          message: t('Performance.saveSuccess'),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void handleSave({ silentSuccess: true });
    }, 700);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [hasChanges, preferences, saving]);

  const eligibility = eligibilityQuery.data;
  const eligibilityText = eligibilityQuery.isPending
    ? t('Performance.loadingEligibility')
    : eligibilityQuery.isError
      ? t('Performance.eligibilityLoadError')
      : eligibility
        ? `${eligibility.tier} · ${eligibility.status}`
        : '-';
  const isEligible = eligibility?.isEligible ?? false;
  const updateStatusText = desktopUpdateState
    ? ({
      idle: t('Performance.updateStatusIdle'),
      checking: t('Performance.updateStatusChecking'),
      available: t('Performance.updateStatusAvailable'),
      downloading: t('Performance.updateStatusDownloading'),
      downloaded: t('Performance.updateStatusDownloaded'),
      installing: t('Performance.updateStatusInstalling'),
      readyToRestart: t('Performance.updateStatusReadyToRestart'),
      error: t('Performance.updateStatusError'),
    }[desktopUpdateState.status] || desktopUpdateState.status)
    : t('Performance.updateStatusIdle');
  const canCheckUpdates = canUseDesktopUpdater({
    desktopReleaseError,
    updaterAvailable: desktopReleaseInfo?.updaterAvailable,
  });
  const canRestartForUpdate = desktopUpdateState?.readyToRestart === true;
  const isUpdateBusy = desktopUpdateState?.status === 'checking'
    || desktopUpdateState?.status === 'downloading'
    || desktopUpdateState?.status === 'installing';
  const desktopUpdateAlerts = collectDesktopUpdatePanelAlerts({
    desktopReleaseError,
    runtimeLastError: desktopReleaseInfo?.runtimeLastError,
    updaterUnavailableReason: desktopReleaseInfo?.updaterUnavailableReason,
    updateLastError: desktopUpdateState?.lastError,
  });

  return (
    <PageShell
      title={t('Performance.pageTitle')}
      description={t('Performance.pageDescription')}
    >
      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionRenderingDescription')}>
          {t('Performance.sectionRendering')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<GpuIcon className="h-5 w-5" />}
            title={t('Performance.hardwareAcceleration')}
            description={t('Performance.hardwareAccelerationDescription')}
            checked={preferences.hardwareAcceleration}
            onChange={(value) => setPreferences((previous) => ({ ...previous, hardwareAcceleration: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<AnimationIcon className="h-5 w-5" />}
            title={t('Performance.reduceAnimations')}
            description={t('Performance.reduceAnimationsDescription')}
            checked={preferences.reduceAnimations}
            onChange={(value) => setPreferences((previous) => ({ ...previous, reduceAnimations: value }))}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionUpdatesDescription')}>
          {t('Performance.sectionUpdates')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<DownloadIcon className="h-5 w-5" />}
            title={t('Performance.autoUpdate')}
            description={t('Performance.autoUpdateDescription')}
            checked={preferences.autoUpdate}
            onChange={(value) => setPreferences((previous) => ({ ...previous, autoUpdate: value }))}
          />
        </div>
        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{t('Performance.appUpdateTitle')}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {t('Performance.appUpdateDescription')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canCheckUpdates || isUpdateBusy}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void runDesktopUpdateCheck({ autoDownload: false, silent: false });
                  }}
                >
                  {t('Performance.checkNow')}
                </button>
                <button
                  type="button"
                  disabled={!canCheckUpdates || isUpdateBusy || canRestartForUpdate}
                  className="rounded-lg bg-mint-600 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void runDesktopUpdateInstall({ silent: false });
                  }}
                >
                  {t('Performance.downloadAndInstall')}
                </button>
                <button
                  type="button"
                  disabled={!canRestartForUpdate}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void runDesktopUpdateRestart();
                  }}
                >
                  {t('Performance.restartNow')}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCard icon={<DownloadIcon className="h-5 w-5" />} label={t('Performance.desktopVersion')} value={desktopReleaseInfo?.desktopVersion || '-'} />
              <InfoCard icon={<ServerIcon className="h-5 w-5" />} label={t('Performance.bundledRuntime')} value={desktopReleaseInfo?.runtimeVersion || '-'} />
              <InfoCard icon={<TargetIcon className="h-5 w-5" />} label={t('Performance.updateStatus')} value={updateStatusText} />
              <InfoCard icon={<AwardIcon className="h-5 w-5" />} label={t('Performance.targetVersion')} value={desktopUpdateState?.targetVersion || '-'} />
            </div>

            {desktopUpdateState?.status === 'downloading' ? (
              <div className="rounded-xl border border-mint-100 bg-mint-50 px-4 py-3 text-xs text-mint-700">
                {formatUpdateProgress(
                  desktopUpdateState.downloadedBytes,
                  desktopUpdateState.totalBytes,
                  t('Performance.updateProgressDownloaded'),
                )}
              </div>
            ) : null}

            {desktopUpdateAlerts.map((alert) => (
              <div
                key={`${alert.tone}:${alert.message}`}
                className={alert.tone === 'error'
                  ? 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700'
                  : 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700'}
              >
                {alert.message}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionDeveloperDescription')}>
          {t('Performance.sectionDeveloper')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<CodeIcon className="h-5 w-5" />}
            title={t('Performance.developerMode')}
            description={t('Performance.developerModeDescription')}
            checked={preferences.developerMode}
            onChange={(value) => setPreferences((previous) => ({ ...previous, developerMode: value }))}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('Performance.sectionRuntimeInfo')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="divide-y divide-gray-50">
            <InfoCard icon={<ServerIcon className="h-5 w-5" />} label={t('Performance.provider')} value={runtimeFields.provider || t('Performance.notConfigured')} />
            <InfoCard icon={<CpuIcon className="h-5 w-5" />} label={t('Performance.model')} value={runtimeFields.localProviderModel || '-'} />
            <InfoCard icon={<TargetIcon className="h-5 w-5" />} label={t('Performance.mode')} value={runtimeFields.mode} />
            <InfoCard icon={<CodeIcon className="h-5 w-5" />} label={t('Performance.targetType')} value={runtimeFields.targetType} />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('Performance.sectionCreatorEligibility')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isEligible ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'}`}>
                <AwardIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{t('Performance.eligibility')}</p>
                <p className="text-xs text-gray-500">{eligibilityText}</p>
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              isEligible ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {isEligible ? t('Performance.eligible') : t('Performance.notEligible')}
            </span>
          </div>
          {eligibility?.message ? (
            <p className="mt-4 text-xs text-gray-500">{eligibility.message}</p>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}
